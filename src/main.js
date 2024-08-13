//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

"use strict";

import * as ui from "./ui.js"
import * as gpu from "./gpu.js"
import * as sim from "./sim.js"
import {getThrottlingRatio} from "./time.js"
import * as render from "./render.js"

let g_prevInputs;

let g_loading = true;
let g_uiIsHidden = true;
let g_reset = true;
let g_pause = false;

let g_mouseRadius = 100;

let g_manifest;

init();

function init()
{
    // Build list of insert handlers.
    // An insert handler is just a KVP that can substitute a //!insert directive
    // in a wgsl shader.
    let insertHandlers = {};

    // Setup the UI sidebar
    ui.init(() => {g_reset = true;}, () => {g_pause = !g_pause;});

    loadScenes()

    // Setup sim.
    // Sim will add to the list of insert handlers.
    sim.init(insertHandlers);

    // Setup rendering.
    // Rendering will add to the list of insert handlers.
    render.init(insertHandlers);

    // Initialize gpu subsystem.
    // This consumes the insert handlers.
    gpu.init(insertHandlers).then(() => {
        // Cache initial input state
        g_prevInputs = ui.getInputs();
        g_prevInputs.scenario = -1;

        g_loading = false;
        document.getElementById('ui').style = 'left:-20%';
        document.getElementById('main').style = '';
        document.getElementById('loadingContainer').style = 'display:none'

    }).catch((e) => {
        console.error(`Caught error while initializing WebGPU: [${e}]`)
        g_loading = false;
        document.getElementById('loadingText').style = 'display:none'
        document.getElementById('errorText').innerHTML = `<div class='input'>An error occurred when initializing WebGPU:<br><div style="color:red;">${e}<br></div>Please see the console for details.</div>`
    });

    // Setup key callbacks
    document.onkeydown = function(e) 
    {
        if(e.key =='`')
        {
            toggleUI();
        }
        if(e.key === ' ')
        {
            e.preventDefault();
            g_pause = !g_pause;
        }
        if(e.key === 'F5')
        {
            e.preventDefault();
            g_reset = true;
        }
        if(e.key === 'd' && e.ctrlKey)
        {
            console.log('duplicate');
            e.preventDefault();
            ui.duplicateShape();
        }
        if(e.key === 'Delete')
        {
            e.preventDefault();
            ui.deleteShape();
        }
        if(e.key === 'Tab')
        {
            e.preventDefault();
            cycleScene();
        }
    };

    document.addEventListener('wheel', event => {
        if(ui.g_isMouseDown)
        {
            g_mouseRadius *= Math.pow(1.1, event.wheelDelta/120);
        }
    });

    document.getElementById('uiButton').addEventListener('click', toggleUI);

    const settingsTabButton = document.getElementById('settingsTabButton');
    const shapesTabButton = document.getElementById('shapesTabButton');
    const performanceTabButton = document.getElementById('performanceTabButton');

    const settingsTabContent = document.getElementById('settingsTabContent');
    const shapesTabContent = document.getElementById('shapesTabContent');
    const performanceTabContent = document.getElementById('performanceTabContent');

    settingsTabButton.addEventListener('click', () => {
        settingsTabContent.style.display = '';
        shapesTabContent.style.display = 'none';
        performanceTabContent.style.display = 'none';
    })

    shapesTabButton.addEventListener('click', () => {
        settingsTabContent.style.display = 'none';
        shapesTabContent.style.display = '';
        performanceTabContent.style.display = 'none';
    })

    performanceTabButton.addEventListener('click', () => {
        settingsTabContent.style.display = 'none';
        shapesTabContent.style.display = 'none';
        performanceTabContent.style.display = '';
    })

    document.getElementById('saveSceneButton').addEventListener('click', saveScene);
    document.getElementById('newSceneButton').addEventListener('click', newScene);


    // Start render loop
    window.requestAnimationFrame(mainUpdate);
}

function toggleUI()
{
    g_uiIsHidden = !g_uiIsHidden;
    document.getElementById('ui').style.left = g_uiIsHidden ? '-20%' : 0;
}

function mainUpdate(timeStamp)
{
    if(g_loading)
    {
        updateLoading();
    }
    else
    {
        const inputs = updateInputs();
        inputs.timeStamp = timeStamp;
    
        const gpuContext = gpu.getGpuContext();
    
        updateDom(gpuContext, inputs);

        gpu.beginFrame();

        if(inputs.doReset)
            gpu.resetBuffers(inputs.gridSize);
        
        sim.update(gpuContext, inputs);    
        render.update(gpuContext, inputs);
        gpu.endFrame();

        ui.update(inputs, g_uiIsHidden);
    }

    window.requestAnimationFrame(mainUpdate);
}

