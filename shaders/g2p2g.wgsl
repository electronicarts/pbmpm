//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

//!include dispatch.inc
//!include simConstants.inc
//!include bukkit.inc
//!include particle.inc
//!include shapes.inc

@group(0) @binding(0) var<uniform> g_simConstants : SimConstants;
@group(0) @binding(1) var<storage, read_write> g_particles : array<Particle>;
@group(0) @binding(2) var<storage> g_gridSrc : array<i32>;
@group(0) @binding(3) var<storage, read_write> g_gridDst : array<atomic<i32>>;
@group(0) @binding(4) var<storage> g_bukkitThreadData : array<BukkitThreadData>;
@group(0) @binding(5) var<storage> g_bukkitParticleData : array<u32>;
@group(0) @binding(6) var<storage> g_shapes : array<SimShape>;

const TotalBukkitEdgeLength = BukkitSize + BukkitHaloSize*2;
const TileDataSizePerEdge = TotalBukkitEdgeLength * 4;
const TileDataSize = TileDataSizePerEdge*TileDataSizePerEdge;
var<workgroup> s_tileData: array<atomic<i32>, TileDataSize>;
// Note we are going to atomicAdd to this but we don't need to initialize its contents
// to zero because the webgpu spec guarantees this anyway 
var<workgroup> s_tileDataDst: array<atomic<i32>, TileDataSize>;

fn localGridIndex(index: vec2u) -> u32
{
    return (index.y * TotalBukkitEdgeLength + index.x)*4;
}

