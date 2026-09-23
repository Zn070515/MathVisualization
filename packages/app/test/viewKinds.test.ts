/**
 * Which view a mathematical object calls for.
 *
 * The claim being tested is that the *object* decides, not the subsystem. That is
 * easy to assert and easy to get wrong, so the table is written out in full: for
 * each signature, the views that suit it in the order they suit it, and the views
 * it actually opens on today.
 *
 * The opening views are stated rather than compared against the older behaviour.
 * They differ from it in one place — a complex function used to open on the
 * domain colouring *and* the mapped grid, and now opens on the colouring alone,
 * because the mapped grid is an addition to the plane rather than half of it —
 * and stating them is the only way that difference stays deliberate.
 */
import { describe, expect, it } from 'vitest';
import { C1, R1, R2, R3, type Signature, type Space } from '@mathviz/mathcore';
import {
  VIEW_KIND_STATUS,
  defaultViewKinds,
  drawableViewKinds,
  nominalViewKind,
  preferredViewKinds,
} from '../src/state/viewKinds';

const sig = (domain: Space, codomain: Space): Signature => ({ domain, codomain });

const kindsOf = (signature: Signature | undefined): string[] =>
  preferredViewKinds(signature).map(String);

describe('the taxonomy', () => {
  it('names every kind and says whether it can be drawn', () => {
    expect(Object.keys(VIEW_KIND_STATUS).sort()).toEqual([
      'cartesian-2d',
      'cartesian-3d',
      'complex-plane',
      'contour',
      'domain-coloring',
      'frequency-domain',
      'mapped-grid',
    ]);
  });

  it('never offers, or opens on, a kind it cannot draw', () => {
    // Every combination, so that no signature can quietly smuggle a blank frame
    // into the toolbar.
    for (const domain of [R1, R2, R3, C1]) {
      for (const codomain of [R1, R2, R3, C1]) {
        const signature = sig(domain, codomain);
        for (const kind of drawableViewKinds(signature)) {
          expect(VIEW_KIND_STATUS[kind]).toBe('available');
        }
        for (const view of defaultViewKinds(signature)) {
          expect(VIEW_KIND_STATUS[view.kind]).toBe('available');
        }
      }
    }
  });

  it('falls back to a space, not to a picture of nothing', () => {
    // With no signature to consult there is nothing to draw — and a field renderer
    // with nothing to render shows the user nothing at all. The complex plane and
    // a pair of axes are the worlds the mathematics happens in, so one of them is
    // on screen while the first expression is being typed. Calculus gets the plane
    // rather than the surface because with no function there is no height.
    expect(nominalViewKind('complex')).toBe('complex-plane');
    expect(nominalViewKind('transforms')).toBe('cartesian-2d');
    expect(nominalViewKind('calculus')).toBe('cartesian-2d');

    for (const subsystem of ['complex', 'transforms', 'calculus'] as const) {
      expect(VIEW_KIND_STATUS[nominalViewKind(subsystem)]).toBe('available');
    }
  });
});

describe('what each object calls for', () => {
  it('puts the plane first for a complex function, because a map of the plane lives on it', () => {
    expect(kindsOf(sig(C1, C1))).toEqual(['complex-plane', 'domain-coloring', 'mapped-grid']);
  });

  it('puts a pair of axes first for a function of one real variable', () => {
    expect(kindsOf(sig(R1, R1))).toEqual(['cartesian-2d']);
    // A complex-valued signal is still a curve over one real axis; the plane is
    // the second thing you might want, not the first.
    expect(kindsOf(sig(R1, C1))).toEqual(['cartesian-2d', 'complex-plane']);
  });

  it('gives a Fourier transform pair its time and frequency views', () => {
    expect(preferredViewKinds(sig(R1, C1), 'transform-pair')).toEqual([
      'cartesian-2d',
      'frequency-domain',
    ]);
    expect(defaultViewKinds(sig(R1, C1), 'transform-pair').map((view) => view.kind)).toEqual([
      'cartesian-2d',
      'frequency-domain',
    ]);
    expect(defaultViewKinds(sig(R1, C1), 'transform-pair')[1]?.mode).toBe('magnitude');
  });

  it('asks for a surface for a scalar over the plane, with the heatmap behind it', () => {
    expect(kindsOf(sig(R2, R1))).toEqual(['cartesian-3d', 'contour', 'domain-coloring']);
  });

  it('offers nothing where there is no honest picture', () => {
    // A scalar over R³ would need a fourth dimension to draw, and there is none.
    expect(kindsOf(sig(R3, R1))).toEqual([]);
    // A complex function to the reals has no plane picture either.
    expect(kindsOf(sig(C1, R1))).toEqual([]);
    // Two real inputs and two real outputs is a vector field: a different kind
    // of object with a different kind of picture.
    expect(kindsOf(sig(R2, R2))).toEqual([]);
    expect(kindsOf(undefined)).toEqual([]);
  });
});

describe('the views a workspace opens on', () => {
  it('are what the object calls for, minus anything not built yet', () => {
    expect(defaultViewKinds(sig(R1, R1)).map((view) => view.kind)).toEqual(['cartesian-2d']);
    expect(defaultViewKinds(sig(R1, C1)).map((view) => view.kind)).toEqual(['cartesian-2d']);
    // The plane is the space a map of the plane lives on, so it opens first and
    // the colouring of the map opens beside it. The mapped grid is a third
    // reading of the same map, and a thing to add rather than to be handed.
    expect(defaultViewKinds(sig(C1, C1)).map((view) => view.kind)).toEqual([
      'complex-plane',
      'domain-coloring',
    ]);
    // A scalar over the plane is a surface, and opens on one. The heatmap is the
    // same numbers read from above: a fine thing to add, and no longer the thing
    // you are handed instead of the surface.
    expect(defaultViewKinds(sig(R2, R1)).map((view) => view.kind)).toEqual(['cartesian-3d']);
  });

  it('gives each one the mode its codomain implies', () => {
    expect(defaultViewKinds(sig(C1, C1))[0]?.mode).toBe('complex');
    expect(defaultViewKinds(sig(R1, R1))[0]?.mode).toBe('real');
  });

  it('opens on nothing at all where there is nothing to draw', () => {
    // The caller falls back to a nominal pane; this must not invent one.
    expect(defaultViewKinds(sig(R3, R1))).toEqual([]);
    expect(defaultViewKinds(undefined)).toEqual([]);
  });
});
