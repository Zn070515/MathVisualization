/**
 * The keypad for integral transforms.
 *
 * A signal in this subsystem is a function of a real variable, so what is added here
 * is the vocabulary of signals rather than the vocabulary of operators. Fourier is
 * now a live expression operation; the other transform operators remain planned
 * until their AST and numerical semantics exist.
 */
import { functionKey, key, plannedKey, type KeypadRow } from './types';

export const TRANSFORMS_FUNCTION_ROWS: readonly KeypadRow[] = [
  { kind: 'heading', title: 'Signals' },
  {
    kind: 'wrap',
    keys: [
      key('e^-t²', 'e^{-t^{2}}', 'A Gaussian pulse'),
      key('e^-at', 'e^{-a t}', 'Exponential decay'),
      key('1/(1+t²)', '\\frac{1}{1+t^{2}}', 'A Lorentzian'),
      key('e^-|t|', 'e^{-\\left|t\\right|}', 'A two-sided exponential'),
      key('1/(1+e^-t)', '\\frac{1}{1+e^{-t}}', 'A logistic step'),
    ],
  },
  { kind: 'heading', title: 'In the time variable' },
  {
    kind: 'wrap',
    keys: [
      key('t', 't', 'The time variable'),
      key('a', 'a', 'A parameter, for a family of signals'),
      functionKey('sin', 'A sinusoid'),
      functionKey('cos', 'A cosinusoid'),
      functionKey('exp', 'Exponential in t'),
    ],
  },
  { kind: 'heading', title: 'Transform operations' },
  {
    kind: 'wrap',
    keys: [
      key('ℱ', '\\operatorname{Fourier}\\left(#?\\right)', 'A numerical Fourier transform'),
      key('DFT', '\\operatorname{DFT}\\left(#?\\right)', 'A numerical discrete Fourier transform'),
      key(
        'Convolution',
        '\\operatorname{Convolution}\\left(#0,#1\\right)',
        'A finite-window numerical convolution',
      ),
    ],
  },
];

export const TRANSFORMS_PLANNED_ROWS: readonly KeypadRow[] = [
  { kind: 'heading', title: 'Not yet in the expression language' },
  {
    kind: 'wrap',
    keys: [
      plannedKey('ℱ⁻¹', 'the inverse Fourier transform'),
      plannedKey('ℒ', 'the Laplace transform'),
      plannedKey('ℒ⁻¹', 'the inverse Laplace transform'),
      plannedKey('δ', 'the impulse'),
      plannedKey('u(t)', 'the unit step'),
      plannedKey('∫', 'integration'),
      plannedKey('Σ', 'Fourier series'),
    ],
  },
];