function updateInputs()
{
    let inputs = ui.getInputs();

    const scenarioChanged = inputs.scenario != g_prevInputs.scenario;
    if(scenarioChanged)
    {
        ui.clearShapes();
        document.getElementById('shapesList').innerHTML = '';
        loadSceneFromManifestIndex(inputs.scenario).then(() => {g_reset = true});
    }

    if(inputs.simResDivisor != g_prevInputs.simResDivisor
        || inputs.addLiquid != g_prevInputs.addLiquid
        || inputs.addElastic != g_prevInputs.addElastic
        || inputs.particlesPerCellAxis != g_prevInputs.particlesPerCellAxis
        || (inputs.solverType === sim.SimEnums.SolverTypePositionBasedFluids && inputs.solverType != g_prevInputs.solverType)
        || inputs.gridSize[0] != g_prevInputs.gridSize[0]
        || inputs.gridSize[1] != g_prevInputs.gridSize[1]
    ) {
        ui.windowResize();
        g_reset = true;
    }

    // Refresh inputs to reflect new grid sizes
    inputs = ui.getInputs();

    inputs.doReset = g_reset;
    inputs.doPause = g_pause;
    inputs.mousePrevPosition = g_prevInputs.mousePosition;
    inputs.mouseRadius = g_mouseRadius;

    g_reset = false;

    g_prevInputs = inputs;
    return inputs;
}

