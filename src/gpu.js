//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

"use strict";

import * as shader from "./shader.js"

let context = {
    pipelines: {},
    maxParticleCount: 1000000,

    maxTimeStampCount: 2048,

    encoder: null,
    frameTimeStampCount: 0,
    frameTimeStampNames: {},

    movingAverageTimeStamps: {},

    timingStatsDirty: false,
    particleCountDirty: false,

    particleCount: 0,
    particleFreeCount: 0,
};

export function getGpuContext() {return context;}

export function divUp(threadCount, divisor)
{
    return Math.floor((threadCount + divisor - 1) / divisor);
}

export function createBindGroup(name, shaderName, resources)
{
    let entries = [];
    for(let i = 0; i < resources.length; ++i)
    {
        entries.push({binding: i, resource: {buffer: resources[i]}});   
    }

    return context.device.createBindGroup({
        label: name,
        layout: context.pipelines[shaderName].getBindGroupLayout(0),
        entries: entries
    });
}

export function construct4IntBuffer(name, usage, values)
{
    const buf = context.device.createBuffer({
        name: name, 
        size: 16,
        usage: usage
    })

    const valueArray = new Int32Array(4);
    valueArray.set(values);
    context.device.queue.writeBuffer(buf, 0, valueArray);

    return buf;
}

