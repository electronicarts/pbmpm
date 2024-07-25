//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

"use strict";

import {SimEnums, RenderEnums} from "./sim.js"
import * as v from "./v.js"

export let g_canvas;
export let g_vectorCanvas;

export let g_isMouseDown = false;
let g_mousePosition = [0,0];

let g_gridSizeX = 512;
let g_gridSizeY = 512;

let g_mouseOverObject;
let g_mouseOverZone;
let g_grabbedObject;
let g_dragging;

export let g_simShapes = new Set([]);

export function windowResize()
{
    const inputs = getInputs()
    g_canvas.width = window.innerWidth;
    g_canvas.height = window.innerHeight;

    g_vectorCanvas.width = window.innerWidth;
    g_vectorCanvas.height = window.innerHeight;

    g_gridSizeX = Math.floor(g_canvas.width / inputs.simResDivisor);
    g_gridSizeY = Math.floor(g_canvas.height / inputs.simResDivisor);
}

function getMousePosition(event)
{
    let rect = g_canvas.getBoundingClientRect();
    let x = event.clientX - rect.left;
    let y = event.clientY - rect.top;
    return [x, y];
}

export function getInputs() 
{
    let inputs = {
        isMouseDown: g_isMouseDown,
        mousePosition: g_mousePosition,
        resolution: [g_canvas.width, g_canvas.height],
        gridSize: [g_gridSizeX, g_gridSizeY],
        canvas: g_canvas,
        shapes: g_simShapes
    }

    for(const element of g_uiElements)
    {
        if(element.type === Range || element.type === Combo)
        {
            inputs[element.name] = document.getElementById(element.name).value;
        }
        else if(element.type === Checkbox)
        {
            inputs[element.name] = document.getElementById(element.name).checked ? 1 : 0;
        }
    }

    return inputs;
}

const Section = 'section'
const SectionEnd = 'sectionEnd'
const Range = 'range'
const Combo = 'combo'
const RawHTML = 'rawHTML'
const Button = 'button'
const Checkbox = 'checkbox'

const g_uiElements = 
[
    {type: Button,name: 'resetButton', desc: 'Reset (F5)'},
    {type: Button,name: 'pauseButton', desc: 'Pause (Spacebar)'},
    {type: RawHTML, value: `<br>`},
    
    {type: Combo, name: 'simResDivisor', desc:'Render Pixels per Sim Grid Cell', values:[1,2,4,8,16], default:8},

    {type: Range, name: 'particlesPerCellAxis', desc: 'Particles per cell axis', default: 2, min: 1, max: 8, step: 1},
    {type: Combo, name: 'simRate', desc:"Sim Update Rate (Hz)", values:[15, 30, 60, 120, 240, 480, 600, 1200, 2400], default:480},
    {type: Checkbox, name: 'useGridVolumeForLiquid', desc: 'Use Grid Volume for Liquid', default: true},
    {type: Range, name: 'fixedPointMultiplierExponent', desc: 'log10(Fixed Point Multiplier)', default: 7, min: 3, max: 10, step: 1},
    {type: Range, name: 'gravityStrength', desc: 'Gravity Strength', default: 2.5, min: 0, max: 5, step: 0.01},
    {type: Range, name: 'liquidViscosity', desc: 'Liquid Viscosity', default: 0.01, min: 0, max: 1, step: 0.01},
    {type: Combo, name: 'mouseFunction', desc: 'Mouse Interaction', default:SimEnums.MouseFunctionGrab, values:[
        {desc:'Grab', value: SimEnums.MouseFunctionGrab},
        {desc:'Push', value: SimEnums.MouseFunctionPush},
    ]},

    {type: Range, name: 'iterationCount', desc: 'Iteration Count', default: 2, min: 1, max: 10, step: 1},
    {type: Range, name: 'elasticityRatio', desc: 'Elasticity Ratio', default: 1, min: 0, max: 1, step: 0.01},
    {type: Range, name: 'liquidRelaxation', desc: 'Liquid Relaxation', default: 2, min: 0, max: 10, step: 0.01},
    {type: Range, name: 'elasticRelaxation', desc: 'Elastic Relaxation', default: 1.5, min: 0, max: 10, step: 0.01},
    {type: Range, name: 'frictionAngle', desc: 'Sand Friction Angle', default: 30, min: 0, max: 45, step: 0.1},
    {type: Range, name: 'plasticity', desc: 'Visco Plasticity', default: 0, min: 0, max: 1, step: 0.01},

    {type: Combo, name: 'renderMode', desc: 'Render Mode', values:[
        {value: RenderEnums.RenderModeStandard, desc: 'Standard'},
        {value: RenderEnums.RenderModeCompression, desc:'Compression'},
        {value: RenderEnums.RenderModeVelocity, desc: 'Velocity'}
    ]},
]

