//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

"use strict";

import * as time from "./time.js"
import * as gpu from "./gpu.js"
import * as buffer_factory from "./buffer_factory.js"
import * as v from "./v.js"
import {Shaders} from "./shader.js"

export const DispatchSizes = {
    ParticleDispatchSize: 64,
    GridDispatchSize: 8,
    BukkitSize: 6,
    BukkitHaloSize: 1,
};

export const SimEnums = {
    SolverTypePBMPM: 1,

    MouseFunctionPush: 0,
    MouseFunctionGrab: 1,

    MaterialLiquid: 0,
    MaterialElastic: 1,
    MaterialSand: 2,
    MaterialVisco: 3,

    GuardianSize: 3,

    ShapeTypeBox: 0,
    ShapeTypeCircle: 1,

    ShapeFunctionEmit: 0,
    ShapeFunctionCollider: 1,
    ShapeFunctionDrain: 2,
    ShapeFunctionInitialEmit: 3,

};

export const RenderEnums = {
    RenderModeStandard: 0,
    RenderModeCompression: 1,
    RenderModeVelocity: 2,
};

let g_simFactory;
let g_shapeFactory;
let g_substepIndex = 0;

export function init(insertHandlers)
{
    // Specify the contents of the sim uniform buffer.
    // This allows us to connect UI controls through to the gpu
    const simFactory = new buffer_factory.BufferFactory('SimConstants', buffer_factory.Uniform);

    simFactory.add('gridSize', buffer_factory.vec2u);
    simFactory.add('deltaTime', buffer_factory.f32);
    simFactory.add('mouseActivation', buffer_factory.f32);

    simFactory.add('mousePosition', buffer_factory.vec2f);
    simFactory.add('mouseVelocity', buffer_factory.vec2f);

    simFactory.add('mouseFunction', buffer_factory.f32);
    simFactory.add('elasticityRatio', buffer_factory.f32);
    simFactory.add('gravityStrength', buffer_factory.f32);

    simFactory.add('liquidRelaxation', buffer_factory.f32);
    simFactory.add('elasticRelaxation', buffer_factory.f32);
    simFactory.add('liquidViscosity', buffer_factory.f32);
    simFactory.add('fixedPointMultiplier', buffer_factory.u32);

    simFactory.add('useGridVolumeForLiquid', buffer_factory.u32);
    simFactory.add('particlesPerCellAxis', buffer_factory.u32);

    simFactory.add('frictionAngle', buffer_factory.f32);
    simFactory.add('plasticity', buffer_factory.f32);
    simFactory.add('mouseRadius', buffer_factory.f32);

    simFactory.add('shapeCount', buffer_factory.u32);
    simFactory.add('simFrame', buffer_factory.u32);
    simFactory.add('bukkitCount', buffer_factory.u32);
    simFactory.add('bukkitCountX', buffer_factory.u32);
    simFactory.add('bukkitCountY', buffer_factory.u32);
    simFactory.add('iteration', buffer_factory.u32);
    simFactory.add('iterationCount', buffer_factory.u32);

    simFactory.compile();

    const shapeFactory = new buffer_factory.BufferFactory('SimShape', buffer_factory.Storage);

    shapeFactory.add('position', buffer_factory.vec2f);
    shapeFactory.add('halfSize', buffer_factory.vec2f);

    shapeFactory.add('radius', buffer_factory.f32);
    shapeFactory.add('rotation', buffer_factory.f32);
    shapeFactory.add('functionality', buffer_factory.f32);
    shapeFactory.add('shapeType', buffer_factory.f32);

    shapeFactory.add('emitMaterial', buffer_factory.f32);
    shapeFactory.add('emissionRate', buffer_factory.f32);
    shapeFactory.add('emissionSpeed', buffer_factory.f32);
    shapeFactory.add('padding', buffer_factory.f32);
    shapeFactory.compile();

    function enumInsertHandler(enumValues)
    {
        let insertedText = "";
        for(const key of Object.keys(enumValues))
        {
            insertedText += `const ${key} = ${enumValues[key]};\n`;
        }
        return insertedText;
    }   
    insertHandlers["SimEnums"] = enumInsertHandler(SimEnums);
    insertHandlers["RenderEnums"] = enumInsertHandler(RenderEnums);
    insertHandlers["DispatchSizes"] = enumInsertHandler(DispatchSizes);
    insertHandlers[simFactory.name] = simFactory.getShaderText();
    insertHandlers[shapeFactory.name] = shapeFactory.getShaderText();

    g_simFactory = simFactory;
    g_shapeFactory = shapeFactory;
}

function doEmission(gpuContext, simUniformBuffer, inputs, shapeBuffer)
{
    const threadGroupCountX = gpu.divUp(inputs.gridSize[0], DispatchSizes.GridDispatchSize);
    const threadGroupCountY = gpu.divUp(inputs.gridSize[1], DispatchSizes.GridDispatchSize);
    const gridThreadGroupCounts = [threadGroupCountX, threadGroupCountY, 1];

    gpu.computeDispatch(Shaders.particleEmit, [simUniformBuffer, gpuContext.particleCountBuffer, gpuContext.particleBuffer, shapeBuffer, gpuContext.particleFreeIndicesBuffer], gridThreadGroupCounts);
    gpu.computeDispatch(Shaders.setIndirectArgs, [gpuContext.particleCountBuffer, gpuContext.particleSimDispatchBuffer, gpuContext.particleRenderDispatchBuffer], [1,1,1]);
}

