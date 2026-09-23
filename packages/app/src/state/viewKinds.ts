/**
 * Which views exist, which one a mathematical object calls for, and which are
 * built.
 *
 * The rule this encodes is a statement about the mathematics rather than about
 * React, which is why it lives outside the provider: a view is offered when the
 * object in hand can be drawn in it, not when a subsystem happens to have been
 * wired to it.
 *
 * The previous arrangement had the *subsystem* decide the opening views —
 * `calculus` opens on a field, `transforms` on a plot — which got the case that
 * matters most exactly backwards: `f(x, y) = x² − y²` is a surface, and it opened
 * as a heatmap because that is what the calculus subsystem had. The signature is
 * already computed, and it is a better answer than the subsystem is.
 */
import type { FieldMode, MathObjectKind, Signature, Space } from '@mathviz/mathcore';
import type { SubsystemId } from '../subsystems';
import type { ViewBlueprint, ViewKind } from './workspaceStore';

/**
 * Whether a view kind can be drawn at all.
 *
 * This is *not* a claim about how complete the view is — the capability list is
 * where that honesty lives. It says only whether a renderer exists, and so
 * whether the kind may be offered and chosen as a default. A kind that is
 * `planned` is never offered, because a button that opens a blank frame is worse
 * than no button.
 */
export type ViewStatus = 'available' | 'planned';

export const VIEW_KIND_STATUS: Readonly<Record<ViewKind, ViewStatus>> = {
  'cartesian-2d': 'available',
  'cartesian-3d': 'available',
  'complex-plane': 'available',
  contour: 'available',
  'domain-coloring': 'available',
  'frequency-domain': 'available',
  'mapped-grid': 'available',
  gradient: 'available',
};

/** Which mode is the natural default for a codomain. */
export function defaultModeFor(codomain: Space | undefined): FieldMode {
  if (codomain === undefined) return 'complex';
  return codomain.kind === 'C' ? 'complex' : 'real';
}

/**
 * Every view that can honestly draw this signature, most natural first.
 *
 * The order is the preference, and the first entry is the one the object is
 * "for". Where a signature has no entry the list is empty, and the caller says so
 * rather than drawing something that does not mean what it appears to: an `R³`
 * scalar field would need a fourth dimension, and there is none.
 */
export function preferredViewKinds(
  signature: Signature | undefined,
  classification?: MathObjectKind,
): readonly ViewKind[] {
  if (signature === undefined) return [];
  const { domain, codomain } = signature;

  if (classification === 'transform-pair') {
    return domain.kind === 'R' && domain.dim === 1 && codomain.kind === 'C'
      ? ['cartesian-2d', 'frequency-domain']
      : [];
  }

  // A complex function is a map of the plane, so the plane is its home. Domain
  // colouring and the mapped grid are then two ways of *showing* that map, which
  // is why they follow it rather than replacing it.
  if (domain.kind === 'C') {
    return codomain.kind === 'C' ? ['complex-plane', 'domain-coloring', 'mapped-grid'] : [];
  }

  // A function of one real variable is a curve on a pair of axes, whether or not
  // its values are complex.
  if (domain.dim === 1) {
    return codomain.kind === 'C' ? ['cartesian-2d', 'complex-plane'] : ['cartesian-2d'];
  }

  // A scalar over the plane is a surface. Contours and the heatmap are two
  // readings from above of the same sampled field.
  if (domain.dim === 2) {
    return codomain.kind === 'R' && codomain.dim === 1
      ? ['cartesian-3d', 'contour', 'gradient', 'domain-coloring']
      : [];
  }

  return [];
}

/** The subset of {@link preferredViewKinds} that can actually be drawn today. */
export function drawableViewKinds(
  signature: Signature | undefined,
  classification?: MathObjectKind,
): readonly ViewKind[] {
  return preferredViewKinds(signature, classification).filter(
    (kind) => VIEW_KIND_STATUS[kind] === 'available',
  );
}

/**
 * The views a store opens with, when it has none of its own.
 *
 * Deliberately not "whatever is available": the opening is a statement about what
 * this kind of object is for, and the fallbacks that a status filter would
 * otherwise admit are not equally good answers. A complex function opens on the
 * plane and the colouring; the mapped grid is a fine thing to add and a poor
 * thing to be handed.
 */
export function defaultViewKinds(
  signature: Signature | undefined,
  classification?: MathObjectKind,
): readonly ViewBlueprint[] {
  return intendedDefaults(signature, classification)
    .filter((kind) => VIEW_KIND_STATUS[kind] === 'available')
    .map((kind) => ({
      kind,
      mode: kind === 'frequency-domain' ? 'magnitude' : defaultModeFor(signature?.codomain),
    }));
}

function intendedDefaults(
  signature: Signature | undefined,
  classification?: MathObjectKind,
): readonly ViewKind[] {
  if (signature === undefined) return [];
  const { domain, codomain } = signature;

  if (classification === 'transform-pair') {
    return domain.kind === 'R' && domain.dim === 1 && codomain.kind === 'C'
      ? ['cartesian-2d', 'frequency-domain']
      : [];
  }

  if (domain.kind === 'C') return codomain.kind === 'C' ? ['complex-plane', 'domain-coloring'] : [];
  if (domain.dim === 1) return ['cartesian-2d'];
  // The surface alone. A scalar over the plane *is* a surface, and opening on the
  // heatmap as well would leave the reading-from-above occupying the default slot
  // exactly as it used to — the thing this taxonomy was brought in to fix. The
  // heatmap is one `Add view` away and is the same numbers, so nothing is lost by
  // not opening with it.
  //
  // Before there was a surface renderer this list resolved to nothing and the
  // store fell back to its nominal pane, which for this subsystem is the heatmap;
  // so the behaviour it replaces was preserved by the fallback rather than by the
  // list, and the list was free to state the intent.
  if (domain.dim === 2 && codomain.kind === 'R' && codomain.dim === 1) return ['cartesian-3d'];
  return [];
}

/**
 * The pane a subsystem opens with when there is nothing to infer from.
 *
 * An empty workspace, or lines that have not parsed — there is no signature to
 * consult, so this is not a guess about the object. It is a guess about the
 * *space*: the complex plane, or a pair of axes. Those are the worlds the
 * mathematics happens in, and having one of them on screen while the first
 * expression is being typed is what makes the surface feel like paper rather than
 * like a form. A field renderer with nothing to render is the one answer that
 * shows the user nothing at all.
 *
 * `calculus` gets the plane rather than the surface because with no function there
 * is no height: two dimensions is the neutral world, and the surface arrives when
 * there is something to be the height *of*.
 */
export function nominalViewKind(subsystem: SubsystemId): ViewKind {
  const nominal: Readonly<Record<SubsystemId, ViewKind>> = {
    complex: 'complex-plane',
    transforms: 'cartesian-2d',
    calculus: 'cartesian-2d',
  };
  return nominal[subsystem];
}
