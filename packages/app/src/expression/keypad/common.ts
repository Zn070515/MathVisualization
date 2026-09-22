/**
 * The keypad every subsystem shares.
 *
 * Two of the three pages are the same everywhere — the digits and the letters —
 * because typing mathematics does not change meaning between complex analysis and
 * multivariable calculus. The function page is where a subsystem differs, and it is
 * composed rather than replaced: see `keypadFor`.
 *
 * Every key here inserts LaTeX the canonical AST reads. Nothing in this file is
 * decorative: if a symbol is not in the expression language it is not a live key.
 */
import {
  actionKey,
  functionKey,
  key,
  type KeypadKey,
  type KeypadPage,
  type KeypadRow,
} from './types';

const digit = (value: string): KeypadKey => key(value, value, value);

/**
 * The numeric page.
 *
 * Laid out for entering a formula rather than as a list of buttons: the digits keep
 * their calculator arrangement, the operators sit in the right-hand column where a
 * right-handed typist reaches, and the structural keys — fraction, power, radical,
 * modulus — share the lower rows, because those are the ones reached for while
 * composing rather than while counting.
 */
export const NUMERIC_PAGE: KeypadPage = {
  id: 'numeric',
  label: '123',
  title: 'Numbers and operators',
  rows: [
    {
      kind: 'keys',
      keys: [
        digit('7'),
        digit('8'),
        digit('9'),
        // Division is written as a fraction, because that is what it is.
        key('÷', '\\frac{#@}{#?}', 'Fraction: divide by'),
      ],
    },
    {
      kind: 'keys',
      keys: [digit('4'), digit('5'), digit('6'), key('×', '\\cdot ', 'Multiply')],
    },
    {
      kind: 'keys',
      keys: [digit('1'), digit('2'), digit('3'), key('−', '-', 'Subtract')],
    },
    {
      kind: 'keys',
      keys: [
        digit('0'),
        key('.', '.', 'Decimal point'),
        key(',', ',', 'Comma, for a second variable or a list'),
        key('+', '+', 'Add'),
      ],
    },
    {
      kind: 'keys',
      keys: [
        key('( )', '\\left(#?\\right)', 'Parentheses, with the caret inside'),
        key('=', '=', 'Equals, to define a function or a parameter'),
        key('i', 'i', 'The imaginary unit'),
        key('π', '\\pi', 'Pi'),
      ],
    },
    {
      kind: 'keys',
      keys: [
        key('xⁿ', '^{#?}', 'Power'),
        key('√', '\\sqrt{#?}', 'Square root'),
        key('|x|', '\\left|#?\\right|', 'Absolute value or modulus'),
        key('e', 'e', "Euler's number"),
      ],
    },
    {
      kind: 'keys',
      keys: [
        actionKey('⌫', 'backspace', 'Delete backwards', true),
        actionKey('↵', 'enter', 'Start a new expression', true),
      ],
    },
  ],
};

/** A whole alphabet, in rows of seven. */
function letterRows(): KeypadRow[] {
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const rows: KeypadRow[] = [];
  for (let start = 0; start < letters.length; start += 7) {
    rows.push({
      kind: 'keys',
      keys: letters
        .slice(start, start + 7)
        .map((letter) => key(letter, letter, `The variable ${letter}`)),
    });
  }
  return rows;
}

/**
 * The Greek letters the three subsystems use.
 *
 * Inserted as commands, so the field receives `\gamma` rather than the five letters
 * g·a·m·m·a. The AST stores them under their names, which is why `\pi` and `\tau`
 * arrive as the constants they are.
 */
const GREEK: readonly KeypadKey[] = [
  key('α', '\\alpha', 'alpha'),
  key('β', '\\beta', 'beta'),
  key('γ', '\\gamma', 'gamma'),
  key('δ', '\\delta', 'delta'),
  key('ε', '\\epsilon', 'epsilon'),
  key('θ', '\\theta', 'theta'),
  key('λ', '\\lambda', 'lambda'),
  key('μ', '\\mu', 'mu'),
  key('ν', '\\nu', 'nu'),
  key('ξ', '\\xi', 'xi'),
  key('ρ', '\\rho', 'rho'),
  key('σ', '\\sigma', 'sigma'),
  key('τ', '\\tau', 'tau'),
  key('φ', '\\phi', 'phi'),
  key('χ', '\\chi', 'chi'),
  key('ψ', '\\psi', 'psi'),
  key('ω', '\\omega', 'omega'),
];

export const ABC_PAGE: KeypadPage = {
  id: 'abc',
  label: 'ABC',
  title: 'Letters',
  rows: [
    { kind: 'heading', title: 'Variables' },
    ...letterRows(),
    { kind: 'heading', title: 'Greek' },
    { kind: 'wrap', keys: GREEK },
  ],
};

/**
 * The function groups that mean the same thing in every subsystem.
 *
 * The names are the ones the canonical AST knows. A group is present because its
 * functions exist, never to fill a category out.
 */
export const COMMON_FUNCTION_ROWS: readonly KeypadRow[] = [
  { kind: 'heading', title: 'Trigonometry' },
  {
    kind: 'wrap',
    keys: [
      functionKey('sin', 'Sine'),
      functionKey('cos', 'Cosine'),
      functionKey('tan', 'Tangent'),
    ],
  },
  { kind: 'heading', title: 'Hyperbolic' },
  {
    kind: 'wrap',
    keys: [
      functionKey('sinh', 'Hyperbolic sine'),
      functionKey('cosh', 'Hyperbolic cosine'),
      functionKey('tanh', 'Hyperbolic tangent'),
    ],
  },
  { kind: 'heading', title: 'Exponential and logarithmic' },
  {
    kind: 'wrap',
    keys: [
      functionKey('exp', 'Exponential'),
      // `ln` and `log` are the same function here: both are the principal natural
      // logarithm. Both spellings are offered because both are written.
      functionKey('ln', 'Natural logarithm'),
      functionKey('log', 'Natural logarithm, spelled log'),
    ],
  },
  { kind: 'heading', title: 'Structure' },
  {
    kind: 'wrap',
    keys: [
      key('a⁄b', '\\frac{#@}{#?}', 'Fraction'),
      key('xⁿ', '^{#?}', 'Power'),
      key('√', '\\sqrt{#?}', 'Square root'),
      key('|x|', '\\left|#?\\right|', 'Absolute value'),
      key('( )', '\\left(#@\\right)', 'Parentheses around the selection'),
      key('(a,b)', '\\left(#?, #?\\right)', 'A list, for a vector field'),
    ],
  },
];

export const PLANNED_NOTE =
  'The keys below name mathematics the expression language does not read yet. They are shown so the roadmap is visible where you would reach for it, and they are inert rather than inserting something the parser would reject.';
