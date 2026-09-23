import { describe, expect, it } from 'vitest';
import { makeStoreFromLatex } from './helpers';
import {
  DEFAULT_DFT_SAMPLING,
  estimateActiveDft,
} from '../src/views/dftEvaluation';
import { selectDftTransform } from '../src/views/dftEvaluation';
import { snapDftBin } from '../src/views/dftEvaluation';

function dftStore() {
  const store = makeStoreFromLatex(
    ['f(t)=\\cos(t)', 'D(\\omega)=\\operatorname{DFT}(f(t))'],
    'transforms',
  );
  store.focusLine(store.getState().lines[1]?.id as string);
  return store;
}

describe('DFT app evaluation', () => {
  it('selects only the focused DFT transform', () => {
    const store = dftStore();
    expect(selectDftTransform(store.activeExpression())).not.toBeNull();
  });

  it('uses deterministic shared sampling defaults', () => {
    expect(DEFAULT_DFT_SAMPLING).toEqual({
      timeWindow: { min: -8, max: 8 },
      sampleCount: 64,
    });
  });

  it('shares a cached estimate and invalidates it when sampling changes', () => {
    const store = dftStore();
    const state = store.getState();
    const first = estimateActiveDft(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      DEFAULT_DFT_SAMPLING,
    );
    const repeated = estimateActiveDft(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      DEFAULT_DFT_SAMPLING,
    );
    const changed = estimateActiveDft(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      { ...DEFAULT_DFT_SAMPLING, sampleCount: 32 },
    );

    expect(first).not.toBeNull();
    expect(repeated).toBe(first);
    expect(changed).not.toBe(first);
    expect(changed?.sampleInterval).toBe(0.5);
  });

  it('snaps a frequency to a real DFT bin rather than interpolating a value', () => {
    const store = dftStore();
    const state = store.getState();
    const estimate = estimateActiveDft(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      DEFAULT_DFT_SAMPLING,
    );
    if (estimate === null) throw new Error('expected a DFT estimate');

    const snapped = snapDftBin(0.03, estimate);
    expect(snapped?.bin.angularFrequency).toBe(snapped?.frequency);
    expect(snapped?.value).toEqual(estimate.values[snapped?.bin.index ?? -1]);
  });
});