function bukkitizeParticles(gpuContext, simUniformBuffer, bukkitSystem)
{
    gpuContext.encoder.clearBuffer(bukkitSystem.countBuffer);
    gpuContext.encoder.clearBuffer(bukkitSystem.countBuffer2);
    gpuContext.encoder.clearBuffer(bukkitSystem.threadData);
    gpuContext.encoder.clearBuffer(bukkitSystem.particleData);
    gpuContext.encoder.clearBuffer(bukkitSystem.particleAllocator);
    gpuContext.encoder.copyBufferToBuffer(bukkitSystem.blankDispatch, 0, bukkitSystem.dispatch, 0, bukkitSystem.dispatch.size);

    gpu.computeDispatch(Shaders.bukkitCount, [simUniformBuffer, gpuContext.particleCountBuffer, gpuContext.particleBuffer, bukkitSystem.countBuffer], gpuContext.particleSimDispatchBuffer);

    let bukkitDispatchSize = [
        gpu.divUp(bukkitSystem.countX, DispatchSizes.GridDispatchSize),
        gpu.divUp(bukkitSystem.countY, DispatchSizes.GridDispatchSize),
        1
    ];

    gpu.computeDispatch(Shaders.bukkitAllocate, [simUniformBuffer, bukkitSystem.countBuffer, bukkitSystem.dispatch, bukkitSystem.threadData, bukkitSystem.particleAllocator, bukkitSystem.indexStart], bukkitDispatchSize);
    gpu.computeDispatch(Shaders.bukkitInsert, [simUniformBuffer, gpuContext.particleCountBuffer, bukkitSystem.countBuffer2, gpuContext.particleBuffer, bukkitSystem.particleData, bukkitSystem.indexStart], gpuContext.particleSimDispatchBuffer);
}

export function update(gpuContext, inputs)
{
    if(inputs.doReset)
    {
        g_substepIndex = 0;
    }

    let bufferIdx = 0;
    for(var i = 0; i < 3; ++i)
    {
        gpuContext.encoder.clearBuffer(gpuContext.gridBuffers[i]);
    }

    const shapeBuffer = constructShapeBuffer(gpuContext, inputs);
    const bukkitSystem = constructBukkitSystem(gpuContext, inputs);

    const substepCount = time.doTimeRegulation(inputs);
    for(let substepIdx = 0; substepIdx < substepCount; ++substepIdx)
    {
        var simUniformBuffer = constructSimUniformBuffer(gpuContext, inputs, bukkitSystem, 0);
        doEmission(gpuContext, simUniformBuffer, inputs, shapeBuffer);
        bukkitizeParticles(gpuContext, simUniformBuffer, bukkitSystem);

        for(let iterationIdx = 0; iterationIdx < inputs.iterationCount; ++iterationIdx)
        {
            simUniformBuffer = constructSimUniformBuffer(gpuContext, inputs, bukkitSystem, iterationIdx);

            const currentGrid = gpuContext.gridBuffers[bufferIdx]
            const nextGrid = gpuContext.gridBuffers[(bufferIdx + 1)%3]
            const nextNextGrid = gpuContext.gridBuffers[(bufferIdx + 2)%3]
            bufferIdx = (bufferIdx + 1) % 3;

            gpu.computeDispatch(Shaders.g2p2g, [simUniformBuffer, gpuContext.particleBuffer, currentGrid, nextGrid, nextNextGrid, bukkitSystem.threadData, bukkitSystem.particleData, shapeBuffer, gpuContext.particleFreeIndicesBuffer], bukkitSystem.dispatch)
        }

        g_substepIndex = (g_substepIndex + 1);
    }  
}

