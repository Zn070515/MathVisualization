import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import * as mathcore from '@mathviz/mathcore';
import * as evaluationModule from '../src/views/evaluation';
import { ContourView } from '../src/views/ContourView';
import { makeStore } from './helpers';

const view = { id: 'contour-test', kind: 'contour' as const, mode: 'real' as const };

beforeEach(() => {
  cleanup();
  if (!HTMLCanvasElement.prototype.setPointerCapture) {
    HTMLCanvasElement.prototype.setPointerCapture = () => {};
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the contour view interaction', () => {
  it('does not turn a pan into a selection', () => {
    const store = makeStore(['f(x,y)=x^2+y^2'], 'calculus');
    const { container } = render(<ContourView store={store} view={view} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    if (canvas === null) return;

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 180, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 180, clientY: 100 });

    expect(store.getState().selection).toBeNull();
  });

  it('does not resample the field when only the shared cursor changes', () => {
    const evaluate = vi.spyOn(evaluationModule, 'makePointEvaluation');
    const sample = vi.spyOn(mathcore, 'sampleSurface');
    const store = makeStore(['f(x,y)=x^2+y^2'], 'calculus');
    render(<ContourView store={store} view={view} />);
    const evaluationsAfterRender = evaluate.mock.calls.length;
    const samplesAfterRender = sample.mock.calls.length;

    act(() => {
      store.setHover(mathcore.cx(1, 1));
    });

    expect(evaluate).toHaveBeenCalledTimes(evaluationsAfterRender);
    expect(sample).toHaveBeenCalledTimes(samplesAfterRender);
  });
});