export function init(resetCallback, pauseCallback)
{
    g_canvas = document.getElementById('canvas');
    g_vectorCanvas = document.getElementById('vectorCanvas');

    let form = document.getElementById('uiContainer');

    var uiHtml = "";

    for (const element of g_uiElements)
    {
        if(element.type == Checkbox)
        {
            const checkedHtml = element.default ? `checked` : '';
            uiHtml += `<input class='input' type='checkbox' id=${element.name} ${checkedHtml}/>\n`;
            uiHtml += `<label class='input' for='${element.name}'>${element.desc}</label>\n<br>\n`;
        }
        if(element.type == Range)
        {
            console.assert('name' in element)

            uiHtml += `<input class='input' type="range" id="${element.name}" value="${element.default}" min="${element.min}" max="${element.max}" step="${element.step}" oninput="this.nextElementSibling.value = '${element.desc}: ' + this.value">\n`
            uiHtml += `<output class='input' >${element.desc}: ${element.default}</output><br>\n`
        }
        else if(element.type == Section)
        {   
            uiHtml += `<br><button id="${element.name}" type="button" class="collapsible">${element.desc}</button>\n`
            uiHtml += `<div id="${element.name+'_content'}" class="sectionContent">\n`
        }
        else if(element.type == SectionEnd)
        {
            uiHtml += `</div>\n`
        }
        else if(element.type == Combo)
        {
            uiHtml += `<label class='input' for="${element.name}">${element.desc}</label>\n`
            uiHtml += `<select class='inputCombo' id="${element.name}">\n`

            for(const value of element.values)
            {
                const isObject = typeof value ==='object'
                const machineValue = isObject ? value.value : value;
                const desc = isObject ? value.desc : value;
                const isSelected = element.default == (isObject ? value.value : value);
                const selectedHTML = isSelected ? `selected="selected"` : ""
                uiHtml += `<option value="${machineValue}" ${selectedHTML}>${desc}</option>\n`
            }

            uiHtml += `</select>\n<br>\n`
        }
        else if(element.type == RawHTML)
        {
            uiHtml += element.value;
        }
        else if(element.type == Button)
        {
            if(element.name == 'resetButton')
            {
                element.callback = resetCallback;
            }
            else if(element.name == 'pauseButton')
            {
                element.callback = pauseCallback;
            }

            uiHtml += `<input class='inputCombo' type="button" id="${element.name}" value="${element.desc}">\n`
        }
    }

    form.innerHTML += uiHtml;

    for(const element of g_uiElements)
    {
        if(element.type == Button)
        {
            document.getElementById(element.name).onclick = element.callback;
        }
        else if(element.type == Section)
        {
            document.getElementById(element.name).addEventListener('click', () => {
                var el = document.getElementById(element.name);
                el.classList.toggle("active");
                var content = el.nextElementSibling;
                content.style.display = (content.style.display == "block" ? "none" : "block");
            }); 
        }
    }

    g_vectorCanvas.addEventListener("mousemove", function (e) 
    {
        g_mousePosition = getMousePosition(e);


    })
    
    g_vectorCanvas.addEventListener("mousedown", function (e)
    {
        if(g_mouseOverObject && g_grabbedObject != g_mouseOverObject)
        {
            g_grabbedObject = g_mouseOverObject;
        }
        else if(g_grabbedObject && g_grabbedObject != g_mouseOverObject)
        {
            g_grabbedObject = g_mouseOverObject;
        }

        if(g_grabbedObject && g_grabbedObject === g_mouseOverObject)
        {
            g_dragging = 
            {
                mouseStartPosition: new v.ec2f(g_mousePosition[0], g_mousePosition[1]),
                mouseLastPosition: new v.ec2f(g_mousePosition[0], g_mousePosition[1]),
                shapeStartPosition: g_grabbedObject.position,
            };
        }

        g_isMouseDown = !g_grabbedObject;
    }); 
    
    g_vectorCanvas.addEventListener("mouseup", function (e) 
    {
        g_isMouseDown = false;
        g_dragging = undefined;
    }); 
    
    g_vectorCanvas.addEventListener("mouseout", function (e) 
    {
        g_isMouseDown = false;
        g_dragging = undefined;
    }); 



    window.onresize = windowResize;
    window.onresize()
}

function boxCollide(shape, position) 
{
    const offset = v.sub(shape.position, position);
    var localSpaceOffset = v.abs(v.rotate(offset, -shape.rotation));
    const d = v.sub(localSpaceOffset, shape.halfSize);
    var distFromBorder = v.length(v.max(d, new v.ec2f(0,0)));
    distFromBorder += Math.min(Math.max(d.x, d.y), 0);
    distFromBorder = Math.abs(distFromBorder);

    const isInRotationZone = (d.x > 0 && d.y > 0);
    
    return {
        dist: distFromBorder,
        zone: isInRotationZone ? 'rotation' : 'translation',
    };
}

