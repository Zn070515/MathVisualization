import { describe, expect, it } from 'vitest';
import { implementedCapabilities, subsystemById } from '../src/subsystems';

describe('subsystem capability registry', () => {
  it('counts critical-point and Hessian analysis as implemented calculus capability', () => {
    const calculus = subsystemById('calculus');
    const capability = calculus.capabilities.find(
      (entry) => entry.name === 'Critical points and extrema',
    );

    expect(capability?.status).toBe('implemented');
    expect(implementedCapabilities(calculus)).toContain(capability);
  });
});
