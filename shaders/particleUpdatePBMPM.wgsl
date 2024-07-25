//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

//!include dispatch.inc
//!include particle.inc
//!include simConstants.inc
//!include matrix.inc

@group(0) @binding(0) var<uniform> g_simConstants : SimConstants;
@group(0) @binding(1) var<storage> g_particleCount : array<u32>;
@group(0) @binding(2) var<storage, read_write> g_particles : array<Particle>;

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
        // Simple liquid viscosity: just remove deviatoric part of the deformation displacement
        let deviatoric = -1.0*(particle.deformationDisplacement + transpose(particle.deformationDisplacement));
        particle.deformationDisplacement += g_simConstants.liquidViscosity*0.5*deviatoric;

        // Volume preservation constraint:
        // we want to generate hydrostatic impulses with the form alpha*I
        // and we want the liquid volume integration (see particleIntegrate) to yield 1 = (1+tr(alpha*I + D))*det(F) at the end of the timestep.
        // where det(F) is stored as particle.liquidDensity.
        // Rearranging, we get the below expression that drives the deformation displacement towards preserving the volume.
        let alpha = 0.5*(1.0/particle.liquidDensity - tr(particle.deformationDisplacement) - 1.0);
        particle.deformationDisplacement += g_simConstants.liquidRelaxation*alpha*Identity; 
    }
    else if(particle.material == MaterialElastic || particle.material == MaterialVisco)
    {
        let F =  (Identity + particle.deformationDisplacement) * particle.deformationGradient;

        var svdResult = svd(F);
        
        // Closest matrix to F with det == 1
        let df = det(F);
        let cdf = clamp(abs(df), 0.1, 1000);
        let Q = (1.0f/(sign(df)*sqrt(cdf)))*F;
        // Interpolate between the two target shapes
        let alpha = g_simConstants.elasticityRatio;
        let tgt = alpha*(svdResult.U*svdResult.Vt) + (1.0-alpha)*Q;

        let diff = (tgt*inverse(particle.deformationGradient) - Identity) - particle.deformationDisplacement;
        particle.deformationDisplacement += g_simConstants.elasticRelaxation*diff;

    }
    else if(particle.material == MaterialSand)
    {
        let F =  (Identity + particle.deformationDisplacement) * particle.deformationGradient;

        var svdResult = svd(F);

        if(particle.logJp == 0)
        {
            svdResult.Sigma = clamp(svdResult.Sigma, vec2f(1, 1), vec2f(1000, 1000));
        }

        // Closest matrix to F with det == 1
        let df = det(F);
        let cdf = clamp(abs(df), 0.1, 1);
        let Q = (1.0f/(sign(df)*sqrt(cdf)))*F;
        // Interpolate between the two target shapes
        let alpha = g_simConstants.elasticityRatio;
        let tgt = alpha*(svdResult.U*mat2x2f(svdResult.Sigma.x, 0, 0, svdResult.Sigma.y)*svdResult.Vt) + (1.0-alpha)*Q;

        let diff = (tgt*inverse(particle.deformationGradient) - Identity) - particle.deformationDisplacement;
        particle.deformationDisplacement += g_simConstants.elasticRelaxation*diff;

        let deviatoric = -1.0*(particle.deformationDisplacement + transpose(particle.deformationDisplacement));
        particle.deformationDisplacement += g_simConstants.liquidViscosity*0.5*deviatoric;
    }

    g_particles[id.x] = particle;
}