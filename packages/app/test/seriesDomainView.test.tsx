import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SeriesDomainView } from '../src/views/SeriesDomainView';
import type { ViewRendererProps } from '../src/state/workspaceStore';
import { makeStoreFromLatex } from './helpers';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  if (!HTMLCanvasElement.prototype.setPointerCapture) {
    HTMLCanvasElement.prototype.setPointerCapture = () => {};
  }
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

function firePointer(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  values: { readonly clientX: number; readonly clientY: number },
): void {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: values.clientX },
    clientY: { value: values.clientY },
    pointerId: { value: 1 },
  });
  fireEvent(element, event);
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

  it('persists a drag pan and wheel zoom in the shared series viewport', () => {
    const store = renderSeriesView();
    const canvas = screen.getByRole('img', { name: /Fourier series partial sums/i });

    firePointer(canvas, 'pointerdown', { clientX: 160, clientY: 120 });
    firePointer(canvas, 'pointermove', { clientX: 240, clientY: 150 });
    firePointer(canvas, 'pointerup', { clientX: 240, clientY: 150 });

    const panned = store.getState().seriesViewport;
    expect(panned).not.toBeNull();

    fireEvent.wheel(canvas, { deltaY: -120, clientX: 320, clientY: 200 });

    const zoomed = store.getState().seriesViewport;
    expect(zoomed).not.toBeNull();
    expect((zoomed?.xMax ?? 0) - (zoomed?.xMin ?? 0)).toBeLessThan(
      (panned?.xMax ?? 0) - (panned?.xMin ?? 0),
    );
  });

  it('keeps the derived frame stable when only the series order changes', () => {
    const store = renderSeriesView();
    const initialRange = screen.getByText(/t ∈ \[/).textContent;

    fireEvent.change(screen.getByLabelText('Fourier series order'), { target: { value: '32' } });

    expect(store.getState().seriesViewport).toBeNull();
    expect(screen.getByText(/t ∈ \[/).textContent).toBe(initialRange);
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
