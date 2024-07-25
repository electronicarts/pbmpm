//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

//!include dispatch.inc
//!include simConstants.inc
//!include particle.inc
//!include shapes.inc

@group(0) @binding(0) var<uniform> g_simConstants : SimConstants;
@group(0) @binding(1) var<storage, read_write> g_grid : array<i32>;
@group(0) @binding(2) var<storage> g_shapes : array<SimShape>;

@compute @workgroup_size(GridDispatchSize, GridDispatchSize)
fn csMain( @builtin(global_invocation_id) id: vec3<u32> )
{
    if(any(id.xy >= g_simConstants.gridSize))
    {
        return;
    }

    let gridVertexAddress = gridVertexIndex(id.xy, g_simConstants.gridSize);

    // Load from grid
    var dx = decodeFixedPoint(g_grid[gridVertexAddress + 0], g_simConstants.fixedPointMultiplier);
    var dy = decodeFixedPoint(g_grid[gridVertexAddress + 1], g_simConstants.fixedPointMultiplier);
    var w = decodeFixedPoint(g_grid[gridVertexAddress + 2], g_simConstants.fixedPointMultiplier);

    if(w < 1e-5f)
    {
        dx = 0;
        dy = 0;
    }

    // Perform mass weighting to get grid displacement
    dx = dx / w;
    dy = dy / w;

    var gridDisplacement = vec2f(dx, dy);


    // Collision detection against collider shapes
    for(var shapeIndex = 0u; shapeIndex < g_simConstants.shapeCount; shapeIndex++)
    {
        let shape = g_shapes[shapeIndex];

        if(shape.functionality != ShapeFunctionCollider)
        {
            continue;
        }

        let gridPosition = vec2f(id.xy);
        let displacedGridPosition = gridPosition + gridDisplacement;

        let collideResult = collide(shape, displacedGridPosition);

        if(collideResult.collides)
        {
            let gap = min(0, dot(collideResult.normal, collideResult.pointOnCollider - gridPosition));
            let penetration = dot(collideResult.normal, gridDisplacement) - gap;

            // Prevent any further penetration in radial direction
            let radialImpulse = max(penetration, 0);
            gridDisplacement -= radialImpulse*collideResult.normal;
        }
    }

    // Collision detection against guardian shape

    // Grid vertices near or inside the guardian region should have their displacenent values
    // corrected in order to prevent particles moving into the guardian.
    // We do this by finding whether a grid vertex would be inside the guardian region after displacement
    // with the current velocity and, if it is, setting the displacement so that no further penetration can occur.
    let gridPosition = vec2f(id.xy);
    let displacedGridPosition = gridPosition + gridDisplacement;
    let projectedGridPosition = projectInsideGuardian(displacedGridPosition, g_simConstants.gridSize, GuardianSize+1);
    let projectedDifference = projectedGridPosition - displacedGridPosition;

    if(projectedDifference.x != 0)
    {
        gridDisplacement.x = 0;
        gridDisplacement.y = 0;
    }

    if(projectedDifference.y != 0)
    {
        gridDisplacement.x = 0;
        gridDisplacement.y = 0;
    }

    // Save back to grid
    g_grid[gridVertexAddress + 0] = encodeFixedPoint(gridDisplacement.x , g_simConstants.fixedPointMultiplier);
    g_grid[gridVertexAddress + 1] = encodeFixedPoint(gridDisplacement.y , g_simConstants.fixedPointMultiplier);
}