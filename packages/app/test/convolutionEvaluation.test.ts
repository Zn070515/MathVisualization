import { describe, expect, it } from 'vitest';
import { cx } from '@mathviz/mathcore';
import { makeStoreFromLatex } from './helpers';
import {
  DEFAULT_CONVOLUTION_SETTINGS,
  combineDftSamplingStatus,
  estimateActiveConvolution,
  estimateActiveConvolutionConstruction,
  projectConstructionValue,
  selectConvolution,
} from '../src/views/convolutionEvaluation';

function convolutionStore() {
  const store = makeStoreFromLatex(
    ['f(t)=\\exp(-t^2)', 'g(t)=\\exp(-2t^2)', 'h(t)=\\operatorname{Convolution}(f(t),g(t))'],
    'transforms',
  );
  store.focusLine(store.getState().lines[2]?.id as string);
  return store;
}

function simpleConvolutionStore() {
  const store = makeStoreFromLatex(
    ['f(t)=1', 'g(t)=t', 'h(t)=\\operatorname{Convolution}(f(t),g(t))'],
    'transforms',
  );
  store.focusLine(store.getState().lines[2]?.id as string);
  return store;
}

describe('convolution app evaluation', () => {
  it('combines only the sampled DFT refinement statuses', () => {
    expect(combineDftSamplingStatus('stable', 'stable')).toBe('stable');
    expect(combineDftSamplingStatus('stable', 'sampling-sensitive')).toBe('sampling-sensitive');
    expect(combineDftSamplingStatus('stable', 'unresolved')).toBe('unresolved');
  });

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

  it('evaluates and caches construction data at the linked output time', () => {
    const store = simpleConvolutionStore();
    const state = store.getState();
    const settings = {
      ...DEFAULT_CONVOLUTION_SETTINGS,
      integrationWindow: { min: 0, max: 2 },
      integrationSampleCount: 8,
    };
    const first = estimateActiveConvolutionConstruction(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      1,
      settings,
    );
    const repeated = estimateActiveConvolutionConstruction(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      1,
      settings,
    );
    const changedTime = estimateActiveConvolutionConstruction(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      0.5,
      settings,
    );

    expect(first).not.toBeNull();
    expect(repeated).toBe(first);
    expect(changedTime).not.toBe(first);
    expect(first?.shiftedRightValues[0]?.re).toBe(1);
  });

  it('does not evaluate without an output time or active convolution', () => {
    const store = simpleConvolutionStore();
    const state = store.getState();
    expect(
      estimateActiveConvolutionConstruction(
        null,
        state.workspace,
        state.parameterValues,
        null,
        DEFAULT_CONVOLUTION_SETTINGS,
      ),
    ).toBeNull();
  });

  it('projects complex construction samples only after multiplication', () => {
    expect(projectConstructionValue(cx(3, 4), 'magnitude')).toBe(5);
    expect(projectConstructionValue(null, 'real')).toBeNull();
  });
});
