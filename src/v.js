//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

"use strict";

export class ec2f
{
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    toArray()
    {
        return [this.x, this.y];
    }
}

export function add(a, b)
{
    return new ec2f(a.x + b.x, a.y + b.y);
}

export function sub(a, b)
{
    return new ec2f(a.x - b.x, a.y - b.y);
}

export function neg(a)
{
    return new ec2f(-a.x, -b.x);
}

export function abs(a)
{
    return new ec2f(Math.abs(a.x), Math.abs(a.y));
}

export function min(a, b)
{
    return new ec2f(Math.min(a.x, b.x), Math.min(a.y, b.y));
}

export function max(a, b)
{
    return new ec2f(Math.max(a.x, b.x), Math.max(a.y, b.y));
}

export function equal(a, b)
{
    return a.x == b.x && a.y == b.y;
}

export function mulScalar(a, s)
{
    return new ec2f(a.x*s, a.y*s);
}

export function mul(a, b)
{
    return new ec2f(a.x*b.x, a.y*b.y);
}

export function length(a)
{
    return Math.sqrt(a.x*a.x + a.y*a.y);
}

export function rotate(a, theta)
{
    const thetaRad = theta / 180 * Math.PI;
    const ct = Math.cos(thetaRad);
    const st = Math.sin(thetaRad);

    return new ec2f(a.x*ct - a.y*st, a.x*st + a.y*ct);
}

export function angleBetween(a, b)
{
    return Math.atan2(b.y*a.x - b.x*a.y, a.x*b.x + a.y*b.y) * 180.0 / Math.PI;
}