import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConvolutionView } from '../src/views/ConvolutionView';
import { estimateActiveDftProduct } from '../src/views/convolutionEvaluation';
import { DEFAULT_DFT_SAMPLING } from '../src/views/dftEvaluation';
import type { ViewRendererProps } from '../src/state/workspaceStore';
import { makeStoreFromLatex } from './helpers';

function nonzeroOriginConvolutionStore() {
  const store = makeStoreFromLatex(
    ['f(t)=\\cos(t)', 'g(t)=\\sin(t)', 'h(t)=\\operatorname{Convolution}(f(t),g(t))'],
    'transforms',
  );
  store.focusLine(store.getState().lines[2]?.id as string);
  store.setSamplingSettings({
    ...DEFAULT_DFT_SAMPLING,
    timeWindow: { min: 0.25, max: 8.25 },
  });
  return store;
}

function propsForConvolutionStore(
  store: ReturnType<typeof nonzeroOriginConvolutionStore>,
): ViewRendererProps {
  const view = store.getState().views.find((candidate) => candidate.kind === 'convolution');
  if (view === undefined) throw new Error('expected a convolution view');
  return { store, view };
}

afterEach(() => {
  cleanup();
});

describe('convolution sampled-product diagnostic', () => {
  it('compares periodic convolution with the phase-corrected DFT product', () => {
    const store = nonzeroOriginConvolutionStore();
    const state = store.getState();
    const check = estimateActiveDftProduct(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      state.sampling,
    );

    if (check === null) throw new Error('expected a product check');
    expect(check.status).toBe('consistent');
    expect(['stable', 'sampling-sensitive']).toContain(check.samplingStatus);
    expect(check.maxAbsoluteDifference).toBeLessThanOrEqual(check.identityTolerance);
    expect(check.diagnostics.join(' ')).toMatch(/origin phase|t_min/i);
  });

  it('labels the product as circular sampled data, not the continuous theorem', () => {
    const store = nonzeroOriginConvolutionStore();
    render(<ConvolutionView {...propsForConvolutionStore(store)} />);
    expect(screen.getByText(/periodic sampled convolution/i)).toBeTruthy();
    expect(screen.queryByText(/continuous convolution theorem/i)).toBeNull();
  });

  it('does not turn an unresolved source into a product verdict', () => {
    const store = makeStoreFromLatex(
      ['f(t)=1/(t-t)', 'g(t)=1', 'h(t)=\\operatorname{Convolution}(f(t),g(t))'],
      'transforms',
    );
    store.focusLine(store.getState().lines[2]?.id as string);
    const state = store.getState();
    const check = estimateActiveDftProduct(
      store.activeExpression(),
      state.workspace,
      state.parameterValues,
      state.sampling,
    );

    expect(check?.status).toBe('inconclusive');
    expect(check?.identityTolerance).toBe(Infinity);
    expect(check?.samplingStatus).toBe('unresolved');
  });

  it('shows the construction toggle without changing shared selection', () => {
    const store = nonzeroOriginConvolutionStore();
    const before = store.getState().selection;
    render(<ConvolutionView {...propsForConvolutionStore(store)} />);

    const toggle = screen.getByRole('checkbox', { name: /show convolution construction/i });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(store.getState().selection).toBe(before);
    expect(screen.getByText(/select or move over an output coordinate/i)).toBeTruthy();
  });

  it('renders a selected construction with the shared T readout', () => {
    const store = nonzeroOriginConvolutionStore();
    store.setSelection({ re: 1, im: 0 });
    render(<ConvolutionView {...propsForConvolutionStore(store)} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /show convolution construction/i }));

    expect(screen.getByText(/T =/i)).toBeTruthy();
    expect(screen.getByText(/accumulated integral/i)).toBeTruthy();
    expect(screen.getByRole('img', { name: /convolution construction at T=/i })).toBeTruthy();
  });
});
