/**
 * The three subsystems.
 *
 * One description of each subsystem drives the homepage entries, the header
 * navigation, the route components and the examples offered in the expression
 * panel. The three are described in the same shape on purpose: GOAL.md requires
 * them to be equal in status, and a shared shape is the cheapest way to keep them
 * equal as the project grows.
 *
 * Capability status
 * -----------------
 * Each capability carries an honest status. `implemented` means there is code
 * behind it that does the mathematics and a test that checks it. `planned` means
 * it is not built. Nothing in between, and no capability is listed whose
 * mathematics is faked: an unimplemented capability appears in the interface as a
 * named intention, which is more useful than a button that returns a wrong
 * answer (GOAL.md 18).
 */
import type { MathObjectKind } from '@mathviz/mathcore';

export type SubsystemId = 'complex' | 'transforms' | 'calculus';

export interface Capability {
  readonly name: string;
  readonly summary: string;
  readonly status: 'implemented' | 'planned';
}

export interface SubsystemDefinition {
  readonly id: SubsystemId;
  readonly path: string;
  /** Ordering numeral, shown in the interface as a drafting-sheet index. */
  readonly index: string;
  readonly title: string;
  /** One line for the homepage entries. */
  readonly summary: string;
  /** The examples offered as starting points. They remain editable. */
  readonly examples: readonly string[];
  /** Object kinds this subsystem knows how to draw today. */
  readonly drawableKinds: readonly MathObjectKind[];
  readonly capabilities: readonly Capability[];
}