export function resetBuffers(gridSize)
{
    // Construct various small buffers used for indirect dispatch, counting and staging
    context.particleCountBuffer = construct4IntBuffer('particleCountBuffer', GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, [0,0,0,0]);
    context.particleCountStagingBuffer = construct4IntBuffer('particleCountStagingBuffer', GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, [0,0,0,0]);
    context.particleRenderDispatchBuffer = construct4IntBuffer('particleRenderDispatchBuffer', GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.INDIRECT, [6,0,0,0]);
    context.particleSimDispatchBuffer = construct4IntBuffer('particleSimDispatchBuffer', GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST, [0,1,1,0]);
    context.particleFreeCountStagingBuffer = construct4IntBuffer('particleFreeCountStagingBuffer', GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, [0,0,0,0]);

    // Construct particle buffer.
    // Must be kept in sync with MPMParticle in particle.inc.wgsl
    const particleFloatCount = 25;

    context.particleBuffer = context.device.createBuffer({
        label: "particles",
        size: context.maxParticleCount * 4 * particleFloatCount,
        usage: GPUBufferUsage.STORAGE
    });

    context.particleFreeIndicesBuffer = context.device.createBuffer({
        label: 'freeIndices',
        size: 4 + context.maxParticleCount * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    context.gridBuffers = [];

    for(let i = 0; i < 3; ++i)
    {
        context.gridBuffers.push(context.device.createBuffer({
            label: `gridBuffer${i}`,
            size: gridSize[0] * gridSize[1] * 4 * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        }));
    }
}

export function beginFrame()
{
    context.frameTimeStampCount = 0;
    context.frameTimeStampNames = {};
    context.encoder = context.device.createCommandEncoder();
}

export function endFrame()
{
    const canReadbackParticleCount = context.particleCountStagingBuffer.mapState === 'unmapped';
    const canReadbackParticleFreeCount = context.particleFreeCountStagingBuffer.mapState === 'unmapped';
    const canReadbackTimeStamps = context.canTimeStamp && context.timeStampResultBuffer.mapState === 'unmapped';
    
    if(canReadbackParticleCount)
    {
        context.encoder.copyBufferToBuffer(context.particleCountBuffer, 0, context.particleCountStagingBuffer, 0, 4);
    }

    if(canReadbackParticleFreeCount)
    {
        context.encoder.copyBufferToBuffer(context.particleFreeIndicesBuffer, 0, context.particleFreeCountStagingBuffer, 0, 4);
    }

    if(canReadbackTimeStamps)
    {
        context.encoder.resolveQuerySet(context.timeStampQuerySet, 0, context.frameTimeStampCount, context.timeStampResolveBuffer, 0);

        context.encoder.copyBufferToBuffer(context.timeStampResolveBuffer, 0, context.timeStampResultBuffer, 0, context.timeStampResultBuffer.size);
    }

    context.device.queue.submit([context.encoder.finish()]);

    if(canReadbackParticleCount)
    {
        readbackParticleCount();
    }

    if(canReadbackParticleFreeCount)
    {
        readbackParticleFreeCount();
    }

    if(canReadbackTimeStamps)
    {
        readbackTimeStamps();
    }

    context.encoder = null;
}

// Helper function to dispatch a compute shader with the given name, resources
// and dispatch size.
// if GroupCount is an array then a regular dispatch is done, otherwise
// it is bound as an indirect buffer and an indirect dispatch is done.
export function computeDispatch(shaderName, resources, groupCount)
{
    // Construct array of resources in the required format for
    // creating a bind group
    let entries = []

    var isSimpleFlatBufferList = true;
    var isNestedBufferList = true;
    for(let i = 0; i < resources.length; ++i)
    {
        if(!resources[i])
        {
            throw `Compute Dispatch [${shaderName}]: Resource at index ${i} was falsy!`
        }
        if(!(resources[i] instanceof GPUBuffer))
        {
            isSimpleFlatBufferList = false;
        }
        if(Array.isArray(resources[i]))
        {
            for(let j = 0; j < resources[i].length; ++j)
            {
                if(!resources[i][j])
                {
                    throw `Compute Dispatch [${shaderName}]: Resource at group ${i} index ${j} was falsy!`
                }
                if(!(resources[i][j] instanceof GPUBuffer))
                {
                    isNestedBufferList = false;
                }
            }
        }
    }

    if(!isSimpleFlatBufferList && !isNestedBufferList)
    {
        throw `Expected resources to be an array of resources OR an array of arrays of resources.`;
    }

    if(isSimpleFlatBufferList)
    {
        entries.push([])
        for(let i = 0; i < resources.length; ++i)
        {
            entries[0].push({binding: i, resource: {buffer: resources[i]}});
        }
    }
    else if(isNestedBufferList)
    {
        for(let i = 0; i < resources.length; ++i)
        {
            let thisGroupEntries = []
    
            for(let j = 0; j < resources[i].length; ++j)
            {
                if(!resources[i][j])
                {
                    throw `Compute Dispatch [${shaderName}]: Resource at group ${i} index ${j} was falsy!`
                }
        
                thisGroupEntries.push({binding: j, resource: {buffer: resources[i][j]}});
            }
    
            entries.push(thisGroupEntries);
        }
    }

    const pipeline = shader.getComputePipeline(shaderName);
    
    const computePass = context.encoder.beginComputePass({
        label: shaderName,
        ...(context.canTimeStamp && {
            timestampWrites: {
                querySet: context.timeStampQuerySet,
                beginningOfPassWriteIndex: context.frameTimeStampCount,
                endOfPassWriteIndex: context.frameTimeStampCount + 1
            }
        })
    });
    computePass.setPipeline(pipeline);

    for(let i = 0; i < entries.length; ++i)
    {
        const bindGroup = context.device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: entries[i]});
        computePass.setBindGroup(i, bindGroup);
    }

    if(Array.isArray(groupCount))
    {
        computePass.dispatchWorkgroups(groupCount[0], groupCount[1], groupCount[2]);
    }
    else
    {
        computePass.dispatchWorkgroupsIndirect(groupCount, 0);
    }
    computePass.end()

    if(context.canTimeStamp)
    {
        if(shaderName in context.frameTimeStampNames)
        {
            context.frameTimeStampNames[shaderName].push(context.frameTimeStampCount);
        }
        else
        {
            context.frameTimeStampNames[shaderName] = [context.frameTimeStampCount];
        }

        context.frameTimeStampCount += 2;
    }
}

