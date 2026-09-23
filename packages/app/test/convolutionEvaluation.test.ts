import { describe, expect, it } from 'vitest';
import { makeStoreFromLatex } from './helpers';
import {
  DEFAULT_CONVOLUTION_SETTINGS,
  estimateActiveConvolution,
  selectConvolution,
} from '../src/views/convolutionEvaluation';

function convolutionStore() {
  const store = makeStoreFromLatex(
    [
      'f(t)=\\exp(-t^2)',
      'g(t)=\\exp(-2t^2)',
      'h(t)=\\operatorname{Convolution}(f(t),g(t))',
    ],
    'transforms',
  );
  store.focusLine(store.getState().lines[2]?.id as string);
  return store;
}

describe('convolution app evaluation', () => {
  it('selects the focused convolution definition', () => {
    const store = convolutionStore();
    expect(selectConvolution(store.activeExpression())).not.toBeNull();
  });

  it('uses deterministic shared settings', () => {
    expect(DEFAULT_CONVOLUTION_SETTINGS).toEqual({
      integrationWindow: { min: -8, max: 8 },
      outputWindow: { min: -8, max: 8 },
      outputSampleCount: 64,
      integrationSampleCount: 64,
    });
  });

  it('shares a cached estimate until parameters or settings change', () => {
    const store = convolutionStore();
    const state = store.getState();
    const first = estimateActiveConvolution(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      DEFAULT_CONVOLUTION_SETTINGS,
    );
    const repeated = estimateActiveConvolution(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      DEFAULT_CONVOLUTION_SETTINGS,
    );
    const changed = estimateActiveConvolution(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      { ...DEFAULT_CONVOLUTION_SETTINGS, outputSampleCount: 32 },
    );

    expect(first).not.toBeNull();
    expect(repeated).toBe(first);
    expect(changed).not.toBe(first);
  });
});