export const SUBSYSTEMS: readonly SubsystemDefinition[] = [
  {
    id: 'complex',
    path: '/complex',
    index: '01',
    title: 'Complex Analysis',
    summary: 'Functions of a complex variable, drawn as maps of the plane.',
    examples: ['f(z)=z^2', 'g(z)=sin(z)/(z^2+1)', 'h(z)=(z-1)/(z+1)', 'p(z)=1/z', 'z^a'],
    drawableKinds: ['complex-function', 'complex-path', 'real-function'],
    capabilities: [
      {
        name: 'The complex plane',
        summary:
          'Real and imaginary axes with a numbered grid, panning, and zooming about the pointer. Shows the shared point z and, for a map of the plane, its image f(z) joined to z so the correspondence is visible.',
        status: 'implemented',
      },
      {
        name: 'Domain colouring',
        summary: 'Argument as hue, modulus as brightness, with modulus bands and phase contours.',
        status: 'implemented',
      },
      {
        name: 'Magnitude, phase, real and imaginary views',
        summary: 'Each part of the value as its own scalar field, over the same plane.',
        status: 'implemented',
      },
      {
        name: 'Mapped grid',
        summary:
          'The image of the coordinate grid under the function, showing how it deforms the plane. The frame is fitted to the whole image and reports its range; it cannot be zoomed yet, so a map whose image spans several orders of magnitude is drawn compressed.',
        status: 'implemented',
      },
      {
        name: 'Linked cursor and selection',
        summary: 'One shared point across every open view, with the exact value read out.',
        status: 'implemented',
      },
      {
        name: 'Parameters',
        summary: 'A real assignment becomes a slider that every dependent expression follows live.',
        status: 'implemented',
      },
      {
        name: 'Symbolic derivative',
        summary: 'The derivative in closed form, from the symbolic engine when it is running.',
        status: 'implemented',
      },
      {
        name: 'Cauchy–Riemann residuals',
        summary: 'u_x - v_y and u_y + v_x as fields, showing where the equations hold.',
        status: 'planned',
      },
      {
        name: 'Zeros, poles and their orders',
        summary:
          'Where a function vanishes and where it blows up, marked on the plane — filled for a zero, open for a pole — with the order reported. Found by the argument principle rather than by a threshold on |f|, so a double zero is reported as one of order two and not as a single one.',
        status: 'implemented',
      },
      {
        name: 'Taylor and Laurent series',
        summary: 'Expansions about a point, with the convergence disc or annulus drawn.',
        status: 'planned',
      },
      {
        name: 'Contour integrals and residues',
        summary:
          'A contour written as an expression, ∮_gamma f(z) dz, over t ∈ [0, 2π]. Its value appears under the line that asked for it, together with the interval, whether the path actually closed, and how accurate the quadrature is. The contour and its accumulated integral are drawn in the plane. For a closed contour the residue theorem is worked out independently — the poles the winding number puts inside, each with its residue — and shown against the integral, which is the check rather than a restatement.',
        status: 'implemented',
      },
      {
        name: 'Branch points and cuts',
        summary: 'Where a multi-valued function changes branch, and how the cut is placed.',
        status: 'planned',
      },
    ],
  },
  {
    id: 'transforms',
    path: '/transforms',
    index: '02',
    title: 'Integral Transforms',
    summary: 'Signals in the time domain and what they become in the transform domain.',
    examples: ['f(t)=exp(-t^2)', 'g(t)=exp(-t)', 'h(t)=sin(t)', 'p(t)=1/(1+t^2)'],
    drawableKinds: ['real-function', 'complex-path', 'transform-pair'],
    capabilities: [
      {
        name: 'Expression typing',
        summary: 'A function of t is recognised as a real signal or a complex-valued one.',
        status: 'implemented',
      },
      {
        name: 'Time-domain graph',
        summary:
          'The signal drawn on a pair of axes with a graduated, numbered grid, the real and imaginary parts separated when the signal is complex, panning, zooming about the pointer, and a Fit control that frames the measured range.',
        status: 'implemented',
      },
      {
        name: 'Points of interest, and a cursor that takes them',
        summary:
          'Zero crossings and turning points marked on the curve and labelled. A crossing reads as a coordinate; a turn reads as a maximum or a minimum, so a minimum that sits on the axis is never passed off as a root. Moving the pointer near one takes it exactly, and the readout prints the value the analysis found rather than the pixel’s.',
        status: 'implemented',
      },
      {
        name: 'Linked cursor and selection',
        summary: 'One shared value of t across the views that are open.',
        status: 'implemented',
      },
      {
        name: 'Fourier transform',
        summary:
          'A finite-window numerical transform with magnitude, phase, real and imaginary frequency views, a persistent frequency frame with an explicit Fit action, and the angular-frequency convention stated.',
        status: 'implemented',
      },
      {
        name: 'Fourier series and Gibbs phenomenon',
        summary: 'Partial sums of a periodic signal, with the overshoot at a jump made visible.',
        status: 'planned',
      },
      {
        name: 'DFT and sampling',
        summary:
          'A finite sampled signal, its direct discrete Fourier spectrum, signed frequency bins, Nyquist limit, and sampling-sensitive aliasing diagnostics.',
        status: 'implemented',
      },
      {
        name: 'FFT algorithm',
        summary: 'An accelerated discrete Fourier transform with its computational trade-offs.',
        status: 'planned',
      },
      {
        name: 'Convolution',
        summary:
          'The reflected and shifted kernel, the pointwise product and the accumulated area, animated in t.',
        status: 'planned',
      },
      {
        name: 'Laplace transform and the s-plane',
        summary:
          'F(s) over the complex plane, with poles, zeros and the region of convergence shaded.',
        status: 'planned',
      },
      {
        name: 'Inverse transforms',
        summary: 'Reconstruction from the transform domain, symbolically and numerically.',
        status: 'planned',
      },
    ],
  },
  {
    id: 'calculus',
    path: '/calculus',
    index: '03',
    title: 'Multivariable Calculus',
    summary: 'Scalar and vector fields, their local structure, and the integrals over them.',
    examples: [
      'f(x,y)=x^2-y^2',
      'g(x,y)=x^2+y^2',
      'h(x,y)=sin(x)*cos(y)',
      'p(x,y)=exp(-(x^2+y^2))',
    ],
    drawableKinds: ['scalar-field', 'real-function'],
    capabilities: [
      {
        name: 'Surface of z = f(x, y)',
        summary:
          'The field drawn as a surface over the plane, coloured by its height with the same ramp the heatmap uses, on a camera of its own with orbit, pan and zoom. A point where the function has no value is a hole in the surface rather than a bridge across it.',
        status: 'implemented',
      },
      {
        name: 'Scalar fields as a heatmap',
        summary:
          'The same field read from above: f(x, y) shaded over the plane, with the value range stated.',
        status: 'implemented',
      },
      {
        name: 'Coordinate grid over the field',
        summary: 'The plane grid and axes, so a feature can be located by its coordinates.',
        status: 'implemented',
      },
      {
        name: 'Linked cursor and selection',
        summary: 'One shared point, with f and its coordinate read out.',
        status: 'implemented',
      },
      {
        name: 'Parameters',
        summary: 'A real assignment becomes a slider; f(x, y) = x^2 - a y^2 redraws as it moves.',
        status: 'implemented',
      },
      {
        name: 'Contours and level sets',
        summary: 'Level curves of the field, drawn over the heatmap or on their own.',
        status: 'implemented',
      },
      {
        name: 'Gradient field',
        summary:
          'Numerical ∇f arrows are drawn over the same level sets, with the vector and its magnitude available at the linked point.',
        status: 'implemented',
      },
      {
        name: 'Directional derivatives',
        summary:
          'Select a point, drag an explicit unit-direction handle, and read the numerical rate of change D_u f = ∇f · u with its sampling uncertainty.',
        status: 'implemented',
      },
      {
        name: 'Tangent planes and linear approximation',
        summary:
          'A numerically derived tangent plane at a selected point, with sampled error of the linear approximation and unresolved samples kept visible.',
        status: 'implemented',
      },
      {
        name: 'Critical points and extrema',
        summary:
          'Selected points are checked with a numerical gradient and Hessian; local minima, maxima and saddle points are reported only when refinement evidence separates the classification from uncertainty.',
        status: 'implemented',
      },
      {
        name: 'Double and triple integrals',
        summary: 'A region, its iterated form, and the accumulated volume.',
        status: 'planned',
      },
      {
        name: 'Coordinate changes and Jacobians',
        summary:
          'Polar, cylindrical and spherical coordinates, with the Jacobian determinant as an area or volume factor.',
        status: 'planned',
      },
      {
        name: 'Vector fields, divergence and curl',
        summary:
          'Arrows, streamlines, divergence as a source density and curl as a local rotation.',
        status: 'planned',
      },
      {
        name: 'Line and surface integrals',
        summary:
          'Work along a path, flux through a surface, and the orientation conventions that fix their signs.',
        status: 'planned',
      },
      {
        name: 'Green, divergence and Stokes theorems',
        summary:
          'Both sides of each theorem computed and shown against each other on the same picture.',
        status: 'planned',
      },
    ],
  },
];

export function subsystemById(id: SubsystemId): SubsystemDefinition {
  const found = SUBSYSTEMS.find((subsystem) => subsystem.id === id);
  if (found === undefined) throw new Error(`unknown subsystem: ${id}`);
  return found;
}

export function implementedCapabilities(subsystem: SubsystemDefinition): readonly Capability[] {
  return subsystem.capabilities.filter((capability) => capability.status === 'implemented');
}
