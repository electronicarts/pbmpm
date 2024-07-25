//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

struct SVDResult
{
    U: mat2x2f,
    Sigma: vec2f,
    Vt: mat2x2f,
};

fn svd(m: mat2x2f) -> SVDResult
{
    // Pedro Gimeno (https://scicomp.stackexchange.com/users/9673/pedro-gimeno), 
    // Robust algorithm for 2x2 SVD, URL (version: 2019-10-22): https://scicomp.stackexchange.com/q/14103
	let E = (m[0][0] + m[1][1])*0.5;
	let F = (m[0][0] - m[1][1])*0.5;
	let G = (m[0][1] + m[1][0])*0.5;
	let H = (m[0][1] - m[1][0])*0.5;

	let Q = sqrt(E*E + H*H);
	let R = sqrt(F*F + G*G);
	let sx = Q + R;
	let sy = Q - R;

	let a1 = atan2(G, F);
	let a2 = atan2(H, E);
	
    let theta = (a2 - a1)*0.5;
    let phi = (a2 + a1)*0.5;

    let U = rot(phi);
    let Sigma = vec2f(sx, sy);
    let Vt = rot(theta);

    return SVDResult(U, Sigma, Vt);
}

fn det(m: mat2x2f) -> f32
{
    return m[0][0]*m[1][1] - m[0][1]*m[1][0];
}

fn tr(m: mat2x2f) -> f32
{
    return m[0][0] + m[1][1];
}

fn rot(theta: f32) -> mat2x2f
{
    let ct = cos(theta);
    let st = sin(theta);

    return mat2x2f(ct, st, -st, ct);
}

fn inverse(m: mat2x2f) -> mat2x2f
{
    // This matrix is guaranteed to be numerically invertible
    // because its singular values have been clamped in the integration stage
    let a = m[0][0];
    let b = m[1][0];
    let c = m[0][1];
    let d = m[1][1];
    return (1.0 / det(m))*mat2x2f(d, -c, -b, a);
}

fn outerProduct(x: vec2f, y: vec2f) -> mat2x2f
{
    return mat2x2f(x*y.x, x*y.y);
}

fn diag(d: vec2f) -> mat2x2f
{
    return mat2x2f(d.x, 0, 0, d.y);
}

const Identity = mat2x2f(1,0,0,1);
const ZeroMatrix = mat2x2f(0,0,0,0);