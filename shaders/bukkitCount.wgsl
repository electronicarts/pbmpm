//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

//!include dispatch.inc
//!include simConstants.inc
//!include particle.inc
//!include bukkit.inc

@group(0) @binding(0) var<uniform> g_simConstants : SimConstants;
@group(0) @binding(1) var<storage> g_particleCount : array<u32>;
@group(0) @binding(2) var<storage> g_particles : array<Particle>;
@group(0) @binding(3) var<storage, read_write> g_bukkitCounts : array<atomic<u32>>;

@compute @workgroup_size(ParticleDispatchSize)
fn csMain( @builtin(global_invocation_id) id: vec3<u32> )
{
    if(id.x >= g_particleCount[0])
    {
        return;
    }

    let particle = g_particles[id.x];
    let position = particle.position;

    let particleBukkit = positionToBukkitId(position);

    if(any(particleBukkit < vec2i(0)) || u32(particleBukkit.x) >= g_simConstants.bukkitCountX || u32(particleBukkit.y) >= g_simConstants.bukkitCountY)
    {
        return;
    }

    let bukkitIndex = bukkitAddressToIndex(vec2u(particleBukkit), g_simConstants.bukkitCountX);

    atomicAdd(&g_bukkitCounts[bukkitIndex], 1);    
}