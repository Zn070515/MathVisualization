import { describe, expect, it } from 'vitest';
import { makeStoreFromLatex } from './helpers';
import {
  DEFAULT_DFT_SAMPLING,
  dftStemValues,
  dftFrequencyVariable,
  nyquistBoundaryFrequencies,
  estimateActiveDft,
  projectDftValue,
  readoutAtFrequency,
  sampleMarkerValues,
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
      algorithm: 'direct',
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

  it('uses the same estimate for sample markers, stems, and readout', () => {
    const store = dftStore();
    const state = store.getState();
    const estimate = estimateActiveDft(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      DEFAULT_DFT_SAMPLING,
    );
    if (estimate === null) throw new Error('expected a DFT estimate');

    const markers = sampleMarkerValues(estimate);
    const stems = dftStemValues(estimate, 'magnitude');
    const readout = readoutAtFrequency(0.03, estimate);
    expect(markers).toHaveLength(64);
    expect(markers[0]?.t).toBe(-8);
    expect(stems).toHaveLength(64);
    expect(stems[0]?.frequency).toBe(estimate.bins[0]?.angularFrequency);
    expect(readout?.bin.index).toBe(0);
    expect(readout?.value).toEqual(estimate.values[0]);
  });

  it('attaches the sampling alias family to a snapped bin', () => {
    const store = dftStore();
    const state = store.getState();
    const estimate = estimateActiveDft(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      DEFAULT_DFT_SAMPLING,
    );
    if (estimate === null) throw new Error('expected a DFT estimate');

    const readout = readoutAtFrequency(0.03, estimate);
    expect(readout?.aliasing.samplingAngularFrequency).toBeCloseTo(8 * Math.PI);
    expect(readout?.aliasing.representative).toBeCloseTo(0);
    expect(readout?.aliasing.aliases[0]).toBeCloseTo(-8 * Math.PI);
    expect(readout?.aliasing.aliases[1]).toBeCloseTo(0);
    expect(readout?.aliasing.aliases[2]).toBeCloseTo(8 * Math.PI);
  });

  it('does not invent a phase for a zero-magnitude bin', () => {
    expect(projectDftValue({ re: 0, im: 0 }, 'phase')).toBeNull();
  });

  it('preserves the expression frequency variable and exposes Nyquist boundaries', () => {
    const store = makeStoreFromLatex(
      ['f(t)=\\cos(t)', 'D(q)=\\operatorname{DFT}(f(t))'],
      'transforms',
    );
    store.focusLine(store.getState().lines[1]?.id as string);
    const state = store.getState();
    const estimate = estimateActiveDft(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      DEFAULT_DFT_SAMPLING,
    );
    if (estimate === null) throw new Error('expected a DFT estimate');

    expect(dftFrequencyVariable(store.activeExpression())).toBe('q');
    expect(nyquistBoundaryFrequencies(estimate)).toEqual([
      -estimate.nyquistAngularFrequency,
      estimate.nyquistAngularFrequency,
    ]);
  });
});
