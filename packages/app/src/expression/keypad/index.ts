/**
 * The keypad, assembled per subsystem.
 *
 * One input system, three configurations. The digits and the letters are the same
 * everywhere; only the function page differs, and it is *composed* from the common
 * groups plus the subsystem's own rather than written out again. That is the whole
 * mechanism — there is no `ComplexKeypad` component, only a configuration.
 */
import type { SubsystemId } from '../../subsystems';
import { ABC_PAGE, COMMON_FUNCTION_ROWS, NUMERIC_PAGE, PLANNED_NOTE } from './common';
import { COMPLEX_FUNCTION_ROWS, COMPLEX_PLANNED_ROWS } from './complex';
import { TRANSFORMS_FUNCTION_ROWS, TRANSFORMS_PLANNED_ROWS } from './transforms';
import { CALCULUS_FUNCTION_ROWS, CALCULUS_PLANNED_ROWS } from './calculus';
import type { KeypadConfig, KeypadRow } from './types';

function functionPage(rows: readonly KeypadRow[]): KeypadConfig['pages'][number] {
  return {
    id: 'func',
    label: 'func',
    title: 'Functions',
    rows: [...rows, { kind: 'note', text: PLANNED_NOTE }],
  };
}

/**
 * The keypad for a subsystem.
 *
 * The order of the function groups follows the order someone explores in: the
 * subject's own operations first, then what every subsystem shares, then the
 * mathematics that is not available yet.
 */
export function keypadFor(subsystem: SubsystemId): KeypadConfig {
  const pages = [NUMERIC_PAGE, ABC_PAGE];

  if (subsystem === 'complex') {
    return {
      pages: [
        ...pages,
        functionPage([...COMPLEX_FUNCTION_ROWS, ...COMMON_FUNCTION_ROWS, ...COMPLEX_PLANNED_ROWS]),
      ],
    };
  }
  if (subsystem === 'transforms') {
    return {
      pages: [
        ...pages,
        functionPage([
          ...TRANSFORMS_FUNCTION_ROWS,
          ...COMMON_FUNCTION_ROWS,
          ...TRANSFORMS_PLANNED_ROWS,
        ]),
      ],
    };
  }
  return {
    pages: [
      ...pages,
      functionPage([...CALCULUS_FUNCTION_ROWS, ...COMMON_FUNCTION_ROWS, ...CALCULUS_PLANNED_ROWS]),
    ],
  };
}

export * from './types';
