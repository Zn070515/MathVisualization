import { describe, expect, it } from 'vitest';
import { builtinFunction, BUILTIN_FUNCTION_NAMES, spaceRuleFor } from '../src/builtins';

describe('builtin registry', () => {
  it('registers sign as a real-only builtin', () => {
    expect(BUILTIN_FUNCTION_NAMES.has('sign')).toBe(true);
    expect(builtinFunction('sign')).toMatchObject({
      name: 'sign',
      arity: 1,
      spaceRule: 'real-only',
      gpu: true,
    });
    expect(spaceRuleFor('sign')).toBe('real-only');
  });
});
