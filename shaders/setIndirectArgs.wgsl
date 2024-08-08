//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

//!include dispatch.inc

@group(0) @binding(0) var<storage> g_particleCount : array<u32>;
@group(0) @binding(1) var<storage, read_write> g_simIndirectArgs : array<u32>;
@group(0) @binding(2) var<storage, read_write> g_renderIndirectArgs : array<u32>;

@compute @workgroup_size(1)
fn csMain( @builtin(global_invocation_id) id: vec3<u32> )
{
    g_simIndirectArgs[0] = divUp(g_particleCount[0], ParticleDispatchSize);
    g_renderIndirectArgs[1] = g_particleCount[0];
}