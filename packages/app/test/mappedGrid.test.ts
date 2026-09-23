import { describe, expect, it } from 'vitest';
import { splitMappedPolyline } from '../src/views/mappedGrid';

describe('mapped-grid polyline segmentation', () => {
  it('breaks the image line at an undefined sample', () => {
    const segments = splitMappedPolyline([
      { re: 0, im: 0 },
      { re: 1, im: 1 },
      null,
      { re: 3, im: 3 },
      { re: 4, im: 4 },
    ]);

    expect(segments).toEqual([
      [
        { re: 0, im: 0 },
        { re: 1, im: 1 },
      ],
      [
        { re: 3, im: 3 },
        { re: 4, im: 4 },
      ],
    ]);
  });

  it('does not return one-point fragments', () => {
    expect(splitMappedPolyline([{ re: 0, im: 0 }, null, { re: 2, im: 2 }])).toEqual([]);
  });
});