function constructBukkitSystem(gpuContext, inputs) {
    const bukkitCountX = Math.ceil(inputs.gridSize[0] / DispatchSizes.BukkitSize);
    const bukkitCountY = Math.ceil(inputs.gridSize[1] / DispatchSizes.BukkitSize);

    console.log(`Bukkit count: ${bukkitCountX * bukkitCountY}`);

    const bukkitParticleCountBuffer = gpuContext.device.createBuffer({
        label: "bukkitParticleCountBuffer",
        size: bukkitCountX * bukkitCountY * 4, // One integer count per bukkit
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    const bukkitParticleCountBuffer2 = gpuContext.device.createBuffer({
        label: "bukkitParticleCountBuffer2",
        size: bukkitCountX * bukkitCountY * 4, // One integer count per bukkit
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    const bukkitParticleThreadData = gpuContext.device.createBuffer({
        label: "bukkitParticleThreadData",
        size: 10 * bukkitCountX * bukkitCountY * 4 * 4, // four integers per allocated bukkit thread group
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    const bukkitParticleData = gpuContext.device.createBuffer({
        label: 'bukkitParticleData',
        size: gpuContext.maxParticleCount * 4, // One integer per particle
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    })

    const bukkitParticleDispatchBuffer = gpu.construct4IntBuffer(
        'bukkitParticleDispatchBuffer', 
        GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
        [0,1,1,0]
    );

    const blankDispatchBuffer = gpu.construct4IntBuffer(
        'blankDispatchBuffer', 
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        [0,1,1,0]
    );

    const bukkitParticleAllocator = gpu.construct4IntBuffer(
        'bukkitParticleAllocator',
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        [0, 0, 0, 0]
    );

    const bukkitIndexStart = gpuContext.device.createBuffer({
        label: 'bukkitIndexStart',
        size: bukkitCountX * bukkitCountY * 4,
        usage: GPUBufferUsage.STORAGE
    });

    return {
        countX: bukkitCountX,
        countY: bukkitCountY,
        count: bukkitCountX*bukkitCountY,
        countBuffer: bukkitParticleCountBuffer,
        countBuffer2: bukkitParticleCountBuffer2,
        particleData: bukkitParticleData,
        threadData: bukkitParticleThreadData,
        dispatch: bukkitParticleDispatchBuffer,
        blankDispatch: blankDispatchBuffer,
        particleAllocator: bukkitParticleAllocator,
        indexStart: bukkitIndexStart
    }
}

function constructSimUniformBuffer(gpuContext, inputs, bukkitSystem, iteration)
{
    let mouseActivation = 0;
    if(inputs.isMouseDown)
    {
        mouseActivation = 500/inputs.simRate * (inputs.gridSize[0]/128);
    }

    let mousePosition = [
        inputs.gridSize[0] * ((inputs.mousePosition[0] / inputs.resolution[0])),
        inputs.gridSize[1] * (1 - (inputs.mousePosition[1] / inputs.resolution[1])),
    ];

    let mousePrevPosition = [
        inputs.gridSize[0] * ((inputs.mousePrevPosition[0] / inputs.resolution[0])),
        inputs.gridSize[1] * (1 - (inputs.mousePrevPosition[1] / inputs.resolution[1])),
    ];

    let mouseVelocity = [
        (mousePosition[0] - mousePrevPosition[0])/time.getLastRenderTimeStep(),
        (mousePosition[1] - mousePrevPosition[1])/time.getLastRenderTimeStep(),
    ]

    // Update values that must be set directly
    const setDirectlyValues = {
        deltaTime: 1.0/inputs.simRate,
        mouseActivation: mouseActivation,
        mousePosition: mousePosition,
        mouseVelocity: mouseVelocity,
        fixedPointMultiplier: Math.ceil(Math.pow(10, inputs.fixedPointMultiplierExponent)),
        rho_zero: Math.pow(inputs.particlesPerCellAxis, 2)*inputs.rhoZeroMultiplier,
        mouseRadius: inputs.mouseRadius/inputs.simResDivisor,
        shapeCount: inputs.shapes.size,
        simFrame: g_substepIndex,
        bukkitCount: bukkitSystem.count,
        bukkitCountX: bukkitSystem.countX,
        bukkitCountY: bukkitSystem.countY,
        iteration: iteration,
        iterationCount: inputs.iterationCount,
    };

    return g_simFactory.constructUniformBuffer(gpuContext.device, [inputs, setDirectlyValues, gpuContext]);
}

function constructShapeBuffer(gpuContext, inputs)
{
    let solverShapes = []

    const renderToSimScale = 1.0/inputs.simResDivisor;

    for(const shape of inputs.shapes)
    {
        var scaledPosition = v.mulScalar(shape.position, renderToSimScale);
        scaledPosition.y = inputs.gridSize[1] - scaledPosition.y;

        if(shape.shape == SimEnums.ShapeTypeCircle)
        {
            solverShapes.push({
                position: scaledPosition.toArray(),
                halfSize: [0,0],
                radius: shape.radius / inputs.simResDivisor,
                rotation: shape.rotation,
                shapeType: shape.shape,
                functionality: shape.function,
                emitMaterial: shape.emitMaterial ? shape.emitMaterial : 0,
                emissionRate: shape.emissionRate ? shape.emissionRate : 0,
                emissionSpeed: shape.emissionSpeed ? shape.emissionSpeed : 0,
                friction: shape.friction ? shape.friction : 0
            });
        }
        else if(shape.shape == SimEnums.ShapeTypeBox)
        {
            solverShapes.push({
                position: scaledPosition.toArray(),
                halfSize: v.mulScalar(shape.halfSize, renderToSimScale).toArray(),
                radius: 0,
                rotation: shape.rotation,
                shapeType: shape.shape,
                functionality: shape.function,
                emitMaterial: shape.emitMaterial ? shape.emitMaterial : 0,
                emissionRate: shape.emissionRate ? shape.emissionRate : 0,
                emissionSpeed: shape.emissionSpeed ? shape.emissionSpeed : 0,
            })
        }
    }


    return g_shapeFactory.constructStorageBuffer(gpuContext.device, solverShapes);
}