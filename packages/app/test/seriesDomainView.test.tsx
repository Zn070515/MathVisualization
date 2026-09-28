import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SeriesDomainView } from '../src/views/SeriesDomainView';
import type { ViewRendererProps } from '../src/state/workspaceStore';
import { makeStoreFromLatex } from './helpers';

afterEach(() => {
  cleanup();
});

function renderSeriesView(
  lines = [
    'f\\left(u\\right)=\\cos\\left(u\\right)',
    'S\\left(t\\right)=\\operatorname{FourierSeries}\\left(f\\left(u\\right),2\\pi\\right)',
  ],
) {
  const store = makeStoreFromLatex(lines, 'transforms');
  store.focusLine(store.getState().lines[1]?.id as string);
  const view = store.getState().views.find((candidate) => candidate.kind === 'series-domain');
  if (view === undefined) throw new Error('expected a Fourier series domain view');
  render(<SeriesDomainView {...({ store, view } satisfies ViewRendererProps)} />);
  return store;
}

describe('Fourier series domain view', () => {
  it('renders linked source and partial-sum controls with sampled diagnostics', () => {
    const store = renderSeriesView();

    expect(screen.getByRole('img', { name: /Fourier series partial sums/i })).toBeTruthy();
    expect(screen.getByLabelText('Fourier series order')).toBeTruthy();
    expect(screen.getByLabelText('Fourier series integration intervals')).toBeTruthy();
    expect(screen.getByText(/P =/i)).toBeTruthy();
    expect(screen.getByText(/Q_eff/i)).toBeTruthy();
    expect(screen.getByText(/refined/i)).toBeTruthy();
    expect(store.getState().seriesSettings).toEqual({ order: 16, integrationSampleCount: 64 });
  });

  it('updates shared settings without silently replacing an explicit frame', () => {
    const store = renderSeriesView();
    const frame = { xMin: -4, xMax: 4, yMin: -3, yMax: 3 };
    store.setSeriesViewport(frame);

    fireEvent.change(screen.getByLabelText('Fourier series order'), { target: { value: '24' } });

    expect(store.getState().seriesSettings.order).toBe(24);
    expect(store.getState().seriesViewport).toEqual(frame);
  });

  it('keeps an unresolved estimate visibly unresolved', () => {
    renderSeriesView([
      'f\\left(u\\right)=\\frac{1}{u-u}',
      'S\\left(t\\right)=\\operatorname{FourierSeries}\\left(f\\left(u\\right),2\\pi\\right)',
    ]);

    expect(screen.getByRole('status').textContent).toMatch(/unresolved|undefined|non-finite/i);
    expect(screen.getByText(/refinement unavailable/i)).toBeTruthy();
    expect(screen.queryByText(/partial sum drawn/i)).toBeNull();
  });
});