// Try to initialize webgpu device and set up the basic objects.
// This may fail on some browsers like Firefox, in which case we put a message in the dom.
// It may also fail if the browser has blacklisted webgpu due to previously going OOM.
// If this happens then it may be necessary to restart the whole program.
export async function init(insertHandlers)
{
    context.insertHandlers = insertHandlers;

    // Initialize device
    if (!navigator.gpu) {
        throw "WebGPU not supported on this browser.";
    }

    context.adapter = await navigator.gpu.requestAdapter();
    if (!context.adapter) {
        throw "No appropriate GPUAdapter found.";
    }

    context.canTimeStamp = context.adapter.features.has('timestamp-query');

    if(!context.canTimeStamp)
    {
        console.warn('This WebGPU implementation does not support timestamp queries. Timing info will not be available.');
    }

    context.device = await context.adapter.requestDevice({
        requiredFeatures: context.canTimeStamp ? [
             ['timestamp-query']
        ] : undefined
    });
    
    await shader.init(context.device, insertHandlers);

    // Set back buffer pixel format
    context.context = document.getElementById('canvas').getContext("webgpu", {alpha: true});
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.context.configure({
        device: context.device,
        format: canvasFormat,
        alphaMode: 'premultiplied'
    });

    // Load the particle rendering module
    const renderShaderModule = shader.getShaderModule(shader.Shaders.particleRender);

    // Construct pipeline for particle rendering
    context.pipelines['particleRender'] = context.device.createRenderPipeline({
        label: "Render Pipeline",
        layout: "auto",
        vertex: {
            module: renderShaderModule,
            entryPoint: "vertexMain",
            buffers: []
        },
        fragment: {
            module: renderShaderModule,
            entryPoint: "fragmentMain",
            targets: [{
            format: canvasFormat,
            blend: {
                alpha: {
                    dstFactor: 'one-minus-src-alpha',
                    srcFactor: 'src-alpha',
                    operation: 'add'
                },
                color: {
                    dstFactor: 'one-minus-src-alpha',
                    srcFactor: 'src-alpha',
                    operation: 'add'
                }
            }
            }]
        },
    });    

    if(context.canTimeStamp)
    {
        context.timeStampQuerySet = context.device.createQuerySet({
            type: 'timestamp',
            count: context.maxTimeStampCount*2 // Begin and end
        });

        context.timeStampResolveBuffer = context.device.createBuffer({
            size: context.timeStampQuerySet.count * 8, // Timestamps are uint64
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
        });

        context.timeStampResultBuffer = context.device.createBuffer({
            size: context.timeStampQuerySet.count * 8,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
    }
}

// Initiate readback of the particle count staging buffer.
function readbackParticleCount()
{
    context.particleCountStagingBuffer.mapAsync(GPUMapMode.READ, 0, 16).then(() => {
        const buf = context.particleCountStagingBuffer.getMappedRange(0, 16);
        const view = new Int32Array(buf);
        context.particleCount = view[0];
        context.particleCount = Math.min(context.maxParticleCount, context.particleCount);
        context.particleCountStagingBuffer.unmap();
        context.particleCountDirty = true;
    });
}

function readbackParticleFreeCount()
{
    context.particleFreeCountStagingBuffer.mapAsync(GPUMapMode.READ, 0, 16).then(() => {
        const buf = context.particleFreeCountStagingBuffer.getMappedRange(0, 16);
        const view = new Int32Array(buf);
        context.particleFreeCount = view[0];
        context.particleFreeCountStagingBuffer.unmap();
        context.particleCountDirty = true;
    });
}

function readbackTimeStamps()
{
    context.timeStampResultBuffer.mapAsync(GPUMapMode.READ).then(() => {
        const times = new BigInt64Array(context.timeStampResultBuffer.getMappedRange());

        var movingAverageTimeStamps = {};


        for(const name of Object.keys(context.frameTimeStampNames))
        {
            var total = 0;
            for(const index of context.frameTimeStampNames[name])
            {
                total += Number(times[index+1] - times[index]);
            }

            movingAverageTimeStamps[name] = total;
        }
        context.timeStampResultBuffer.unmap();

        for(const name of Object.keys(movingAverageTimeStamps))
        {
            if(name in context.movingAverageTimeStamps)
            {
                movingAverageTimeStamps[name] = 0.01*movingAverageTimeStamps[name] + 0.99*context.movingAverageTimeStamps[name]
            }
        }

        context.movingAverageTimeStamps = movingAverageTimeStamps;

        context.timingStatsDirty = true;
    });
}