import { describe, expect, it } from 'vitest';
import { implementedCapabilities, subsystemById } from '../src/subsystems';

describe('subsystem capability registry', () => {
  it('counts FFT as an implemented transform capability', () => {
    const transforms = subsystemById('transforms');
    const capability = transforms.capabilities.find((entry) => entry.name === 'FFT algorithm');

    expect(capability?.status).toBe('implemented');
    expect(implementedCapabilities(transforms)).toContain(capability);
  });

  it('counts critical-point and Hessian analysis as implemented calculus capability', () => {
    const calculus = subsystemById('calculus');
    const capability = calculus.capabilities.find(
      (entry) => entry.name === 'Critical points and extrema',
    );

    expect(capability?.status).toBe('implemented');
    expect(implementedCapabilities(calculus)).toContain(capability);
  });

  it('keeps convolution capabilities split by their actual completion level', () => {
    const transforms = subsystemById('transforms');
    expect(
      transforms.capabilities.find((entry) => entry.name === 'Numerical convolution')?.status,
    ).toBe('implemented');
    expect(
      transforms.capabilities.find((entry) => entry.name === 'Sampled convolution and DFT product')?.status,
    ).toBe('implemented');
    expect(
      transforms.capabilities.find((entry) => entry.name === 'Interactive convolution construction')?.status,
    ).toBe('planned');
  });
});
