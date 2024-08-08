//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

"use strict";

export let Shaders = {

    // MPM  shaders
    g2p2g: 'g2p2g',

    // Bukkitizing shaders
    bukkitCount: 'bukkitCount',
    bukkitAllocate: 'bukkitAllocate',
    bukkitInsert: 'bukkitInsert',

    // Other sim shaders
    particleEmit: 'particleEmit',
    setIndirectArgs: 'setIndirectArgs',

    // Rendering shaders
    particleRender: 'particleRender',
}

let g_shaderModules = {};
let g_computePipelines = {};

export async function init(device, insertHandlers)
{
    await Promise.all(Object.keys(Shaders).map(async shaderId => {
        const shaderName = Shaders[shaderId];
        const shaderCode = await getShaderText(shaderName, new Set(), insertHandlers);
        const shaderModule = device.createShaderModule({
            label: shaderName,
            code: shaderCode
            });

        const compilationInfo = await shaderModule.getCompilationInfo();

        if(compilationInfo.messages.length)
        {
            throw `Failed to compile shader [${shaderName}]`;
        }        
        g_shaderModules[shaderName] = shaderModule;
        
        if(shaderName != 'particleRender')
        {
            g_computePipelines[shaderName] = device.createComputePipeline({
                label: shaderName,
                layout: "auto",
                compute: {
                    module: shaderModule,
                    entryPoint: "csMain"
                }
            });
        }
    }))
}

export function getShaderModule(shaderId)
{
    console.assert(shaderId in g_shaderModules);
    return g_shaderModules[shaderId];
}

export function getComputePipeline(shaderId)
{
    console.assert(shaderId in g_computePipelines, `Shader [${shaderId}] has not been compiled!`);
    return g_computePipelines[shaderId];
}

// wgsl shaders are text only and we would prefer not to have
// a complex data build step for this app, so instead we do
// shader preprocessing at load time.
// This implements include and insert directives, which is currently all we need
// to enable a basic level of reusability and interoperability in wgsl code. 
async function preprocess(shaderText, includesAlreadySeen, insertHandlers)
{
    // Implement insertion
    // This is basically just simplified preprocessor defines
    const insertDirective = '//!insert'
    while(true)
    {
        const insertPosition = shaderText.search(insertDirective);
        if(insertPosition === -1)
        {
            break;
        }

        const insertStatement = shaderText.slice(insertPosition).split('\n')[0]
        const insertKey = shaderText.slice(insertPosition + insertDirective.length+1).split('\n')[0].trim();

        if(!(insertKey in insertHandlers))
        {
            throw `Could not find expected key [${insertKey}] in the list of insert handlers.`;
        }

        shaderText = shaderText.replace(insertStatement, insertHandlers[insertKey]);
    }

    // Implement text inclusion
    // Each shader has an implied include guard that means it will only
    // be copied in the first time it is encountered.
    const includeDirective = '//!include'
    while(true)
    {
        const includePosition = shaderText.search(includeDirective)
        if(includePosition === -1)
        {
            break;
        }

        const includeStatement = shaderText.slice(includePosition).split('\n')[0]
        const includedFile = shaderText.slice(includePosition + includeDirective.length + 1).split('\n')[0]

        if(includesAlreadySeen.has(includedFile))
        {
            // If we have seen this include before then collapse the include statement to nothing
            shaderText = shaderText.replace(includeStatement, '')
        }
        else
        {
            // If we have not seen this include before then add it to the database of includes already seen
            // and then load the included file and expand the include directive with it
            includesAlreadySeen.add(includedFile)
            const includedFileShaderText = await getShaderText(includedFile, includesAlreadySeen, insertHandlers)
            shaderText = shaderText.replace(includeStatement, includedFileShaderText)
        }
    }

    return shaderText;
}

// Load the text content of the shader with the given name.
async function getShaderText(shaderName, includesAlreadySeen, insertHandlers)
{
    let response = await fetch('shaders/' + shaderName + '.wgsl');
    let shaderText = await response.text();
    return preprocess(shaderText, includesAlreadySeen, insertHandlers);
}
