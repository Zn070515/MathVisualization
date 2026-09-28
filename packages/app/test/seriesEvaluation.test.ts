import { describe, expect, it } from 'vitest';
import {
  estimateActiveFourierSeries,
  fitSeriesViewport,
  initialSeriesViewport,
  selectFourierSeries,
} from '../src/views/seriesEvaluation';
import { DEFAULT_FOURIER_SERIES_SETTINGS } from '../src/state/workspaceStore';
import { makeStoreFromLatex } from './helpers';

describe('Fourier series application evaluation', () => {
  it('selects a series node and shares an unchanged estimate', () => {
    const store = makeStoreFromLatex(
      [
        'f\\left(u\\right)=\\cos\\left(u\\right)',
        'S\\left(t\\right)=\\operatorname{FourierSeries}\\left(f\\left(u\\right),2\\pi\\right)',
      ],
      'transforms',
    );
    const active = store.activeExpression();
    expect(selectFourierSeries(active)?.sourceVariable).toBe('u');
    const state = store.getState();
    const first = estimateActiveFourierSeries(
      active,
      state.workspace,
      state.parameterValues,
      DEFAULT_FOURIER_SERIES_SETTINGS,
    );
    const second = estimateActiveFourierSeries(
      active,
      state.workspace,
      state.parameterValues,
      DEFAULT_FOURIER_SERIES_SETTINGS,
    );
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it('invalidates the estimate when settings or parameters change', () => {
    const store = makeStoreFromLatex(
      [
        'a=1',
        'f\\left(u\\right)=\\cos\\left(a u\\right)',
        'S\\left(t\\right)=\\operatorname{FourierSeries}\\left(f\\left(u\\right),2\\pi\\right)',
      ],
      'transforms',
    );
    const state = store.getState();
    const active = store.activeExpression();
    const first = estimateActiveFourierSeries(
      active,
      state.workspace,
      state.parameterValues,
      state.seriesSettings,
    );
    const changedSettings = estimateActiveFourierSeries(
      active,
      state.workspace,
      state.parameterValues,
      { ...state.seriesSettings, order: 32 },
    );
    expect(changedSettings).not.toBe(first);

    store.setParameter('a', 2);
    const changedParameters = estimateActiveFourierSeries(
      store.activeExpression(),
      store.getState().workspace,
      store.getState().parameterValues,
      store.getState().seriesSettings,
    );
    expect(changedParameters).not.toBe(first);
  });

  it('centres the initial frame on one period and pads the measured range', () => {
    expect(initialSeriesViewport(2 * Math.PI, { min: -2, max: 3 })).toEqual({
      xMin: -Math.PI,
      xMax: Math.PI,
      yMin: -2.6,
      yMax: 3.6,
    });
  });

  it('returns a valid explicit Fit frame without mutating the current frame', () => {
    const store = makeStoreFromLatex(
      [
        'f\\left(u\\right)=\\cos\\left(u\\right)',
        'S\\left(t\\right)=\\operatorname{FourierSeries}\\left(f\\left(u\\right),2\\pi\\right)',
      ],
      'transforms',
    );
    const estimate = estimateActiveFourierSeries(
      store.activeExpression(),
      store.getState().workspace,
      store.getState().parameterValues,
      store.getState().seriesSettings,
    );
    const current = { xMin: -20, xMax: 20, yMin: -10, yMax: 10 };
    if (estimate === null) throw new Error('expected an estimate');
    const fitted = fitSeriesViewport(current, estimate, { min: -1, max: 1 });

    expect(fitted).not.toBeNull();
    expect(fitted?.xMin).toBe(-Math.PI);
    expect(fitted?.xMax).toBe(Math.PI);
    expect(fitted?.yMin).toBeLessThan(fitted?.yMax ?? 0);
    expect(current).toEqual({ xMin: -20, xMax: 20, yMin: -10, yMax: 10 });
  });
});
