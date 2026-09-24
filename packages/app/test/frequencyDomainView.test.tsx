import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FrequencyDomainView } from '../src/views/FrequencyDomainView';
import type { ViewRendererProps } from '../src/state/workspaceStore';
import { makeStoreFromLatex } from './helpers';

afterEach(() => {
  cleanup();
});

function renderFourierView() {
  const store = makeStoreFromLatex(
    ['f(t)=\\exp\\left(-t^{2}\\right)', 'F(\\omega)=\\operatorname{Fourier}(f(t))'],
    'transforms',
  );
  store.focusLine(store.getState().lines[1]?.id as string);
  const view = store.getState().views.find((candidate) => candidate.kind === 'frequency-domain');
  if (view === undefined) throw new Error('expected a Fourier frequency-domain view');
  render(<FrequencyDomainView {...({ store, view } satisfies ViewRendererProps)} />);
  return store;
}

describe('continuous Fourier sampling controls', () => {
  it('commits the shared time window and quadrature sample count', () => {
    const store = renderFourierView();
    const minimum = screen.getByLabelText('Fourier time window minimum');
    const maximum = screen.getByLabelText('Fourier time window maximum');
    fireEvent.change(minimum, { target: { value: '0' } });
    fireEvent.change(maximum, { target: { value: '4' } });
    fireEvent.blur(maximum);
    fireEvent.change(screen.getByLabelText('Fourier time sample count'), {
      target: { value: '128' },
    });

    expect(store.getState().sampling.timeWindow).toEqual({ min: 0, max: 4 });
    expect(store.getState().sampling.sampleCount).toBe(128);
  });

  it('rejects an invalid Fourier time window and restores the draft', () => {
    const store = renderFourierView();
    const minimum = screen.getByLabelText('Fourier time window minimum');
    const maximum = screen.getByLabelText('Fourier time window maximum');
    fireEvent.change(minimum, { target: { value: '10' } });
    fireEvent.blur(minimum);

    expect(store.getState().sampling.timeWindow).toEqual({ min: -8, max: 8 });
    expect((minimum as HTMLInputElement).value).toBe('-8');
    expect((maximum as HTMLInputElement).value).toBe('8');
  });
});