@compute @workgroup_size(ParticleDispatchSize)
fn csMain( @builtin(local_invocation_index) indexInGroup: u32, @builtin(workgroup_id) groupId: vec3<u32> )
{
    let threadData = g_bukkitThreadData[groupId.x];

    // Load grid
    let localGridOrigin = BukkitSize*vec2i(vec2u(threadData.bukkitX, threadData.bukkitY)) - vec2i(BukkitHaloSize);
    let idInGroup = vec2i(i32(indexInGroup) % TotalBukkitEdgeLength, i32(indexInGroup) / TotalBukkitEdgeLength);
    let gridVertex = idInGroup + localGridOrigin;
    let gridPosition = vec2f(gridVertex);

    var dx = 0.0;
    var dy = 0.0;
    var w = 0.0;
    var v = 0.0;

    var gridVertexIsValid = all(gridVertex >= vec2i(0)) && all(gridVertex <= vec2i(g_simConstants.gridSize));

    var appliedGridCorrection = false;

    if(gridVertexIsValid)
    {
        let gridVertexAddress = gridVertexIndex(vec2u(gridVertex), g_simConstants.gridSize);

        // Load from grid
        dx = decodeFixedPoint(g_gridSrc[gridVertexAddress + 0], g_simConstants.fixedPointMultiplier);
        dy = decodeFixedPoint(g_gridSrc[gridVertexAddress + 1], g_simConstants.fixedPointMultiplier);
        w = decodeFixedPoint(g_gridSrc[gridVertexAddress + 2],  g_simConstants.fixedPointMultiplier);
        v = decodeFixedPoint(g_gridSrc[gridVertexAddress + 3],  g_simConstants.fixedPointMultiplier);

        // Grid update
        if(w < 1e-5f)
        {
            dx = 0;
            dy = 0;
        }
        else
        {
            // Perform mass weighting to get grid displacement
            dx = dx / w;
            dy = dy / w;
        }

    //dx = dx * 0.995;
        //dy = dy * 0.995;


     

        var gridDisplacement = vec2f(dx, dy);

        // Collision detection against collider shapes
        for(var shapeIndex = 0u; shapeIndex < g_simConstants.shapeCount; shapeIndex++)
        {
            let shape = g_shapes[shapeIndex];

            // if(shape.functionality != ShapeFunctionCollider)
            // {
            //     continue;
            // }

            // let displacedGridPosition = gridPosition + gridDisplacement;

            // let collideResult = collide(shape, displacedGridPosition);

            // if(collideResult.collides)
            // {
            //     let gap = min(0, dot(collideResult.normal, collideResult.pointOnCollider - gridPosition));
            //     let penetration = dot(collideResult.normal, gridDisplacement) - gap;

            //     // Prevent any further penetration in radial direction
            //     let radialImpulse = max(penetration, 0);
            //     gridDisplacement -= radialImpulse*collideResult.normal;
            // }
        }

        // Collision detection against guardian shape

        // Grid vertices near or inside the guardian region should have their displacenent values
        // corrected in order to prevent particles moving into the guardian.
        // We do this by finding whether a grid vertex would be inside the guardian region after displacement
        // with the current velocity and, if it is, setting the displacement so that no further penetration can occur.
        let displacedGridPosition = gridPosition + gridDisplacement;
        let projectedGridPosition = projectInsideGuardian(displacedGridPosition, g_simConstants.gridSize, GuardianSize+1);
        let projectedDifference = projectedGridPosition - displacedGridPosition;

        if(projectedDifference.x != 0)
        {
            gridDisplacement.x = 0;
            gridDisplacement.y = 0;
            appliedGridCorrection = true;
        }

        if(projectedDifference.y != 0)
        {
            gridDisplacement.x = 0;
            gridDisplacement.y = 0;
            appliedGridCorrection = true;
        }
        
        dx = gridDisplacement.x;
        dy = gridDisplacement.y;
    }

    // Save grid to local memory
    let tileDataIndex = localGridIndex(vec2u(idInGroup));
    atomicStore(&s_tileData[tileDataIndex], encodeFixedPoint(dx, g_simConstants.fixedPointMultiplier));
    atomicStore(&s_tileData[tileDataIndex+1], encodeFixedPoint(dy, g_simConstants.fixedPointMultiplier));
    atomicStore(&s_tileData[tileDataIndex+2], encodeFixedPoint(w, g_simConstants.fixedPointMultiplier));
    atomicStore(&s_tileData[tileDataIndex+3], encodeFixedPoint(v, g_simConstants.fixedPointMultiplier));

    atomicStore(&s_tileDataDst[tileDataIndex], 0);
    atomicStore(&s_tileDataDst[tileDataIndex+1], 0);
    atomicStore(&s_tileDataDst[tileDataIndex+2], 0);
    atomicStore(&s_tileDataDst[tileDataIndex+3], 0);

    workgroupBarrier();

    if(indexInGroup < threadData.rangeCount)
    {
        // Load Particle
        let myParticleIndex = g_bukkitParticleData[threadData.rangeStart + indexInGroup];
        //let myParticleIndex = indexInGroup + groupId.x*ParticleDispatchSize;
        var particle = g_particles[myParticleIndex];

        if(particle.enabled != 0.0)
        {
            var p = particle.position;
            let weightInfo = quadraticWeightInit(p);

            if(g_simConstants.iteration != 0)
            {
                // G2P
                var B = ZeroMatrix;
                var d = vec2f(0);
                var volume = 0.0;
                // Iterate over local 3x3 neigbourhood
                for(var i = 0; i < 3; i++)
                {
                    for(var j = 0; j < 3; j++)
                    {
                        // Weight corresponding to this neighbourhood cell
                        let weight = weightInfo.weights[i].x * weightInfo.weights[j].y;

                        // 2d index of this cell in the grid
                        let neighbourCellIndex = vec2i(weightInfo.cellIndex) + vec2i(i,j);

                        // 2d index relative to the corner of the local grid
                        let neighbourCellIndexLocal = neighbourCellIndex - localGridOrigin;

                        // Linear index in the local grid
                        let gridVertexIdx = localGridIndex(vec2u(neighbourCellIndexLocal));

                        let weightedDisplacement = weight * vec2f(
                            decodeFixedPoint(atomicLoad(&s_tileData[gridVertexIdx + 0]), g_simConstants.fixedPointMultiplier),
                            decodeFixedPoint(atomicLoad(&s_tileData[gridVertexIdx + 1]), g_simConstants.fixedPointMultiplier)
                        );
                        
                        let offset = vec2f(neighbourCellIndex) - p + 0.5;
                        B += outerProduct(weightedDisplacement, offset);
                        d += weightedDisplacement;

                        // This is only required if we are going to mix in the grid volume to the liquid volume
                        if(g_simConstants.useGridVolumeForLiquid != 0)
                        {
                            volume += weight * decodeFixedPoint(atomicLoad(&s_tileData[gridVertexIdx + 3]), g_simConstants.fixedPointMultiplier);
                        }
                    }
                }

                // Using standard MPM volume integration for liquids can lead to slow volume loss over time
                // especially when particles are undergoing a lot of shearing motion.
                // We can recover an objective measure of volume from the grid directly.
                // Here we mix it in to the integrated volume, but only if the liquid is compressed.
                // This is because the behaviour in tension of the grid volume and mpm volume is quite different.
                // Note this runs every iteration in the PBMPM solver but we only really require it to happen occasionally
                // because the MPM integration doesn't lose volume very fast.
                if(g_simConstants.useGridVolumeForLiquid != 0)
                {
                    volume = 1.0/volume;
                    if(volume < 1)
                    {
                        particle.liquidDensity = mix(particle.liquidDensity, volume, 0.1);
                    }
                }


                particle.deformationDisplacement = B * 4.0;
                particle.displacement = d;

                // Save particle
                g_particles[myParticleIndex] = particle;
            }




            
            //if(g_simConstants.iteration != g_simConstants.iterationCount-1)
            {
                // Particle update
                if(particle.material == MaterialLiquid)
                {
                    // Simple liquid viscosity: just remove deviatoric part of the deformation displacement
                    let deviatoric = -1.0*(particle.deformationDisplacement + transpose(particle.deformationDisplacement));
                    particle.deformationDisplacement += g_simConstants.liquidViscosity*0.5*deviatoric;

                    // Volume preservation constraint:
                    // we want to generate hydrostatic impulses with the form alpha*I
                    // and we want the liquid volume integration (see particleIntegrate) to yield 1 = (1+tr(alpha*I + D))*det(F) at the end of the timestep.
                    // where det(F) is stored as particle.liquidDensity.
                    // Rearranging, we get the below expression that drives the deformation displacement towards preserving the volume.
                    let alpha = 0.5*(1.0/particle.liquidDensity - tr(particle.deformationDisplacement) - 1.0);
                    particle.deformationDisplacement += g_simConstants.liquidRelaxation*alpha*Identity; 
                }
                else if(particle.material == MaterialElastic || particle.material == MaterialVisco)
                {
                    let F =  (Identity + particle.deformationDisplacement) * particle.deformationGradient;

                    var svdResult = svd(F);
                    
                    // Closest matrix to F with det == 1
                    let df = det(F);
                    let cdf = clamp(abs(df), 0.1, 1000);
                    let Q = (1.0f/(sign(df)*sqrt(cdf)))*F;
                    // Interpolate between the two target shapes
                    let alpha = g_simConstants.elasticityRatio;
                    let tgt = alpha*(svdResult.U*svdResult.Vt) + (1.0-alpha)*Q;

                    let diff = (tgt*inverse(particle.deformationGradient) - Identity) - particle.deformationDisplacement;
                    particle.deformationDisplacement += g_simConstants.elasticRelaxation*diff;

                }
                else if(particle.material == MaterialSand)
                {
                    let F =  (Identity + particle.deformationDisplacement) * particle.deformationGradient;

                    var svdResult = svd(F);

                    if(particle.logJp == 0)
                    {
                        svdResult.Sigma = clamp(svdResult.Sigma, vec2f(1, 1), vec2f(1000, 1000));
                    }

                    // Closest matrix to F with det == 1
                    let df = det(F);
                    let cdf = clamp(abs(df), 0.1, 1);
                    let Q = (1.0f/(sign(df)*sqrt(cdf)))*F;
                    // Interpolate between the two target shapes
                    let alpha = g_simConstants.elasticityRatio;
                    let tgt = alpha*(svdResult.U*mat2x2f(svdResult.Sigma.x, 0, 0, svdResult.Sigma.y)*svdResult.Vt) + (1.0-alpha)*Q;

                    let diff = (tgt*inverse(particle.deformationGradient) - Identity) - particle.deformationDisplacement;
                    particle.deformationDisplacement += g_simConstants.elasticRelaxation*diff;

                    let deviatoric = -1.0*(particle.deformationDisplacement + transpose(particle.deformationDisplacement));
                    particle.deformationDisplacement += g_simConstants.liquidViscosity*0.5*deviatoric;
                }

                // P2G


                // Iterate over local 3x3 neigbourhood
                for(var i = 0; i < 3; i++)
                {
                    for(var j = 0; j < 3; j++)
                    {
                        // Weight corresponding to this neighbourhood cell
                        let weight = weightInfo.weights[i].x * weightInfo.weights[j].y;
                        
                        // 2d index of this cell in the grid
                        let neighbourCellIndex = vec2i(weightInfo.cellIndex) + vec2i(i,j);

                        // 2d index relative to the corner of the local grid
                        let neighbourCellIndexLocal = neighbourCellIndex - localGridOrigin;

                        // Linear index in the local grid
                        let gridVertexIdx = localGridIndex(vec2u(neighbourCellIndexLocal));
                        
                        let offset = vec2f(neighbourCellIndex) - p + 0.5;

                        let weightedMass = weight * particle.mass;
                        let momentum = weightedMass * (particle.displacement +  particle.deformationDisplacement * offset);

                        atomicAdd(&s_tileDataDst[gridVertexIdx + 0], encodeFixedPoint(momentum.x, g_simConstants.fixedPointMultiplier));
                        atomicAdd(&s_tileDataDst[gridVertexIdx + 1], encodeFixedPoint(momentum.y, g_simConstants.fixedPointMultiplier));
                        atomicAdd(&s_tileDataDst[gridVertexIdx + 2], encodeFixedPoint(weightedMass, g_simConstants.fixedPointMultiplier));

                        // This is only required if we are going to mix in the grid volume to the liquid volume
                        if(g_simConstants.useGridVolumeForLiquid != 0)
                        {
                            atomicAdd(&s_tileDataDst[gridVertexIdx + 3], encodeFixedPoint(particle.volume * weight, g_simConstants.fixedPointMultiplier));
                        }
                    }
                }
            }

        }
    }

    workgroupBarrier();

    // Save Grid
    if(gridVertexIsValid)
    {
        let gridVertexAddress = gridVertexIndex(vec2u(gridVertex), g_simConstants.gridSize);

        let dxi = atomicLoad(&s_tileDataDst[tileDataIndex]);
        let dyi = atomicLoad(&s_tileDataDst[tileDataIndex+1]);
        let wi = atomicLoad(&s_tileDataDst[tileDataIndex+2]);
        let vi = atomicLoad(&s_tileDataDst[tileDataIndex+3]);

        atomicAdd(&g_gridDst[gridVertexAddress + 0], dxi);
        atomicAdd(&g_gridDst[gridVertexAddress + 1], dyi);
        atomicAdd(&g_gridDst[gridVertexAddress + 2], wi);
        atomicAdd(&g_gridDst[gridVertexAddress + 3], vi);
    }
}