function updateDom(gpuContext, inputs)
{
    // Update dom to reflect state of grid and particle buffer
    document.getElementById('gridStats').innerHTML = `Render resolution: ${inputs.resolution[0]} x ${inputs.resolution[1]} <br>Sim resolution: ${inputs.gridSize[0]} x ${inputs.gridSize[1]}`
    
    if(gpuContext.particleCountDirty)
    {
        document.getElementById('particleStats').innerHTML = 
            `Particle count: ${(gpuContext.particleCount/1000).toFixed(1)}k  Current / ${(gpuContext.maxParticleCount/1000).toFixed(0)}k Max / ${(gpuContext.particleFreeCount/1000).toFixed(1)}k Free`
        gpuContext.particleCountDirty = false;  
    }

    document.getElementById('speedStats').innerHTML = `Simulation speed: ${(getThrottlingRatio()*100).toFixed(0)}%`      

    if(gpuContext.timingStatsDirty && Object.keys(gpuContext.movingAverageTimeStamps).length != 0)
    {
        let timingHtml = "<table><tr><th>Name</th><th>Total Time</th></tr>";

        let totalSimMs = 0;

        for(const name of Object.keys(gpuContext.movingAverageTimeStamps))
        {
            const timerUs = gpuContext.movingAverageTimeStamps[name] / 1e3;
            timingHtml += `<tr><td style="font-family: monospace;">${name}</td><td>${(timerUs).toFixed(0)}μs</td></tr>\n`

            totalSimMs += timerUs/1e3;
        }

        timingHtml += `<tr><td><b>Total Sim</b></td><td>${(totalSimMs).toFixed(1)}ms</td></tr>\n`

        timingHtml += `</table>`

        document.getElementById('timingStats').innerHTML = timingHtml;
        gpuContext.timingStatsDirty = false;
    }

    function selectIf(cond)
    {
        if(!!cond)
        {
            return "selected='selected'";
        }
        else
        {
            return ""
        }
    }

    function mouseOverShapeHtml(elem)
    {

    }

    function constructShapeHtml(shape, isSelected, isMouseOver)
    {
        let sizeHtml;

        if(shape.shape == sim.SimEnums.ShapeTypeCircle)
        {
            sizeHtml = `
                <input class='input' type='range' id='${shape.id}Radius' value='${shape.radius}' min='0' max='1000' step='1'/>
                <label class='input' id='${shape.id}RadiusLabel' for='${shape.id}Radius'>Radius: ${shape.radius}</label><br>
            `;
        }
        else
        {
            sizeHtml = `
                <input class='input' type='range' id='${shape.id}HalfSizeX' value='${shape.halfSize.x}' min='0' max='1000' step='1'/>
                <label class='input' id='${shape.id}HalfSizeXLabel' for='${shape.id}HalfSizeX'>Width: ${shape.halfSize.x}</label><br>

                <input class='input' type='range' id='${shape.id}HalfSizeY' value='${shape.halfSize.y}' min='0' max='1000' step='1'/>
                <label class='input' id='${shape.id}HalfSizeYLabel' for='${shape.id}HalfSizeY'>Height: ${shape.halfSize.y}</label><br>
            `
        }

        const isEmitter = shape.function == sim.SimEnums.ShapeFunctionEmit
            || shape.function == sim.SimEnums.ShapeFunctionInitialEmit;

        let materialHtml = isEmitter ? `
            <select class='inputCombo' id='${shape.id}Material'>
                <option value="${sim.SimEnums.MaterialElastic}" ${selectIf(shape.emitMaterial == sim.SimEnums.MaterialElastic)}>Elastic</option>
                <option value="${sim.SimEnums.MaterialLiquid}" ${selectIf(shape.emitMaterial == sim.SimEnums.MaterialLiquid)}>Liquid</option>
                <option value="${sim.SimEnums.MaterialSand}" ${selectIf(shape.emitMaterial == sim.SimEnums.MaterialSand)}>Sand</option>
                <option value="${sim.SimEnums.MaterialVisco}" ${selectIf(shape.emitMaterial == sim.SimEnums.MaterialVisco)}>Visco</option>
            </select> 
            <label class='input' for='${shape.id}Material'>Emission Material</label><br>


        ` : '';

        let emissionRateHtml = shape.function == sim.SimEnums.ShapeFunctionEmit ? `
            <input class='input' type='range' id='${shape.id}EmissionRate' value='${shape.emissionRate}' min='0' max='20' step='0.1'/>
            <label class='input' id='${shape.id}EmissionRateLabel' for='${shape.id}EmissionRate'>Emission Rate: ${shape.emissionRate}</label>
        ` : ''

        let backgroundColor = '';
        if(isSelected)
        {
            backgroundColor = 'background-color: coral';
        }
        else if(isMouseOver)
        {
            backgroundColor = 'background-color: teal';
        }

        return `
            <div style='${backgroundColor}'>
            <h4>${shape.id}</h1>
            <form id="${shape.id}Form">

                <select class='inputCombo' id='${shape.id}Shape'>
                    <option value="${sim.SimEnums.ShapeTypeCircle}" ${selectIf(shape.shape == sim.SimEnums.ShapeTypeCircle)}>Circle</option>
                    <option value="${sim.SimEnums.ShapeTypeBox}" ${selectIf(shape.shape == sim.SimEnums.ShapeTypeBox)}>Box</option>
                </select> 
                <label class='input' for='${shape.id}Shape'>Shape</label><br>

                ${sizeHtml}

                <select class='inputCombo' id='${shape.id}Functionality'>
                    <option value="${sim.SimEnums.ShapeFunctionEmit}" ${selectIf(shape.function == sim.SimEnums.ShapeFunctionEmit)}>Emitter</option>
                    <option value="${sim.SimEnums.ShapeFunctionInitialEmit}" ${selectIf(shape.function == sim.SimEnums.ShapeFunctionInitialEmit)}>Initial Emitter</option>
                    <option value="${sim.SimEnums.ShapeFunctionCollider}" ${selectIf(shape.function == sim.SimEnums.ShapeFunctionCollider)}>Collider</option>
                    <option value="${sim.SimEnums.ShapeFunctionDrain}" ${selectIf(shape.function == sim.SimEnums.ShapeFunctionDrain)}>Drain</option>
                </select>
                <label class='input' for='${shape.id}Functionality'>Functionality</label><br>

                ${materialHtml}
                ${emissionRateHtml}
            </form>
            </div>
        `;
    }

    const shapeContainer = document.getElementById('shapesList');
    for(var shape of ui.g_simShapes)
    {
        function shapeElem(id)
        {
            return document.getElementById(`${shape.id}${id}`);
        }

        var shapeNode = document.getElementById(shape.id)
        if(!shapeNode)
        {
            shapeNode = document.createElement("div");
            shapeNode.setAttribute("id", shape.id);
            shapeNode.setAttribute("class", 'input')

            shapeContainer.appendChild(shapeNode);

            shapeNode.innerHTML = constructShapeHtml(shape);
        }
        else
        {
            const shapeType = shapeElem("Shape").value;
            const shapeFunction = shapeElem("Functionality").value;

            var rebuildElement =
                ui.g_selectionStateDirty
                || shapeType !== shape.shape
                || shapeFunction !== shape.function;

            if(shape.shape == sim.SimEnums.ShapeTypeCircle)
            {
                shape.radius = shapeElem("Radius").value;
            }
            else
            {
                shape.halfSize.x = shapeElem("HalfSizeX").value;
                shape.halfSize.y = shapeElem("HalfSizeY").value;
            }

            if(shape.function == sim.SimEnums.ShapeFunctionEmit)
            {
                shape.emissionRate = shapeElem("EmissionRate").value;
            }

            if(shape.function == sim.SimEnums.ShapeFunctionEmit || shape.function == sim.SimEnums.ShapeFunctionInitialEmit)
            {
                shape.emitMaterial = shapeElem("Material").value;
            }

            if(rebuildElement)
            {
                shape.shape = shapeType;
                shape.function = shapeFunction;
                shapeNode.innerHTML = constructShapeHtml(shape, ui.g_grabbedObject == shape, ui.g_mouseOverObject == shape);
            }
            else
            {
                if(shape.shape == sim.SimEnums.ShapeTypeCircle)
                {
                    shapeElem("RadiusLabel").innerText = `Radius: ${shapeElem("Radius").value}`;
                }
                else
                {
                    shapeElem("HalfSizeXLabel").innerText = `Width: ${shapeElem("HalfSizeX").value}`;
                    shapeElem("HalfSizeYLabel").innerText = `Height: ${shapeElem("HalfSizeY").value}`;
                }

                if(shape.function == sim.SimEnums.ShapeFunctionEmit)
                {
                    shapeElem("EmissionRateLabel").innerText = `Emission Rate: ${shapeElem("EmissionRate").value}`;
                }
            }
        }
    }

    ui.cleanSelectionState();

    // Erase any dom elements that refer to deleted shapes
    for(const child of shapeContainer.children)
    {
        const id = child.id;
        var doErase = true;
        for(const shape of ui.g_simShapes)
        {
            if(shape.id == id)
            {
                doErase = false;
            }
        }

        if(doErase)
        {
            child.remove();
        }
    }
}

