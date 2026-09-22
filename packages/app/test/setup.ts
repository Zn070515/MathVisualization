/**
 * Test environment setup.
 *
 * jsdom provides neither `ResizeObserver` nor a canvas backend, so both are
 * stubbed. Stubbing the canvas rather than installing a native one is deliberate:
 * the DOM tests are about interaction and state, not about pixels. The GPU path is
 * verified in a real browser instead, where it can actually be checked against the
 * CPU reference.
 */

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {
      // The views redraw on state changes in tests, so no callback is needed.
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverStub,
    writable: true,
  });
}

// jsdom logs a "not implemented" error for canvas contexts. Returning null is the
// honest answer here, and every view handles a missing context by showing its
// explanatory overlay.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext(): null {
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;

  // Layout is not computed in jsdom, so give canvases a size the views can use.
  Object.defineProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect', {
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 640,
      bottom: 400,
      width: 640,
      height: 400,
      toJSON: () => ({}),
    }),
    writable: true,
  });
}
