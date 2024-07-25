//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

//!include dispatch.inc
//!include particle.inc
//!include simConstants.inc
//!include matrix.inc

@group(0) @binding(0) var<uniform> g_simConstants : SimConstants;
@group(0) @binding(1) var<storage> g_particleCount : array<u32>;
@group(0) @binding(2) var<storage, read_write> g_particles : array<Particle>;
@group(0) @binding(3) var<storage> g_grid : array<i32>;

@compute @workgroup_size(ParticleDispatchSize, 1, 1)
fn csMain( @builtin(global_invocation_id) id: vec3<u32> )
{
    if(id.x >= g_particleCount[0])
    {
        return;
    }

    var particle = g_particles[id.x];

    if(particle.enabled == 0)
    {
        return;
    }

    var p = particle.position;

    let weightInfo = quadraticWeightInit(p);

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
            let neighbourCellIndex = vec2u(vec2i(weightInfo.cellIndex) + vec2i(i,j));

            // Linear index in the buffer
            let gridVertexIdx = gridVertexIndex(neighbourCellIndex, g_simConstants.gridSize);

            let weightedDisplacement = weight * vec2f(
                decodeFixedPoint(g_grid[gridVertexIdx + 0], g_simConstants.fixedPointMultiplier),
                decodeFixedPoint(g_grid[gridVertexIdx + 1], g_simConstants.fixedPointMultiplier)
            );
            
            let offset = vec2f(neighbourCellIndex) - p + 0.5;
            B += outerProduct(weightedDisplacement, offset);
            d += weightedDisplacement;

            // This is only required if we are going to mix in the grid volume to the liquid volume
            if(g_simConstants.useGridVolumeForLiquid != 0)
            {
                volume += weight * decodeFixedPoint(g_grid[gridVertexIdx + 3], g_simConstants.fixedPointMultiplier);
            }
        }
    }

    particle.deformationDisplacement = B * 4.0;
    particle.displacement = d;
    
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

    g_particles[id.x] = particle;
}