let g_loadSpinnerState = 0;
function updateLoading()
{
    document.getElementById('main').style = 'display:none';
    document.getElementById('loadingText').innerHTML = 'Loading' + '.'.repeat(Math.floor(g_loadSpinnerState / 5));

    g_loadSpinnerState = (g_loadSpinnerState + 1) % (4 * 5);
}

async function saveScene()
{
    const result = await window.showSaveFilePicker();
    const stream = await result.createWritable();
    await stream.write(JSON.stringify({
        version: 2,
        resolution: [ui.g_canvas.width, ui.g_canvas.height],
        shapes: Array.from(ui.g_simShapes),
        settings: ui.getNonDefaultUIElements(),
    }, null, 4));
    await stream.close();
}

function newScene()
{
    document.getElementById('shapesList').innerHTML = '';
    ui.clearShapes();
    ui.setRequiredAspectRatio(window.innerWidth / window.innerHeight);
    ui.windowResize();
    g_reset = true;
}

function loadScene(json)
{
    if(json.version < 1 || json.version > 2)
    {
        throw 'Unrecognized version'
    }

    const resolution = json.resolution;

    const aspectRatio = resolution[0] / resolution[1];
    ui.setRequiredAspectRatio(aspectRatio);
    ui.windowResize();

    const currentResolution = [ui.g_canvas.width, ui.g_canvas.height];

    const widthScale = currentResolution[0]/resolution[0];
    const heightScale = currentResolution[1]/resolution[1];

    // Geometric mean
    const scaleScale = Math.sqrt(widthScale*heightScale);

    var shapes = json.shapes;
    ui.clearShapes();

    for(var shape of shapes)
    {
        shape.position.x *= widthScale;
        shape.position.y *= heightScale;

        shape.halfSize.x *= scaleScale;
        shape.halfSize.y *= scaleScale;

        shape.radius *= scaleScale;

        ui.g_simShapes.add(shape);
    }

    ui.setUIElementsToDefault();
    if(json.version >= 2)
    {
        ui.setUIElements(json.settings)
    }
}

async function loadSceneFromManifestIndex(manifestIndex)
{
    document.cookie = `pbmpm-scene=${manifestIndex}`;

    const url = g_manifest[manifestIndex].scene;
    const res = await fetch(url);
    loadScene(await res.json());
}

async function loadScenes()
{
    g_manifest = await (await fetch('./scenes/manifest.json')).json();

    let sceneIndex = 0;
    const cookieValue = document.cookie
        .split("; ")
        .find((row) => row.startsWith("pbmpm-scene="))
        ?.split("=")[1];

    if(cookieValue)
    {
        sceneIndex = Math.min(Number(cookieValue), g_manifest.length);
    }

    console.log(sceneIndex);


    let scenarioContainer = document.getElementById('scenarioContainer');

    let html = `
        <label class='input' for='scenarioCombo'>Scenario (Tab)</label>
        <select class='inputCombo' id='scenarioCombo'>
    `;

    for(let i = 0; i < g_manifest.length; ++i)
    {
        const elem = g_manifest[i];
        const selectedHTML = (i == sceneIndex) ? `selected='selected'` : '';
        html += `<option id='scene${i}' value='${i}' ${selectedHTML}>${elem.name}</option>\n`
    }

    html += `</select>\n<br>\n`;

    scenarioContainer.innerHTML = html;

    loadSceneFromManifestIndex(sceneIndex);
}   

function cycleScene()
{
    let inputs = ui.getInputs();
    let nextScenario = (Number(inputs.scenario)+ 1) % g_manifest.length;
    document.getElementById(`scenarioCombo`).value = nextScenario;
}