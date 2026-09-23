import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DftDomainView } from '../src/views/DftDomainView';
import type { ViewRendererProps } from '../src/state/workspaceStore';
import { makeStoreFromLatex } from './helpers';

afterEach(() => {
  cleanup();
});

describe('DFT domain sampling controls', () => {
  it('commits an editable time window to the shared sampling state', () => {
    const store = makeStoreFromLatex(
      ['f(t)=\\cos(t)', 'D(\\omega)=\\operatorname{DFT}(f(t))'],
      'transforms',
    );
    store.focusLine(store.getState().lines[1]?.id as string);
    const view = store.getState().views.find((candidate) => candidate.kind === 'dft-domain');
    if (view === undefined) throw new Error('expected a DFT domain view');

    render(<DftDomainView {...({ store, view } satisfies ViewRendererProps)} />);
    const minimum = screen.getByLabelText('DFT time window minimum');
    const maximum = screen.getByLabelText('DFT time window maximum');
    fireEvent.change(minimum, { target: { value: '0.25' } });
    fireEvent.change(maximum, { target: { value: '8.25' } });
    fireEvent.blur(maximum);

    expect(store.getState().sampling.timeWindow).toEqual({ min: 0.25, max: 8.25 });
  });

  it('rejects an invalid window without changing the shared sampling state', () => {
    const store = makeStoreFromLatex(
      ['f(t)=\\cos(t)', 'D(\\omega)=\\operatorname{DFT}(f(t))'],
      'transforms',
    );
    store.focusLine(store.getState().lines[1]?.id as string);
    const view = store.getState().views.find((candidate) => candidate.kind === 'dft-domain');
    if (view === undefined) throw new Error('expected a DFT domain view');

    render(<DftDomainView {...({ store, view } satisfies ViewRendererProps)} />);
    const minimum = screen.getByLabelText('DFT time window minimum');
    const maximum = screen.getByLabelText('DFT time window maximum');
    fireEvent.change(minimum, { target: { value: '10' } });
    fireEvent.blur(minimum);

    expect(store.getState().sampling.timeWindow).toEqual({ min: -8, max: 8 });
    expect((minimum as HTMLInputElement).value).toBe('-8');
    expect((maximum as HTMLInputElement).value).toBe('8');
  });
});
