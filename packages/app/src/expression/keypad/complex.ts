/**
 * The keypad for complex analysis.
 *
 * What is added here is exactly what the canonical AST can already represent about a
 * complex function: the imaginary unit, the parts, the argument, the conjugate, the
 * modulus, and the elementary functions that are complex-valued. Each of those is a
 * function the evaluator, the shader and the symbolic lowering all understand, so
 * pressing a key inserts mathematics that will parse, type, evaluate and draw.
 */
import { key, mathKey, plannedKey, type KeypadRow } from './types';

export const COMPLEX_FUNCTION_ROWS: readonly KeypadRow[] = [
  { kind: 'heading', title: 'Complex arithmetic' },
  {
    kind: 'wrap',
    keys: [
      key('i', 'i', 'The imaginary unit'),
      key('z̄', '\\overline{#?}', 'Complex conjugate'),
      key('|z|', '\\left|#?\\right|', 'Modulus'),
      key('z²', '^{2}', 'Square'),
      key('z⁻¹', '^{-1}', 'Reciprocal, written as a negative power'),
    ],
  },
  { kind: 'heading', title: 'Parts of a complex value' },
  {
    kind: 'wrap',
    keys: [
      key('Re', '\\operatorname{Re}\\left(#?\\right)', 'Real part'),
      key('Im', '\\operatorname{Im}\\left(#?\\right)', 'Imaginary part'),
      key('arg', '\\operatorname{arg}\\left(#?\\right)', 'Principal argument, in (-π, π]'),
    ],
  },
  // The exponential, the logarithm and the trigonometric and hyperbolic functions are
  // in the shared groups below rather than repeated here: they mean the same thing in
  // every subsystem, and offering each of them twice would be two keys for one idea.
  { kind: 'heading', title: 'Paths' },
  {
    kind: 'wrap',
    keys: [
      key('γ(t)', '\\gamma\\left(t\\right)', 'A path: a function of a real parameter'),
      key('eⁱᵗ', 'e^{i t}', 'The unit circle, traversed once'),
      // Three boxes, and the caret lands in the first: the path, the integrand, and the
      // variable. The order is the order they are read, which is the order the
      // differential scan needs them in.
      mathKey('∮', '\\oint_{#?}\\left(#?\\right)\\,d#?', 'A contour integral around a path'),
    ],
  },
];

/**
 * Complex analysis the expression language does not read yet.
 *
 * Listed so the shape of the subsystem is visible from the input surface. None of them
 * insert anything: a key that produced mathematics the parser rejects would be a button
 * that returns a sentence, and a key that returned a number would be inventing an
 * answer. The mathematics behind each is recorded in the capability list, where its
 * status is stated in full.
 */
export const COMPLEX_PLANNED_ROWS: readonly KeypadRow[] = [
  { kind: 'heading', title: 'Not yet in the expression language' },
  {
    kind: 'wrap',
    keys: [
      plannedKey('d/dz', 'differentiation'),
      plannedKey('∫', 'integration'),
      plannedKey('Σ', 'series'),
      plannedKey('Res', 'residues'),
      plannedKey('T_N(z)', 'Taylor polynomials'),
    ],
  },
];
