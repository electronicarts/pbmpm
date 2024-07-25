//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

//!include dispatch.inc
//!include particle.inc
//!include simConstants.inc
//!include matrix.inc
//!include random.inc
//!include shapes.inc

@group(0) @binding(0) var<uniform> g_simConstants : SimConstants;
@group(0) @binding(1) var<storage> g_particleCount : array<u32>;
@group(0) @binding(2) var<storage, read_write> g_particles : array<Particle>;
@group(0) @binding(3) var<storage> g_shapes : array<SimShape>;
@group(0) @binding(4) var<storage, read_write> g_freeCount : array<atomic<i32>>;
@group(0) @binding(5) var<storage, read_write> g_freeIndices : array<u32>;

@compute @workgroup_size(ParticleDispatchSize, 1, 1)
fn csMain( @builtin(global_invocation_id) id: vec3<u32> )
{
    if(id.x >= g_particleCount[0])
    {
        return;
    }

    var particle = g_particles[id.x];

    if(particle.enabled == 0)
    {
        return;
    }

    if(particle.material == MaterialLiquid)
    {
        // The liquid material only cares about the determinant of the deformation gradient.
        // We can use the regular MPM integration below to evolve the deformation gradient, but
        // this approximation actually conserves more volume.
        // This is based on det(F^n+1) = det((I + D)*F^n) = det(I+D)*det(F^n)
        // and noticing that D is a small velocity, we can use the identity det(I + D) ≈ 1 + tr(D) to first order
        // ending up with det(F^n+1) = (1+tr(D))*det(F^n)
        // Then we directly set particle.liquidDensity to reflect the approximately integrated volume.
        // The liquid material does not actually use the deformation gradient matrix.
        particle.liquidDensity *= (tr(particle.deformationDisplacement) + 1.0);

        // Safety clamp to avoid instability with very small densities.
        particle.liquidDensity = max(particle.liquidDensity, 0.1);
    }
    else
    {
        // Integrate transform using standard MPM formula
        particle.deformationGradient = (Identity + particle.deformationDisplacement) * particle.deformationGradient;
    }

    if(particle.material != MaterialLiquid)
    {
        // SVD is necessary at least for safety clamp
        var svdResult = svd(particle.deformationGradient);

        // Clamp the lower bound of scale to prevent situations where large forces are generated leading to explosions     
        svdResult.Sigma = clamp(svdResult.Sigma, vec2f(0.2), vec2f(10000.0));

        // Plasticity implementations
        if(particle.material == MaterialSand)
        {
            // Drucker-Prager sand based on:
            // Gergely Klár, Theodore Gast, Andre Pradhana, Chuyuan Fu, Craig Schroeder, Chenfanfu Jiang, and Joseph Teran. 2016.
            // Drucker-prager elastoplasticity for sand animation. ACM Trans. Graph. 35, 4, Article 103 (July 2016), 12 pages.
            // https://doi.org/10.1145/2897824.2925906
            let sinPhi = sin(g_simConstants.frictionAngle/180.0 * 3.14159);
            let alpha = sqrt(2.0/3.0)*2.0*sinPhi/(3.0 - sinPhi);
            let beta = 0.5;

            let eDiag = log(max(abs(svdResult.Sigma), vec2f(1e-6)));

            let eps = diag(eDiag);
            let trace = tr(eps) + particle.logJp;

            let eHat = eps - (trace / 2) * Identity;
            let frobNrm = length(vec2f(eHat[0][0], eHat[1][1]));

            if(trace >= 0.0)
            {   
                // In this case the motion is expansionary and we should not resist it at all.
                // This means we should forget about any deformation that has occurred, which we do by setting Sigma to 1.
                svdResult.Sigma = vec2f(1);
                particle.logJp = beta * trace;
            }
            else
            {
                particle.logJp = 0;
                let deltaGammaI = frobNrm + (g_simConstants.elasticityRatio + 1.0) * trace * alpha;
                if(deltaGammaI > 0)
                {   
                    // Project to cone surface.
                    // This means we have to forget some deformation that the particle has undergone.
                    let h = eDiag - deltaGammaI/frobNrm * (eDiag - (trace*0.5)) ;
                    svdResult.Sigma = exp(h);
                }
            }
        }
        else if(particle.material == MaterialVisco)
        {
            // Very simple plasticity with volume preservation
            let yieldSurface = exp(1-g_simConstants.plasticity);

            // Record the volume before plasticity calculation
            let J = svdResult.Sigma.x*svdResult.Sigma.y;

            // Forget any deformation beyond the yield surface
            svdResult.Sigma = clamp(svdResult.Sigma, vec2f(1.0/yieldSurface), vec2f(yieldSurface));
            
            // Re-scale to original volume
            let newJ = svdResult.Sigma.x*svdResult.Sigma.y;
            svdResult.Sigma *= sqrt(J/newJ);
        }

        particle.deformationGradient = svdResult.U * diag(svdResult.Sigma) * svdResult.Vt;
    }

    // Integrate position
    particle.position += particle.displacement;

    // Mouse interaction
    if(g_simConstants.mouseActivation > 0)
    {
        let offset = particle.position - g_simConstants.mousePosition;
        let lenOffset = max(length(offset), 0.0001);
        if(lenOffset < g_simConstants.mouseRadius)
        {
            let normOffset = offset/lenOffset;

            if(g_simConstants.mouseFunction == MouseFunctionPush)
            {
                particle.displacement += normOffset * g_simConstants.mouseActivation;
            }
            else if(g_simConstants.mouseFunction == MouseFunctionGrab)
            {
                particle.displacement = 0.7*g_simConstants.mouseVelocity*g_simConstants.deltaTime;
            }
        }
    }

    // Gravity acceleration is normalized to the vertical size of the window.
    particle.displacement.y -= f32(g_simConstants.gridSize.y)*g_simConstants.gravityStrength*g_simConstants.deltaTime*g_simConstants.deltaTime;

    // Free count may be negative because of emission. So make sure it is at last zero before incrementing.
    atomicMax(&g_freeCount[0], 0i);

    for(var shapeIndex = 0u; shapeIndex < g_simConstants.shapeCount; shapeIndex++)
    {
        let shape = g_shapes[shapeIndex];

        // Push particles out of colliders. Most of the work should have been done at the grid level already.
        if(shape.functionality == ShapeFunctionCollider)
        {
            let collideResult = collide(shape, particle.position);

            if(collideResult.collides)
            {
                particle.displacement -= collideResult.penetration*collideResult.normal;
            }
        }

        // Delete particles if they are inside a drain shape
        if(shape.functionality == ShapeFunctionDrain)
        {
            if(collide(shape, particle.position).collides)
            {
                particle.enabled = 0;

                // Add index of this particle to free list
                let freeIndex = atomicAdd(&g_freeCount[0], 1i);
                g_freeIndices[u32(freeIndex)] = id.x;
            }
        }
    }

    // Ensure particles are inside the simulation limits
    particle.position = projectInsideGuardian(particle.position, g_simConstants.gridSize, GuardianSize);

    g_particles[id.x] = particle;
}