export function update(inputs, uiIsHidden)
{   
    let mousePosition = new v.ec2f(inputs.mousePosition[0], inputs.mousePosition[1]);

    let canvas = g_vectorCanvas.getContext("2d");
    canvas.clearRect(0, 0, g_vectorCanvas.width, g_vectorCanvas.height);
    canvas.reset();
    canvas.lineWidth = 2;

    if(!uiIsHidden)
    {
        if(g_dragging)
        {
            // Update shape dragging
            if(g_mouseOverZone == 'translation')
            {
                const offset = v.sub(mousePosition, g_dragging.mouseStartPosition);
                g_grabbedObject.position = v.add(offset, g_dragging.shapeStartPosition);
            }
            else
            {
                const currentOffset = v.sub(mousePosition, g_grabbedObject.position);
                const prevOffset = v.sub(g_dragging.mouseLastPosition, g_grabbedObject.position);
    
                const angleIncrement = v.angleBetween(prevOffset, currentOffset);
                
                g_dragging.mouseLastPosition = mousePosition;
                g_grabbedObject.rotation += angleIncrement;
            }
        }
        else
        {
            // Selection detection
            // Maximum range at which selection will be considered
            const selectionRange = 50;
    
            g_mouseOverObject = undefined;
            let maxDistance = Infinity;
            for(const shape of g_simShapes)
            {
                if(shape.shape == SimEnums.ShapeTypeCircle)
                {
                    const offset = v.sub(shape.position, mousePosition);
                    const len = v.length(offset);
    
                    const dist = Math.abs(len - shape.radius);
    
                    if(dist <= selectionRange && dist < maxDistance)
                    {
                        maxDistance = dist;
                        g_mouseOverObject = shape;
                        g_mouseOverZone = 'translation';
                    }
                }
                else if(shape.shape == SimEnums.ShapeTypeBox)
                {
                    const collideResult = boxCollide(shape, mousePosition);
    
                    if(collideResult.dist <= selectionRange && collideResult.dist < maxDistance)
                    {
                        maxDistance = collideResult.dist;
                        g_mouseOverObject = shape;
                        g_mouseOverZone = collideResult.zone;
                    }
                }
            } 
    
        }
    
    
        // Set mouse cursor
        if(g_mouseOverObject)
        {
            if(g_mouseOverZone === 'translation')
            {   
                g_vectorCanvas.style.cursor = g_dragging? 'grabbing' : 'grab';
            }
            else if(g_mouseOverZone === 'rotation')
            {   
                g_vectorCanvas.style.cursor = 'url("./data/rotate.svg") 16 16, pointer';
            }
        }
        else
        {
            g_vectorCanvas.style.cursor = 'auto';
        }
    

    
        for(const shape of g_simShapes)
        {
            let color = [];
    
            if(shape.function == SimEnums.ShapeFunctionEmit)
            {
                if(shape.emitMaterial == SimEnums.MaterialLiquid)
                {
                    color = [255,0,0];
                }
                else if(shape.emitMaterial == SimEnums.MaterialElastic)
                {
                    color = [255,255,0];
                }
            }
            else if(shape.function == SimEnums.ShapeFunctionCollider)
            {
                color = [128, 128, 128];
            }
            else if(shape.function == SimEnums.ShapeFunctionInitialEmit)
            {
                color = [0, 129, 128];
            }
    
            if(g_mouseOverObject === shape)
            {
                color = [255, 255, 255];
            }
    
            if(g_grabbedObject === shape)
            {
                color = [0, 0, 255];
            }    
                
            const lineStyle=`rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.5)`;
    
    
            if(shape.shape == SimEnums.ShapeTypeBox)
            {
                canvas.resetTransform();
                canvas.beginPath();
                canvas.translate(shape.position.x, shape.position.y);
    
                canvas.rotate(shape.rotation / 180 * Math.PI)
                canvas.translate(-shape.halfSize.x, -shape.halfSize.y);
    
                canvas.strokeStyle = lineStyle;
                canvas.rect(0, 0, shape.halfSize.x*2, shape.halfSize.y*2);
                canvas.stroke();
    
    
            }
            else if(shape.shape == SimEnums.ShapeTypeCircle)
            {
                canvas.resetTransform();
                canvas.beginPath();
                canvas.translate(shape.position.x, shape.position.y);
                canvas.strokeStyle = lineStyle;
                canvas.arc(0, 0, shape.radius, 0, 2*Math.PI);
                canvas.stroke();
            }
        }
    }

    

    if(inputs.isMouseDown)
    {
        canvas.resetTransform();
        canvas.beginPath();
        canvas.arc(inputs.mousePosition[0], inputs.mousePosition[1], inputs.mouseRadius, 0, 2*Math.PI);
        canvas.lineWidth = 2;
        canvas.strokeStyle = "#888E"
        canvas.stroke();
    }
}

function allocateShapeName()
{
    var i = 0;

    while(true)
    {
        var found = false;
        for(const shape of g_simShapes)
        {
            if(shape.id == `shape${i}`)
            {
                found = true;
                break;
            }
        }
        if(!found)
        {
            return `shape${i}`;
        }

        ++i;
    }
}

export function deleteShape()
{
    if(!!g_grabbedObject) 
    {
        g_simShapes.delete(g_grabbedObject);
        g_grabbedObject = undefined;
    }
}

export function duplicateShape() 
{
    if(!!g_grabbedObject)
    {
        var newShape = JSON.parse(JSON.stringify(g_grabbedObject));
        newShape.id = allocateShapeName();
        g_simShapes.add(newShape);
    }
}

