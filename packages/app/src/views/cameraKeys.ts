/**
 * Moving the camera from the keyboard.
 *
 * The same keys in every view that has a camera, because a reader who has learnt
 * that the arrow keys pan should not have to learn it again in the next pane. The
 * field view had the full set and the plot view had a quarter of it, and their
 * pan steps disagreed by a factor of two — the field view moved by a fraction of
 * the *half*-width and the plot view by a fraction of the full width, so the same
 * keypress moved the two pictures by different amounts.
 *
 * The step is a fraction of the half-width, which is what the field view did:
 * whatever the zoom, one keypress moves the view by the same visible amount.
 */
import type { WorkspaceStore } from '../state/workspaceStore';

/** How far one arrow keypress moves the camera, as a fraction of the half-width. */
export const PAN_FRACTION = 0.15;

/** Factors one press of `+` and `-` scale by. */
export const ZOOM_IN = 0.85;
export const ZOOM_OUT = 1.18;

/**
 * Apply a camera key, and report whether it was one.
 *
 * Returns false for any other key so a caller can fall through to its own
 * handling rather than having to know the list.
 */
export function handleCameraKey(
  event: { readonly key: string; preventDefault(): void },
  store: WorkspaceStore,
): boolean {
  const halfWidth = store.getState().viewport.halfWidth;
  const step = halfWidth * PAN_FRACTION;

  switch (event.key) {
    case 'ArrowLeft':
      store.panViewport(-step, 0);
      break;
    case 'ArrowRight':
      store.panViewport(step, 0);
      break;
    case 'ArrowUp':
      store.panViewport(0, step);
      break;
    case 'ArrowDown':
      store.panViewport(0, -step);
      break;
    case '+':
    case '=':
      store.zoomViewport(ZOOM_IN);
      break;
    case '-':
      store.zoomViewport(ZOOM_OUT);
      break;
    case '0':
      store.resetViewport();
      break;
    default:
      return false;
  }

  // Only once a key is recognised: the page must still be able to scroll and the
  // browser must still be able to do whatever else an unused key does.
  event.preventDefault();
  return true;
}
