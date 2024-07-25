//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

// Must be kept in sync with definition in gpu.js
struct Particle
{
    position : vec2f,
    displacement : vec2f,
    deformationGradient : mat2x2f,
    deformationDisplacement : mat2x2f,
    
    liquidDensity : f32,
    mass : f32,
    material : f32,
    volume: f32,

    lambda: f32,
    logJp : f32,
    color: vec3f,
    enabled: f32,
};

// For safety, we keep particles `guardianSize` cells away from the outside of the domain.
// To implement this we clamp the grid values to ensure they do not contribute towards moving
// particles outside the domain, and additionally clamp particle positions whenever they are moved.
fn projectInsideGuardian(p : vec2f, gridSize : vec2u, guardianSize : f32) -> vec2f
{
    let clampMin = vec2f(guardianSize);
    let clampMax = vec2f(gridSize) - vec2f(guardianSize,guardianSize) - vec2f(1,1);

    return clamp(p, vec2f(clampMin), vec2f(clampMax));
}

fn insideGuardian(id: vec2u, gridSize: vec2u, guardianSize: u32) -> bool
{
    if(id.x <= guardianSize) {return false;}
    if(id.x >= (gridSize.x-guardianSize-1)) {return false;}
    if(id.y <= guardianSize) {return false;}
    if(id.y >= gridSize.y-guardianSize-1) {return false;}

    return true;
}

struct QuadraticWeightInfo
{
    weights: array<vec2f, 3>,
    cellIndex: vec2f,
}

fn pow2(x: vec2f) -> vec2f
{
    return x*x;
}

fn quadraticWeightInit(position: vec2f) -> QuadraticWeightInfo
{
    let roundDownPosition = floor(position);
    let offset = (position - roundDownPosition) - 0.5;
    return QuadraticWeightInfo(
        array(
        0.5 * pow2(0.5 - offset),
        0.75 - pow2(offset),
        0.5 * pow2(0.5 + offset)
        ),
        roundDownPosition - 1,
    );
}

fn pow3(x: vec2f) -> vec2f
{
    return x*x*x;
}

struct CubicWeightInfo
{
    weights: array<vec2f, 4>,
    cellIndex: vec2f
};

fn cubicWeightInit(position: vec2f) -> CubicWeightInfo
{
    let roundDownPosition = floor(position);
    let offset = position - roundDownPosition;

    return CubicWeightInfo(
        array(
            pow3(2.0 - (1+offset))/6.0,
            0.5*pow3(offset) - pow2(offset) + 2.0/3.0,
            0.5*pow3(1 - offset) - pow2(1 - offset) + 2.0/3.0,
            pow3(2.0 - (2 - offset))/6.0,
        ),
        roundDownPosition - 1
    );
}
