/**
 * The keypad for multivariable calculus.
 *
 * What is added here is what the expression language can carry today: a list, which
 * is how a point or a vector field is written, and the surfaces worth looking at. The
 * operators that define the subject — the partial derivative, the gradient, the
 * multiple integrals, divergence and curl — are not in the language yet, and their
 * keys are inert and say why.
 */
import { key, plannedKey, type KeypadRow } from './types';

export const CALCULUS_FUNCTION_ROWS: readonly KeypadRow[] = [
  { kind: 'heading', title: 'Variables of a field' },
  {
    kind: 'wrap',
    keys: [
      key('x', 'x', 'The first real variable'),
      key('y', 'y', 'The second real variable'),
      key('z', 'z', 'In this subsystem, the third real variable'),
      key('u', 'u', 'A fourth name, when one is needed'),
    ],
  },
  { kind: 'heading', title: 'A list, for a vector or a point' },
  {
    kind: 'wrap',
    keys: [
      key('(x,y)', '\\left(x, y\\right)', 'A point in the plane'),
      key('(x,y,z)', '\\left(x, y, z\\right)', 'A point in space'),
      key('(−y,x)', '\\left(-y, x\\right)', 'A rotational planar field'),
      key('(a,b)', '\\left(#?, #?\\right)', 'An empty list of two entries'),
    ],
  },
  { kind: 'heading', title: 'Fields worth looking at' },
  {
    kind: 'wrap',
    keys: [
      key('x²+y²', 'x^{2}+y^{2}', 'A paraboloid'),
      key('x²−y²', 'x^{2}-y^{2}', 'A saddle'),
      key('e^-(x²+y²)', 'e^{-\\left(x^{2}+y^{2}\\right)}', 'A Gaussian surface'),
      key('sin(x)cos(y)', '\\sin\\left(x\\right)\\cos\\left(y\\right)', 'A sinusoidal field'),
      key('√(x²+y²)', '\\sqrt{x^{2}+y^{2}}', 'A distance from the origin'),
    ],
  },
];

export const CALCULUS_PLANNED_ROWS: readonly KeypadRow[] = [
  { kind: 'heading', title: 'Not yet in the expression language' },
  {
    kind: 'wrap',
    keys: [
      plannedKey('∂f/∂x', 'partial derivatives'),
      plannedKey('∇', 'the gradient'),
      plannedKey('∇·F', 'divergence'),
      plannedKey('∇×F', 'curl'),
      plannedKey('∫', 'a line or surface integral'),
      plannedKey('∬', 'a double integral'),
      plannedKey('∭', 'a triple integral'),
      plannedKey('∮', 'a closed line integral'),
      plannedKey('J', 'the Jacobian'),
    ],
  },
];
