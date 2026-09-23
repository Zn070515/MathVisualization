import { describe, expect, it } from 'vitest';
import { surfaceProgramSource } from '../src/surfaceGlsl';

describe('surface shader overlays', () => {
  it('supports a flat layer with explicit opacity', () => {
    const program = surfaceProgramSource();

    expect(program.uniforms.some((uniform) => uniform.name === 'uOpacity')).toBe(true);
    expect(program.fragmentSource).toContain('uOpacity');
  });
});
