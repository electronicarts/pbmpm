//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

//!include dispatch.inc
//!include particle.inc
//!include simConstants.inc

@group(0) @binding(0) var<uniform> g_simConstants : SimConstants;
@group(0) @binding(1) var<storage> g_particleCount : array<u32>;
@group(0) @binding(2) var<storage> g_particles : array<Particle>;
@group(0) @binding(3) var<storage, read_write> g_grid : array<atomic<i32>>;

@compute @workgroup_size(ParticleDispatchSize, 1, 1)
fn csMain( @builtin(global_invocation_id) id: vec3<u32> )
{
    if(id.x >= g_particleCount[0])
    {
        return;
    }

    let particle = g_particles[id.x];

    if(particle.enabled == 0)
    {
        return;
    }

    var p = particle.position;
    let d = particle.displacement;
    let D = particle.deformationDisplacement;
    let m = particle.mass;

    let weightInfo = quadraticWeightInit(p);

    // Iterate over local 3x3 neigbourhood
    for(var i = 0; i < 3; i++)
    {
        for(var j = 0; j < 3; j++)
        {
            // Weight corresponding to this neighbourhood cell
            let weight = weightInfo.weights[i].x * weightInfo.weights[j].y;
            
            // 2d index of this cell in the grid
            let neighbourCellIndex = vec2u(vec2i(weightInfo.cellIndex) + vec2i(i,j));

            // Linear index in the buffer
            let gridVertexIdx = gridVertexIndex(neighbourCellIndex, g_simConstants.gridSize);
            
            let offset = vec2f(neighbourCellIndex) - p + 0.5;

            let weightedMass = weight * m;
            let momentum = weightedMass * (d +  D * offset);

            atomicAdd(&g_grid[gridVertexIdx + 0], encodeFixedPoint(momentum.x, g_simConstants.fixedPointMultiplier));
            atomicAdd(&g_grid[gridVertexIdx + 1], encodeFixedPoint(momentum.y, g_simConstants.fixedPointMultiplier));
            atomicAdd(&g_grid[gridVertexIdx + 2], encodeFixedPoint(weightedMass, g_simConstants.fixedPointMultiplier));

            // This is only required if we are going to mix in the grid volume to the liquid volume
            if(g_simConstants.useGridVolumeForLiquid != 0)
            {
                atomicAdd(&g_grid[gridVertexIdx + 3], encodeFixedPoint(particle.volume * weight, g_simConstants.fixedPointMultiplier));
            }
        }
    }
}