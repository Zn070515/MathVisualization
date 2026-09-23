/**
 * Lexer.
 *
 * Turns source text into tokens. Deliberately small: it recognises numbers,
 * names, operators and punctuation, and nothing else. Aliases (`ln`, `π`) are
 * canonicalised here so that no later stage has to know they exist.
 *
 * Two details that matter mathematically:
 *
 * - `2e^(it)` is `2 * e^(i*t)`, not the number `2e`. A number literal only
 *   consumes an exponent when an `e` is actually followed by digits (optionally
 *   signed), so a bare `e` after digits is Euler's number.
 * - Names may contain any Unicode letter, so `θ`, `ω` and `φ` can be typed
 *   directly rather than only spelled out.
 */
import { type ParseError, type Result } from './errors';
import { canonicalName } from './builtins';
import { rationalFromLiteralText } from './rational';

export type TokenType =
  | 'number'
  | 'name'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'bracketOpen'
  | 'bracketClose'
  | 'comma'
  | 'semicolon'
  | 'equals'
  | 'integral';

export interface Token {
  readonly type: TokenType;
  /** Text as written, except that names are already canonicalised. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const IDENTIFIER_START = /[\p{L}_]/u;
const IDENTIFIER_PART = /[\p{L}\p{N}_]/u;
const DIGIT = /[0-9]/;
const OPERATORS = new Set(['+', '-', '*', '/', '^']);

/**
 * `∮`, which is the one piece of notation in this language that is a construct rather
 * than a value.
 *
 * It gets its own token kind and deliberately not a place in `OPERATORS`: that set
 * feeds the parser's infix table, where an entry with no binding rule silently becomes
 * `null` and then a confusing "unexpected token". A distinct kind means the parser can
 * only handle it where it is handled, and nowhere else by accident.
 */
const INTEGRAL_SIGN = '∮';

/**
 * Notation this project knows about and has not built.
 *
 * The lexer's contract is to accept what the language is, so these are errors — but
 * the message says which kind of error, rather than "unexpected character" for
 * something a reader will recognise instantly and expect to work.
 */
const NOT_YET_READ = new Map<string, string>([
  ['∫', 'a plain integral, as opposed to a closed one'],
  ['∬', 'a double integral'],
  ['∭', 'a triple integral'],
  ['∂', 'a partial derivative'],
  ['∇', 'the gradient operator'],
  ['∑', 'a sum'],
]);

function isWhitespace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r';
}

/**
 * Tokenize source text.
 *
 * Returns a `parse-error` result, rather than throwing, so that the expression
 * panel can show the failure inline while the user is still typing.
 */
export function tokenize(source: string): Result<readonly Token[], ParseError> {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index] as string;

    if (isWhitespace(character)) {
      index += 1;
      continue;
    }

    const start = index;

    if (DIGIT.test(character)) {
      const numberEnd = scanNumber(source, index);
      const raw = source.slice(start, numberEnd);
      // Validate the literal here so the parser never sees an out-of-range number.
      if (rationalFromLiteralText(raw) === null) {
        return {
          ok: false,
          issue: {
            kind: 'parse-error',
            message: `The number ${raw} is outside the range this evaluator represents.`,
            span: { start, end: numberEnd },
          },
        };
      }
      tokens.push({ type: 'number', text: raw, start, end: numberEnd });
      index = numberEnd;
      continue;
    }

    if (IDENTIFIER_START.test(character)) {
      let end = index + 1;
      while (end < source.length && IDENTIFIER_PART.test(source[end] as string)) end += 1;
      const raw = source.slice(start, end);
      tokens.push({ type: 'name', text: canonicalName(raw), start, end });
      index = end;
      continue;
    }

    if (OPERATORS.has(character)) {
      tokens.push({ type: 'operator', text: character, start, end: index + 1 });
      index += 1;
      continue;
    }

    if (character === '(') {
      tokens.push({ type: 'lparen', text: character, start, end: index + 1 });
      index += 1;
      continue;
    }

    if (character === ')') {
      tokens.push({ type: 'rparen', text: character, start, end: index + 1 });
      index += 1;
      continue;
    }

    if (character === '[') {
      tokens.push({ type: 'bracketOpen', text: character, start, end: index + 1 });
      index += 1;
      continue;
    }

    if (character === ']') {
      tokens.push({ type: 'bracketClose', text: character, start, end: index + 1 });
      index += 1;
      continue;
    }

    if (character === ',') {
      tokens.push({ type: 'comma', text: character, start, end: index + 1 });
      index += 1;
      continue;
    }

    if (character === ';') {
      tokens.push({ type: 'semicolon', text: character, start, end: index + 1 });
      index += 1;
      continue;
    }

    if (character === '=') {
      tokens.push({ type: 'equals', text: character, start, end: index + 1 });
      index += 1;
      continue;
    }

    if (character === INTEGRAL_SIGN) {
      tokens.push({ type: 'integral', text: character, start, end: index + 1 });
      index += 1;
      continue;
    }

    const notYetRead = NOT_YET_READ.get(character);
    if (notYetRead !== undefined) {
      return {
        ok: false,
        issue: {
          kind: 'parse-error',
          message: `"${character}" is recognised as ${notYetRead}, and this language does not read it yet.`,
          span: { start, end: index + 1 },
        },
      };
    }

    return {
      ok: false,
      issue: {
        kind: 'parse-error',
        message: `Unexpected character "${character}".`,
        span: { start, end: index + 1 },
      },
    };
  }

  return { ok: true, value: tokens };
}

/**
 * End index of a numeric literal starting at `start`.
 *
 * Grammar: digits [ '.' digits ] [ ('e'|'E') ['+'|'-'] digits ].
 * The exponent is only consumed when a digit actually follows, which is what
 * keeps `2e^(it)` meaning `2 * e^(i*t)`.
 */
function scanNumber(source: string, start: number): number {
  let index = start;
  while (index < source.length && DIGIT.test(source[index] as string)) index += 1;

  if (source[index] === '.') {
    const afterDot = index + 1;
    if (afterDot < source.length && DIGIT.test(source[afterDot] as string)) {
      index = afterDot;
      while (index < source.length && DIGIT.test(source[index] as string)) index += 1;
    }
  }

  const exponentMarker = source[index];
  if (exponentMarker === 'e' || exponentMarker === 'E') {
    let cursor = index + 1;
    const sign = source[cursor];
    if (sign === '+' || sign === '-') cursor += 1;
    if (cursor < source.length && DIGIT.test(source[cursor] as string)) {
      index = cursor;
      while (index < source.length && DIGIT.test(source[index] as string)) index += 1;
    }
  }

  return index;
}
