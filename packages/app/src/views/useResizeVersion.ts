/**
 * A counter that changes when an element's box changes.
 *
 * A canvas is not a DOM element that redraws itself: its contents are a bitmap,
 * and the element being resized resizes nothing inside it. So a view has to
 * notice, and every view that draws has to notice — the field view did not, and
 * the consequence was that resizing the window left its backing store stale
 * until something else happened to change, which is the sort of bug that looks
 * like a rendering problem and is actually a missing subscription.
 *
 * Returning a number rather than taking a callback keeps this a value: the draw
 * effect lists it as a dependency, which is the same shape as every other reason
 * a view redraws.
 *
 * Note the gap this does not cover: moving a window between displays of
 * different density changes the pixel ratio without changing the CSS box, so no
 * `ResizeObserver` fires. `pixelSize` still caps the ratio at 2, so the result is
 * a slightly soft picture on a 3× display rather than a wrong one.
 */
import { useEffect, useState, type RefObject } from 'react';

export function useResizeVersion(ref: RefObject<Element | null>): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      setVersion((current) => current + 1);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return version;
}
