//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

"use strict";

let g_timeState = {
    prevTimeMs: 0,
    timeAccumulatorMs: 0,
    estimatedRenderTimeStepMs: 1000.0/60.0,
    estimatedThrottlingRatio: 1,
    framesAboveTarget: 0,
    simFrameCountCap: 100,
}

export function doTimeRegulation(inputs)
{
    if(inputs.doPause || inputs.doReset)
    {
        g_timeState.estimatedRenderTimeStepMs = 1000.0/60.0;
        g_timeState.prevTimeMs = inputs.timeStamp - g_timeState.estimatedRenderTimeStepMs;   
        g_timeState.simFrameCountCap = 100;
        g_timeState.framesAboveTarget = 0;
        g_timeState.estimatedThrottlingRatio = 1;
        g_timeState.timeAccumulatorMs = 0;
    }

    let deltaTimeMs = (inputs.timeStamp - g_timeState.prevTimeMs);

    if(deltaTimeMs < g_timeState.estimatedRenderTimeStepMs)
    {
        g_timeState.estimatedRenderTimeStepMs = deltaTimeMs;
    }
    else if(deltaTimeMs > 2*g_timeState.estimatedRenderTimeStepMs)
    {
        g_timeState.framesAboveTarget += 1;
    }
    else
    {
        // Considered on-target
        g_timeState.framesAboveTarget = 0;
    }

    if(g_timeState.framesAboveTarget >= 10)
    {
        console.log(`Warning: throttling sim because rendering time has been above target for several frames in a row.`)
        //g_timeState.simFrameCountCap = Math.max(1, Math.floor(g_timeState.simFrameCountCap * 0.5));
        g_timeState.framesAboveTarget = 0;
    }

    g_timeState.prevTimeMs = inputs.timeStamp;

    g_timeState.timeAccumulatorMs += deltaTimeMs;

    let substepCount = Math.floor(g_timeState.timeAccumulatorMs * inputs.simRate / 1000);

    if(inputs.doPause)
    {
        substepCount = 0;
        g_timeState.timeAccumulatorMs = 0;   
    }
    else
    {
        g_timeState.timeAccumulatorMs -= 1000*(substepCount / (inputs.simRate));
    }

    g_timeState.estimatedThrottlingRatio = g_timeState.estimatedThrottlingRatio * 0.99 + 0.01*Math.min(1, g_timeState.simFrameCountCap / substepCount);

    if(substepCount > g_timeState.simFrameCountCap)
    {
        substepCount = g_timeState.simFrameCountCap;
    }

    return substepCount;
}

export function getLastRenderTimeStep() 
{
    return g_timeState.estimatedRenderTimeStepMs / 1000;
}

export function getThrottlingRatio()
{
    return g_timeState.estimatedThrottlingRatio;
}