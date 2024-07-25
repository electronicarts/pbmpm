//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

"use strict";

import * as gpu from "./gpu.js"
import * as buffer_factory from "./buffer_factory.js"

let g_renderFactory;

export function init(insertHandlers)
{
    // Specify the contents of the render uniform buffer.
    const renderFactory = new buffer_factory.BufferFactory('RenderConstants', buffer_factory.Uniform);
    renderFactory.add('particleRadiusTimestamp', buffer_factory.vec2f);
    renderFactory.add('canvasSize', buffer_factory.vec2f);

    renderFactory.add('viewPos', buffer_factory.vec2f);
    renderFactory.add('viewExtent', buffer_factory.vec2f);

    renderFactory.add('renderMode', buffer_factory.f32);
    renderFactory.add('deltaTime', buffer_factory.f32);
    renderFactory.compile();

    insertHandlers[renderFactory.name] = renderFactory.getShaderText();

    g_renderFactory = renderFactory;
}

function constructRenderUniformBuffer(gpuContext, inputs)
{
    let viewPos = [inputs.gridSize[0] / 2 , inputs.gridSize[1]/2];

    // This causes some trouble with shape coordinates so not doing it for now
    // Shrink the view to remove the empty border consisting of guardian cells
    // let viewExtent = [
    //     viewPos[0] - SimEnums.GuardianSize,
    //     viewPos[1] - SimEnums.GuardianSize,
    // ]

    let viewExtent = viewPos;

    // Update values that must be set directly
    const setDirectlyValues = {
        particleRadiusTimestamp: [0.5, 0],
        canvasSize: inputs.resolution,
        viewPos: viewPos,
        viewExtent: viewExtent,
        deltaTime: 1.0/inputs.simRate,
    };

    return g_renderFactory.constructUniformBuffer(gpuContext.device, [inputs, setDirectlyValues]);
}

export function update(gpuContext, inputs)
{
    let renderUniformBuffer = constructRenderUniformBuffer(gpuContext, inputs);

    const renderingBindGroup = gpu.createBindGroup("Rendering Bind Group", 'particleRender', [renderUniformBuffer, gpuContext.particleBuffer])

    const renderPass = gpuContext.encoder.beginRenderPass({
        colorAttachments: [{
            view: gpuContext.context.getCurrentTexture().createView(),
            clearValue: [0,0,0,0],
            loadOp: "clear",
            storeOp: "store",
        }]
    });

    renderPass.setPipeline(gpuContext.pipelines['particleRender']);
    renderPass.setBindGroup(0, renderingBindGroup);
    renderPass.drawIndirect(gpuContext.particleRenderDispatchBuffer, 0);
    renderPass.end();
}