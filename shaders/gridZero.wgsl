//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

//!include dispatch.inc
//!include simConstants.inc

@group(0) @binding(0) var<uniform> g_simConstants : SimConstants;
@group(0) @binding(1) var<storage, read_write> g_grid : array<i32>;

@compute @workgroup_size(GridDispatchSize, GridDispatchSize)
fn csMain( @builtin(global_invocation_id) id: vec3<u32> )
{
    if(any(id.xy >= g_simConstants.gridSize))
    {
        return;
    }

    let gridVertexAddress = gridVertexIndex(id.xy, g_simConstants.gridSize);

    g_grid[gridVertexAddress + 0] = 0;
    g_grid[gridVertexAddress + 1] = 0;
    g_grid[gridVertexAddress + 2] = 0;
    g_grid[gridVertexAddress + 3] = 0;
}