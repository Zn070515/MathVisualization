/**
 * LaTeX as a front end to the canonical AST.
 *
 * The structured math editor (MathLive) reads and writes LaTeX. This module makes
 * LaTeX a *surface syntax* for the same canonical tree the plain-text parser
 * produces, rather than a second representation that could drift from it. The
 * architecture is unchanged — one AST, many front ends and back ends:
 *
 * ```text
 *   "sin(z)/(z^2+1)"  ──plain lexer/parser──┐
 *                                            ├──►  canonical AST  ──► evaluator, GLSL, SymPy
 *   "\frac{\sin(z)}{z^2+1}"  ──this module──┘
 * ```
 *
 * Because both surface syntaxes produce the same tree, the two can never disagree
 * about the mathematics. The store persists the LaTeX (that is what the editor
 * round-trips) and the AST is always derived from it.
 *
 * ## Recovering precedence from LaTeX
 *
 * LaTeX has no operator precedence: `a+b\cdot c` is three atoms in a row, and it
 * only *reads* as `a + b·c` by convention. A tree needs a real answer, so this
 * parser recovers the conventional reading — additive, then multiplicative, then
 * powers, with juxtaposition multiplying. That is what makes
 * `\frac{\sin(z)}{z^2+1}` come out as `sin(z) / (z² + 1)` rather than as a
 * denominator that swallows the addition.
 *
 * ## Subscripts
 *
 * A subscript belongs to the *name*: `a_1` is a different symbol from `a`, not an
 * operation applied to one. So `a_1` becomes a variable called `a_1`, and a
 * subscripted name survives the round trip.
 *
 * ## Where the two syntaxes deliberately agree
 *
 * A bare `i` is the imaginary unit in both. A name that the document defines as a
 * function, followed by a group, is a call in both; any other name followed by a
 * group is multiplication in both. Keeping these rules identical is what stops the
 * editor from changing the meaning of an expression that was already written.
 */
import {
  type Expr,
  type FunctionDefinition,
  type PathInterval,
  type Statement,
  type BinaryOperator,
  type UnaryOperator,
} from './ast';
import { builtinFunction, canonicalName } from './builtins';
import { BUILTIN_CONSTANT_NAMES } from './conventions';
import { parseStatement } from './parser';
import { type ParseError, type Result, type SourceSpan } from './errors';
import { rationalFromLiteralText } from './rational';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Greek commands, and the name each stands for. */
const GREEK_COMMANDS: Readonly<Record<string, string>> = {
  alpha: 'alpha',
  beta: 'beta',
  gamma: 'gamma',
  delta: 'delta',
  epsilon: 'epsilon',
  varepsilon: 'varepsilon',
  zeta: 'zeta',
  eta: 'eta',
  theta: 'theta',
  vartheta: 'vartheta',
  iota: 'iota',
  kappa: 'kappa',
  lambda: 'lambda',
  mu: 'mu',
  nu: 'nu',
  xi: 'xi',
  pi: 'pi',
  rho: 'rho',
  sigma: 'sigma',
  varsigma: 'varsigma',
  tau: 'tau',
  upsilon: 'upsilon',
  phi: 'phi',
  varphi: 'varphi',
  chi: 'chi',
  psi: 'psi',
  omega: 'omega',
  Gamma: 'Gamma',
  Delta: 'Delta',
  Theta: 'Theta',
  Lambda: 'Lambda',
  Xi: 'Xi',
  Pi: 'Pi',
  Sigma: 'Sigma',
  Upsilon: 'Upsilon',
  Phi: 'Phi',
  Psi: 'Psi',
  Omega: 'Omega',
};

/** The inverse, for printing: a name that must be written as a command. */
const GREEK_BY_NAME: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(GREEK_COMMANDS).map(([command, name]) => [name, command]),
);

/** Commands that name a function the AST already knows. */
const FUNCTION_COMMANDS: Readonly<Record<string, string>> = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  exp: 'exp',
  log: 'log',
  ln: 'log',
  sqrt: 'sqrt',
};

/**
 * `\operatorname{...}` names, and `\Re`/`\Im`, mapped onto builtin names.
 *
 * The real and imaginary parts are written as operators because that is how
 * mathematics writes them, and the AST knows them as `re` and `im`.
 */
const OPERATOR_NAMES: Readonly<Record<string, string>> = {
  Re: 're',
  Im: 'im',
  arg: 'arg',
  Arg: 'arg',
  conj: 'conj',
  sgn: 'sgn',
  Fourier: 'Fourier',
  DFT: 'DFT',
  Convolution: 'Convolution',
};

/** Sizing and spacing commands carry no mathematical content. */
const IGNORED_COMMANDS = new Set([
  'left',
  'right',
  'displaystyle',
  'textstyle',
  'limits',
  'nolimits',
  '!',
  ',',
  ';',
  ':',
  'quad',
  'qquad',
  'enspace',
  'thinspace',
  'medspace',
  'thickspace',
]);

/** Function name to LaTeX, for printing. */
const LATEX_BY_FUNCTION: Readonly<Record<string, string>> = {
  sin: '\\sin',
  cos: '\\cos',
  tan: '\\tan',
  sinh: '\\sinh',
  cosh: '\\cosh',
  tanh: '\\tanh',
  exp: '\\exp',
  log: '\\log',
};

/** Function name to `\operatorname{...}`, for the ones without their own command. */
const OPERATOR_BY_FUNCTION: Readonly<Record<string, string>> = {
  re: 'Re',
  im: 'Im',
  arg: 'arg',
  Fourier: 'Fourier',
  DFT: 'DFT',
  Convolution: 'Convolution',
};

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type LatexTokenKind =
  | 'command'
  | 'number'
  | 'letter'
  | 'braceOpen'
  | 'braceClose'
  | 'parenOpen'
  | 'parenClose'
  | 'bar'
  | 'bracketOpen'
  | 'bracketClose'
  | 'caret'
  | 'underscore'
  | 'plus'
  | 'minus'
  | 'equals'
  | 'comma'
  | 'semicolon'
  | 'slash'
  | 'asterisk';

interface LatexToken {
  readonly kind: LatexTokenKind;
  /** Command name without the backslash, or the literal text for a letter/number. */
  readonly text: string;
  readonly span: SourceSpan;
}

const PUNCTUATION: Readonly<Record<string, LatexTokenKind>> = {
  '{': 'braceOpen',
  '}': 'braceClose',
  '(': 'parenOpen',
  ')': 'parenClose',
  '|': 'bar',
  '[': 'bracketOpen',
  ']': 'bracketClose',
  '^': 'caret',
  _: 'underscore',
  '+': 'plus',
  '-': 'minus',
  '=': 'equals',
  ',': 'comma',
  ';': 'semicolon',
  '/': 'slash',
  // Not LaTeX, but accepted so that ASCII mathematics pasted into the editor
  // reads as the multiplication it plainly is rather than being rejected.
  '*': 'asterisk',
};

const DIGIT = /[0-9]/;
const LETTER = /[A-Za-z]/;
const COMMAND_NAME = /[A-Za-z]/;

function incomplete(at: SourceSpan, message: string): ParseError {
  return { kind: 'parse-error', message, span: at, incomplete: true };
}

function wrong(at: SourceSpan, message: string): ParseError {
  return { kind: 'parse-error', message, span: at };
}

/** Tokenize a LaTeX fragment. Ignored commands never reach the parser. */
function tokenizeLatex(latex: string): Result<readonly LatexToken[], ParseError> {
  const tokens: LatexToken[] = [];
  let index = 0;

  while (index < latex.length) {
    const start = index;
    const character = latex[index] as string;

    if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
      index += 1;
      continue;
    }

    if (character === '\\') {
      index += 1;
      if (index >= latex.length) {
        // A trailing backslash is someone mid-typing a command.
        return {
          ok: false,
          issue: incomplete({ start, end: index }, 'That command is unfinished.'),
        };
      }
      let name = '';
      if (COMMAND_NAME.test(latex[index] as string)) {
        while (index < latex.length && COMMAND_NAME.test(latex[index] as string)) {
          name += latex[index];
          index += 1;
        }
      } else {
        name = latex[index] as string;
        index += 1;
      }

      if (IGNORED_COMMANDS.has(name)) continue;
      tokens.push({ kind: 'command', text: name, span: { start, end: index } });
      continue;
    }

    if (DIGIT.test(character)) {
      let text = '';
      while (index < latex.length && DIGIT.test(latex[index] as string)) {
        text += latex[index];
        index += 1;
      }
      // A decimal point only belongs to the number when a digit follows.
      if (
        latex[index] === '.' &&
        index + 1 < latex.length &&
        DIGIT.test(latex[index + 1] as string)
      ) {
        text += '.';
        index += 1;
        while (index < latex.length && DIGIT.test(latex[index] as string)) {
          text += latex[index];
          index += 1;
        }
      }
      tokens.push({ kind: 'number', text, span: { start, end: index } });
      continue;
    }

    if (LETTER.test(character)) {
      // One token per letter, because in LaTeX `xy` means x·y.
      tokens.push({ kind: 'letter', text: character, span: { start, end: index + 1 } });
      index += 1;
      continue;
    }

    const punctuation = PUNCTUATION[character];
    if (punctuation !== undefined) {
      tokens.push({ kind: punctuation, text: character, span: { start, end: index + 1 } });
      index += 1;
      continue;
    }

    return {
      ok: false,
      issue: wrong({ start, end: index + 1 }, `"${character}" is not something this parser reads.`),
    };
  }

  return { ok: true, value: tokens };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const PRECEDENCE_ADDITIVE = 10;
const PRECEDENCE_MULTIPLICATIVE = 20;
const PRECEDENCE_UNARY = 30;

interface ParseContext {
  /** Names the document defines as functions, so `f(z)` is a call. */
  readonly knownFunctions: ReadonlySet<string>;
}

class LatexParser {
  private index = 0;
  /** How many bar-delimited groups are open, so `|` can close as well as open. */
  private barNesting = 0;

  constructor(
    private readonly tokens: readonly LatexToken[],
    private readonly end: number,
    private readonly context: ParseContext,
  ) {}

  private peek(offset = 0): LatexToken | undefined {
    const at = this.index + offset;
    return at < this.end ? this.tokens[at] : undefined;
  }

  private advance(): LatexToken {
    const token = this.tokens[this.index];
    if (token === undefined) throw new Error('latex parser advanced past the end');
    this.index += 1;
    return token;
  }

  private lastSpan(): SourceSpan {
    const previous = this.tokens[Math.max(0, Math.min(this.index, this.end) - 1)];
    return previous?.span ?? { start: 0, end: 0 };
  }

  // ------------------------------------------------------------------ public

  /** Parse a whole statement, including the `=` form when one is present. */
  parseStatement(): Result<Statement, ParseError> {
    const equalsAt = this.findTopLevelEquals();

    if (equalsAt === -1) {
      const body = this.parseExpression(0);
      if (!body.ok) return body;
      const trailing = this.trailingError();
      if (trailing !== null) return { ok: false, issue: trailing };
      return { ok: true, value: { kind: 'expression', body: body.value, span: body.value.span } };
    }

    const left = this.parseHead(equalsAt);
    if (!left.ok) return left;

    // Move past the equals sign and parse the right-hand side.
    this.index = equalsAt + 1;
    const right = this.parseExpression(0);
    if (!right.ok) return right;
    const trailing = this.trailingError();
    if (trailing !== null) return { ok: false, issue: trailing };

    const name = left.value.name;
    const parameters = left.value.parameters;
    const span: SourceSpan = { start: left.value.span.start, end: right.value.span.end };

    if (parameters === null) {
      return {
        ok: true,
        value: { kind: 'parameter', name, body: right.value, span } satisfies Statement,
      };
    }
    return {
      ok: true,
      value: {
        kind: 'function-definition',
        name,
        parameters,
        ...(left.value.interval === undefined ? {} : { interval: left.value.interval }),
        body: right.value,
        span,
      } satisfies FunctionDefinition,
    };
  }

  /**
   * The header of a definition, or null when the line is not one.
   *
   * A token-shape test on `name(params)=`, used to collect function names before
   * any line is parsed. That is what lets `f` be used before it is defined.
   */
  definitionHeader(): { name: string; parameters: string[]; interval?: PathInterval } | null {
    const saved = this.index;
    const name = this.readName();
    if (!name.ok) {
      this.index = saved;
      return null;
    }
    if (this.peek()?.kind !== 'parenOpen') {
      this.index = saved;
      return null;
    }
    this.advance();

    const parameters: string[] = [];
    for (;;) {
      const parameter = this.readName();
      if (!parameter.ok) {
        this.index = saved;
        return null;
      }
      parameters.push(parameter.value.name);
      const separator = this.peek();
      if (separator?.kind === 'semicolon') {
        if (parameters.length !== 1) {
          this.index = saved;
          return null;
        }
        const interval = this.parseIntervalHeader(parameters[0] as string);
        if (interval === null || this.peek()?.kind !== 'parenClose') {
          this.index = saved;
          return null;
        }
        this.advance();
        if (this.peek()?.kind !== 'equals') {
          this.index = saved;
          return null;
        }
        return { name: name.value.name, parameters, interval };
      }
      if (separator?.kind === 'comma') {
        this.advance();
        continue;
      }
      if (separator?.kind === 'parenClose') {
        this.advance();
        break;
      }
      this.index = saved;
      return null;
    }

    if (this.peek()?.kind !== 'equals') {
      this.index = saved;
      return null;
    }
    return { name: name.value.name, parameters };
  }

  /** The name a parameter assignment binds, or null when the line is not one. */
  parameterName(): string | null {
    const saved = this.index;
    const name = this.readName();
    if (!name.ok || this.peek()?.kind !== 'equals') {
      this.index = saved;
      return null;
    }
    return name.value.name;
  }

  /** Parse a bare expression. */
  parseExpressionOnly(): Result<Expr, ParseError> {
    const parsed = this.parseExpression(0);
    if (!parsed.ok) return parsed;
    const trailing = this.trailingError();
    if (trailing !== null) return { ok: false, issue: trailing };
    return { ok: true, value: parsed.value };
  }

  /**
   * Anything left over after a complete expression.
   *
   * Without this check `z\int` would parse as `z`, silently discarding the rest —
   * which is exactly the kind of quiet wrong answer the project does not allow.
   */
  private trailingError(): ParseError | null {
    const token = this.peek();
    if (token === undefined) return null;
    return wrong(token.span, `Unexpected "${token.text}" after the end of the expression.`);
  }

  // ------------------------------------------------------------- statements

  /**
   * Depth-zero `=`, which separates the head from the body.
   *
   * Bars are not counted as nesting: `|` opens and closes, so it cannot be used to
   * track depth, and an expression such as `|z|=2` should still find its equals at
   * depth zero.
   */
  private findTopLevelEquals(): number {
    let depth = 0;
    for (let at = this.index; at < this.end; at += 1) {
      const token = this.tokens[at] as LatexToken;
      if (token.kind === 'braceOpen' || token.kind === 'parenOpen') depth += 1;
      else if (token.kind === 'braceClose' || token.kind === 'parenClose') depth -= 1;
      else if (token.kind === 'equals' && depth === 0) return at;
    }
    return -1;
  }

  /** The left of `=`: a name, or a name with a parameter list. */
  private parseHead(
    limit: number,
  ): Result<
    { name: string; parameters: string[] | null; interval?: PathInterval; span: SourceSpan },
    ParseError
  > {
    // Read only up to the equals sign. A separate parser over the same tokens,
    // bounded by `limit`, keeps the head grammar independent of the body.
    const parser = new LatexParser(this.tokens, limit, this.context);
    const name = parser.readName();
    if (!name.ok) return name;

    if (parser.index >= limit || parser.peek()?.kind !== 'parenOpen') {
      if (parser.index < limit) {
        return {
          ok: false,
          issue: wrong(
            parser.peek()?.span ?? name.value.span,
            'The left of "=" must be a name or a function header, as in `a=2` or `f(z)=`.',
          ),
        };
      }
      return {
        ok: true,
        value: { name: name.value.name, parameters: null, span: name.value.span },
      };
    }

    parser.advance(); // (
    const parameters: string[] = [];
    let interval: PathInterval | undefined;
    if (parser.peek()?.kind === 'parenClose') {
      return {
        ok: false,
        issue: wrong(
          parser.peek()?.span ?? name.value.span,
          'A definition needs at least one parameter.',
        ),
      };
    }
    for (;;) {
      const parameter = parser.readName();
      if (!parameter.ok) return parameter;
      parameters.push(parameter.value.name);

      const separator = parser.peek();
      if (separator?.kind === 'semicolon') {
        if (parameters.length !== 1) {
          return {
            ok: false,
            issue: wrong(separator.span, 'A path interval needs exactly one path parameter.'),
          };
        }
        const parsedInterval = parser.parseIntervalHeader(parameters[0] as string);
        if (parsedInterval === null) {
          return {
            ok: false,
            issue: wrong(separator.span, 'A path interval must be written as `[from, to]`.'),
          };
        }
        interval = parsedInterval;
        if (parser.peek()?.kind !== 'parenClose') {
          return {
            ok: false,
            issue: incomplete(
              parser.peek()?.span ?? separator.span,
              'Expected a closing parenthesis after the path interval.',
            ),
          };
        }
        parser.advance();
        break;
      }
      if (separator?.kind === 'comma') {
        parser.advance();
        continue;
      }
      if (separator?.kind === 'parenClose') {
        parser.advance();
        break;
      }
      return {
        ok: false,
        issue: incomplete(
          separator?.span ?? parameter.value.span,
          'Expected a comma or a closing parenthesis in the parameter list.',
        ),
      };
    }

    if (parser.index < limit) {
      return {
        ok: false,
        issue: wrong(parser.peek()?.span ?? name.value.span, 'Unexpected text before "=".'),
      };
    }

    return {
      ok: true,
      value: {
        name: name.value.name,
        parameters,
        ...(interval === undefined ? {} : { interval }),
        span: { start: name.value.span.start, end: parser.lastSpan().end },
      },
    };
  }

  /** Parse `[from, to]` after the semicolon in a one-parameter path header. */
  private parseIntervalHeader(parameter: string): PathInterval | null {
    const semicolon = this.advance();
    const open = this.peek();
    if (open?.kind !== 'bracketOpen') return null;
    this.advance();

    const fromStart = this.index;
    let depth = 0;
    let comma = -1;
    for (; this.index < this.end; this.index += 1) {
      const token = this.tokens[this.index] as LatexToken;
      if (token.kind === 'braceOpen' || token.kind === 'parenOpen') depth += 1;
      else if (token.kind === 'braceClose' || token.kind === 'parenClose') depth -= 1;
      else if (token.kind === 'comma' && depth === 0) {
        comma = this.index;
        break;
      }
    }
    if (comma === -1) return null;

    const from = new LatexParser(
      this.tokens.slice(fromStart, comma),
      comma - fromStart,
      this.context,
    ).parseExpressionOnly();
    if (!from.ok) return null;

    this.index = comma + 1;
    const toStart = this.index;
    depth = 0;
    let close = -1;
    for (; this.index < this.end; this.index += 1) {
      const token = this.tokens[this.index] as LatexToken;
      if (token.kind === 'braceOpen' || token.kind === 'parenOpen') depth += 1;
      else if (token.kind === 'braceClose' || token.kind === 'parenClose') depth -= 1;
      else if (token.kind === 'bracketClose' && depth === 0) {
        close = this.index;
        break;
      }
    }
    if (close === -1) return null;

    const to = new LatexParser(
      this.tokens.slice(toStart, close),
      close - toStart,
      this.context,
    ).parseExpressionOnly();
    if (!to.ok) return null;
    const closeToken = this.tokens[close] as LatexToken;
    this.index = close + 1;
    return {
      parameter,
      from: from.value,
      to: to.value,
      span: { start: semicolon.span.start, end: closeToken.span.end },
    };
  }

  /** A name, optionally written as a Greek command, optionally subscripted. */
  private readName(): Result<{ name: string; span: SourceSpan }, ParseError> {
    const token = this.peek();
    if (token === undefined) {
      return { ok: false, issue: incomplete(this.lastSpan(), 'A name was expected here.') };
    }

    let base: string;
    if (token.kind === 'letter') {
      this.advance();
      base = canonicalName(token.text);
    } else if (token.kind === 'command') {
      this.advance();
      const greek = GREEK_COMMANDS[token.text];
      if (greek !== undefined) base = canonicalName(greek);
      else if (token.text === 'operatorname') {
        const named = this.readOperatorName();
        if (!named.ok) return named;
        base = named.value;
      } else {
        return {
          ok: false,
          issue: wrong(token.span, `"\\${token.text}" cannot be used as a name here.`),
        };
      }
    } else {
      return { ok: false, issue: wrong(token.span, 'A name was expected here.') };
    }

    const subscript = this.readSubscript();
    if (!subscript.ok) return subscript;
    const name = subscript.value === null ? base : `${base}_${subscript.value}`;
    return {
      ok: true,
      value: { name, span: { start: token.span.start, end: this.lastSpan().end } },
    };
  }

  /** The `{...}` inside `\operatorname{...}`. */
  private readOperatorName(): Result<string, ParseError> {
    const open = this.peek();
    if (open?.kind !== 'braceOpen') {
      return {
        ok: false,
        issue: incomplete(open?.span ?? this.lastSpan(), '\\operatorname needs a name.'),
      };
    }
    this.advance();

    let text = '';
    for (;;) {
      const token = this.peek();
      if (token === undefined) {
        return {
          ok: false,
          issue: incomplete(open.span, '\\operatorname is missing its closing brace.'),
        };
      }
      if (token.kind === 'braceClose') {
        this.advance();
        break;
      }
      if (token.kind === 'letter') {
        text += token.text;
        this.advance();
        continue;
      }
      // MathLive commonly serializes an operator name inserted through the
      // keypad as `\\operatorname{\\mathrm{Fourier}}`. Treat the styling
      // command as presentation markup while keeping the operator-name
      // grammar strict.
      if (token.kind === 'command' && token.text === 'mathrm') {
        this.advance();
        const styledOpen = this.peek();
        if (styledOpen?.kind !== 'braceOpen') {
          return {
            ok: false,
            issue: incomplete(styledOpen?.span ?? token.span, '\\mathrm needs a name.'),
          };
        }
        this.advance();
        let styledText = '';
        for (;;) {
          const styledToken = this.peek();
          if (styledToken === undefined) {
            return {
              ok: false,
              issue: incomplete(styledOpen.span, '\\mathrm is missing its closing brace.'),
            };
          }
          if (styledToken.kind === 'braceClose') {
            this.advance();
            break;
          }
          if (styledToken.kind !== 'letter') {
            return {
              ok: false,
              issue: wrong(styledToken.span, 'An operator name must be letters.'),
            };
          }
          styledText += styledToken.text;
          this.advance();
        }
        if (styledText === '') {
          return { ok: false, issue: incomplete(styledOpen.span, '\\mathrm needs a name.') };
        }
        text += styledText;
        continue;
      }
      return { ok: false, issue: wrong(token.span, 'An operator name must be letters.') };
    }

    if (text === '') {
      return { ok: false, issue: incomplete(open.span, '\\operatorname needs a name.') };
    }
    return { ok: true, value: text };
  }

  /**
   * A trailing `_`, absorbed into the name.
   *
   * Returns `null` when there is no subscript. A subscript that is not a simple
   * run of digits and letters keeps its LaTeX form as the name, so `z_{k+1}` is a
   * symbol called `z_{k+1}` rather than an error.
   */
  private readSubscript(): Result<string | null, ParseError> {
    if (this.peek()?.kind !== 'underscore') return { ok: true, value: null };
    const marker = this.advance();

    const next = this.peek();
    if (next === undefined) {
      return { ok: false, issue: incomplete(marker.span, 'That subscript is unfinished.') };
    }

    if (next.kind === 'braceOpen') {
      this.advance();
      let text = '';
      for (;;) {
        const token = this.peek();
        if (token === undefined) {
          return {
            ok: false,
            issue: incomplete(marker.span, 'That subscript is missing its closing brace.'),
          };
        }
        if (token.kind === 'braceClose') {
          this.advance();
          break;
        }
        const piece = this.tokenText(token);
        if (piece === null) {
          return {
            ok: false,
            issue: wrong(token.span, 'That kind of subscript is not supported yet.'),
          };
        }
        text += piece;
        this.advance();
      }
      if (text === '') {
        return { ok: false, issue: incomplete(marker.span, 'That subscript is empty.') };
      }
      return { ok: true, value: wrapSubscript(text) };
    }

    const piece = this.tokenText(next);
    if (piece === null) {
      return { ok: false, issue: wrong(next.span, 'That kind of subscript is not supported yet.') };
    }
    this.advance();
    return { ok: true, value: wrapSubscript(piece) };
  }

  /** The text a token contributes to a name, or null when it cannot. */
  private tokenText(token: LatexToken): string | null {
    switch (token.kind) {
      case 'letter':
        return token.text;
      case 'number':
        return token.text;
      case 'plus':
        return '+';
      case 'minus':
        return '-';
      case 'slash':
        return '/';
      case 'underscore':
        // A subscript inside a subscript: `\gamma_1` is a name, and printing that name
        // gives `\gamma_1` back, so refusing the inner `_` would make the printer
        // produce LaTeX this parser cannot read.
        return '_';
      case 'command': {
        const greek = GREEK_COMMANDS[token.text];
        return greek === undefined ? null : greek;
      }
      default:
        return null;
    }
  }

  // ------------------------------------------------------------ expressions

  /** Precedence climbing over atoms. */
  private parseExpression(minPrecedence: number): Result<Expr, ParseError> {
    const first = this.parseAtom();
    if (!first.ok) return first;
    let left = first.value;

    for (;;) {
      const token = this.peek();
      if (token === undefined) break;

      const binding = this.bindingFor(token);
      if (binding === null) break;
      if (binding.precedence < minPrecedence) break;

      // An explicit operator is consumed; a juxtaposition is not, because the
      // token that triggers it starts the right-hand operand.
      if (binding.consumesToken) this.advance();

      const right = this.parseExpression(binding.precedence + 1);
      if (!right.ok) {
        // `a + ` at the end of the input is unfinished, not wrong.
        if (right.issue.incomplete === true) {
          return {
            ok: false,
            issue: incomplete(
              { start: token.span.start, end: this.lastSpan().end },
              'Waiting for the right-hand side.',
            ),
          };
        }
        return right;
      }

      left = {
        kind: 'binary',
        op: binding.op,
        left,
        right: right.value,
        span: { start: left.span.start, end: right.value.span.end },
      };
    }

    return { ok: true, value: left };
  }

  private bindingFor(
    token: LatexToken,
  ): { op: BinaryOperator; precedence: number; consumesToken: boolean } | null {
    if (token.kind === 'plus') {
      return { op: 'add', precedence: PRECEDENCE_ADDITIVE, consumesToken: true };
    }
    if (token.kind === 'minus') {
      return { op: 'sub', precedence: PRECEDENCE_ADDITIVE, consumesToken: true };
    }
    if (token.kind === 'slash') {
      return { op: 'div', precedence: PRECEDENCE_MULTIPLICATIVE, consumesToken: true };
    }
    if (token.kind === 'asterisk') {
      return { op: 'mul', precedence: PRECEDENCE_MULTIPLICATIVE, consumesToken: true };
    }
    if (token.kind === 'command') {
      if (token.text === 'cdot' || token.text === 'times' || token.text === 'ast') {
        return { op: 'mul', precedence: PRECEDENCE_MULTIPLICATIVE, consumesToken: true };
      }
    }
    // Juxtaposition multiplies: `2x`, `2\pi`, `(a)(b)`, `\frac{}{}y`. This has to
    // be checked for commands too, or a fraction followed by `\pi` would not
    // multiply.
    return this.startsAtom(token)
      ? { op: 'mul', precedence: PRECEDENCE_MULTIPLICATIVE, consumesToken: false }
      : null;
  }

  private startsAtom(token: LatexToken): boolean {
    switch (token.kind) {
      case 'number':
      case 'letter':
      case 'braceOpen':
      case 'parenOpen':
        return true;
      case 'bar':
        // A bar while a bar-delimited group is open is the closing one, not the
        // start of an operand.
        return this.barNesting === 0;
      case 'command':
        // Only commands that produce a value can start an operand.
        return (
          GREEK_COMMANDS[token.text] !== undefined ||
          FUNCTION_COMMANDS[token.text] !== undefined ||
          OPERATOR_NAMES[token.text] !== undefined ||
          // Without this, `2\oint_...` does not multiply and the expression silently
          // ends at the `2`, which reports as a trailing-token error pointing at the
          // wrong thing.
          token.text === 'oint' ||
          token.text === 'frac' ||
          token.text === 'sqrt' ||
          token.text === 'operatorname' ||
          token.text === 'overline' ||
          token.text === 'Re' ||
          token.text === 'Im'
        );
      default:
        return false;
    }
  }

  private parseAtom(): Result<Expr, ParseError> {
    // A leading sign binds more loosely than a power, so `-z^2` is `-(z^2)`.
    const token = this.peek();
    if (token?.kind === 'minus') {
      this.advance();
      const operand = this.parseExpression(PRECEDENCE_UNARY);
      if (!operand.ok) return operand;
      return {
        ok: true,
        value: {
          kind: 'unary',
          op: 'neg' as UnaryOperator,
          operand: operand.value,
          span: { start: token.span.start, end: operand.value.span.end },
        },
      };
    }
    if (token?.kind === 'plus') {
      this.advance();
      return this.parseExpression(PRECEDENCE_UNARY);
    }

    const base = this.parseBase();
    if (!base.ok) return base;
    return this.applyPowers(base.value);
  }

  /** A postfix `^`, which binds tighter than everything else. */
  private applyPowers(base: Expr): Result<Expr, ParseError> {
    let result = base;
    while (this.peek()?.kind === 'caret') {
      const marker = this.advance();
      const exponent = this.parseAtom();
      if (!exponent.ok) {
        return {
          ok: false,
          issue: incomplete(marker.span, 'Waiting for the exponent.'),
        };
      }
      result = {
        kind: 'binary',
        op: 'pow',
        left: result,
        right: exponent.value,
        span: { start: result.span.start, end: exponent.value.span.end },
      };
    }
    return { ok: true, value: result };
  }

  private parseBase(): Result<Expr, ParseError> {
    const token = this.peek();
    if (token === undefined) {
      return {
        ok: false,
        issue: incomplete(
          { start: this.lastSpan().end, end: this.lastSpan().end },
          'An expression was expected here.',
        ),
      };
    }

    switch (token.kind) {
      case 'number': {
        this.advance();
        const value = rationalFromLiteralText(token.text);
        if (value === null) {
          return {
            ok: false,
            issue: wrong(token.span, `The number ${token.text} is out of range.`),
          };
        }
        return { ok: true, value: { kind: 'number', value, raw: token.text, span: token.span } };
      }

      case 'letter':
        return this.parseNameAtom();

      case 'command':
        return this.parseCommandAtom();

      case 'braceOpen': {
        this.advance();
        const inner = this.parseExpression(0);
        if (!inner.ok) return inner;
        const close = this.peek();
        if (close?.kind !== 'braceClose') {
          return {
            ok: false,
            issue: incomplete(token.span, 'That group is missing its closing brace.'),
          };
        }
        this.advance();
        return {
          ok: true,
          value: { ...inner.value, span: { start: token.span.start, end: close.span.end } },
        };
      }

      case 'parenOpen':
        return this.parseParenthesised();

      case 'bar': {
        this.advance();
        this.barNesting += 1;
        const inner = this.parseExpression(0);
        this.barNesting -= 1;
        if (!inner.ok) return inner;
        const close = this.peek();
        if (close?.kind !== 'bar') {
          return {
            ok: false,
            issue: incomplete(token.span, 'That absolute value is missing its closing bar.'),
          };
        }
        this.advance();
        return {
          ok: true,
          value: {
            kind: 'call',
            callee: 'abs',
            args: [inner.value],
            span: { start: token.span.start, end: close.span.end },
          },
        };
      }

      case 'braceClose':
      case 'parenClose':
      case 'bracketClose':
        // Running into a closing delimiter means the content before it ended
        // early, which is an unfinished expression rather than a wrong one.
        return {
          ok: false,
          issue: incomplete(token.span, 'That structure is empty or unfinished.'),
        };

      default:
        return { ok: false, issue: wrong(token.span, `Unexpected "${token.text}".`) };
    }
  }

  /** A bare letter, which may be a constant or a variable, and may be subscripted. */
  private parseNameAtom(): Result<Expr, ParseError> {
    const named = this.readName();
    if (!named.ok) return named;

    const name = named.value.name;
    const asConstant = BUILTIN_CONSTANT_NAMES.has(name);
    const knownFunction =
      builtinFunction(name) !== undefined || this.context.knownFunctions.has(name);

    if (knownFunction && this.peek()?.kind === 'parenOpen') {
      return this.parseCall(name, named.value.span);
    }
    if (knownFunction) {
      return {
        ok: false,
        issue: wrong(named.value.span, `"${name}" is a function. Write ${name}(...).`),
      };
    }

    return {
      ok: true,
      value: asConstant
        ? { kind: 'constant', name, span: named.value.span }
        : { kind: 'variable', name, span: named.value.span },
    };
  }

  /**
   * `\oint_{\gamma} f(z)\,dz`.
   *
   * The differential is found before the integrand is parsed, by a scan at brace
   * depth zero over the tokens to come, and the integrand is then read by a second
   * parser bounded at that point — the same mechanism `parseHead` uses for a
   * definition. Order matters for the same reason it does on the plain-text side:
   * parsed as an ordinary expression, `f(z)dz` would juxtapose-multiply into
   * `f(z)·d·z` and the differential would be gone from the tree.
   */
  private parseContourIntegral(sign: LatexToken): Result<Expr, ParseError> {
    this.advance();

    const subscript = this.readSubscript();
    if (!subscript.ok) return subscript;
    if (subscript.value === null) {
      return {
        ok: false,
        issue: wrong(
          sign.span,
          'A contour integral names its path, as in \\oint_{\\gamma} f(z)\\,dz.',
        ),
      };
    }
    const path = unwrapSubscript(subscript.value);

    const differential = this.findDifferential();
    if (!differential.ok) return differential;
    if (differential.value === null) {
      return {
        ok: false,
        issue: wrong(
          this.peek()?.span ?? sign.span,
          'A contour integral needs a differential saying what is integrated, as in \\oint_{\\gamma} f(z)\\,dz.',
        ),
      };
    }

    // A parser over the integrand's *own* tokens, and not over this one's bounded at
    // that point: `end` limits where a parser stops, not where it starts, so a bounded
    // parser would begin again at the `\oint` and read the whole integral as its own
    // integrand. Slicing keeps the token spans absolute, so error positions are still
    // positions in the source the user wrote.
    const integrandTokens = this.tokens.slice(this.index, differential.value.index);
    const inner = new LatexParser(integrandTokens, integrandTokens.length, this.context);
    const integrand = inner.parseExpressionOnly();
    if (!integrand.ok) {
      return {
        ok: false,
        issue: wrong(
          sign.span,
          `The integrand of a contour integral is an expression in ${differential.value.variable}: ${integrand.issue.message}`,
        ),
      };
    }

    // `d` and its variable: two tokens, whichever way the space fell.
    this.index = differential.value.index + 2;
    const last = this.tokens[this.index - 1];
    return {
      ok: true,
      value: {
        kind: 'contour-integral',
        path,
        pathSpan: sign.span,
        variable: differential.value.variable,
        integrand: integrand.value,
        span: { start: sign.span.start, end: last?.span.end ?? sign.span.end },
      },
    };
  }

  /**
   * The `d` that ends the integrand, found by shape and brace depth.
   *
   * LaTeX writes the differential as two letters, `d` and the variable, so this is a
   * two-token shape. A `\cdot` before it is caught and named: `f(z)\cdot dz` is a
   * product its author meant, and saying so is better than a confusing failure inside
   * the bounded integrand parse. `\mathrm{d}` is not read — `mathrm` is not part of
   * this parser at all — so a document written that way gets "needs a differential",
   * which is true and points at the right place.
   */
  private findDifferential(): Result<{ index: number; variable: string } | null, ParseError> {
    let depth = 0;
    for (let at = this.index; at < this.end; at += 1) {
      const token = this.tokens[at] as LatexToken;
      if (token.kind === 'braceOpen' || token.kind === 'parenOpen') {
        depth += 1;
        continue;
      }
      if (token.kind === 'braceClose' || token.kind === 'parenClose') {
        depth -= 1;
        if (depth < 0) break;
        continue;
      }
      if (depth !== 0) continue;
      if (token.kind !== 'letter' || token.text !== 'd') continue;

      const next = this.tokens[at + 1];
      if (next === undefined || next.kind !== 'letter') continue;

      // The three multiplication commands, spelled out because `bindingFor` spells them
      // out too: `\cdot` is not in `OPERATOR_NAMES`, since it is written rather than
      // named.
      const before = this.tokens[at - 1];
      const multiplied =
        before?.kind === 'command' &&
        (before.text === 'cdot' || before.text === 'times' || before.text === 'ast');
      if (multiplied && before !== undefined) {
        return {
          ok: false,
          issue: wrong(
            before.span,
            `"d" multiplied by "${before.text}" is a product, not a differential. In a contour integral the differential stands beside the integrand: \\oint_{\\gamma} f(z)\\,dz.`,
          ),
        };
      }
      return { ok: true, value: { index: at, variable: canonicalName(next.text) } };
    }
    return { ok: true, value: null };
  }

  private parseCommandAtom(): Result<Expr, ParseError> {
    const token = this.peek();
    if (token?.kind !== 'command') {
      return { ok: false, issue: wrong(token?.span ?? this.lastSpan(), 'A command was expected.') };
    }

    const name = token.text;

    if (name === 'oint') {
      return this.parseContourIntegral(token);
    }

    if (name === 'frac') {
      this.advance();
      const numerator = this.parseRequiredGroup('numerator');
      if (!numerator.ok) return numerator;
      const denominator = this.parseRequiredGroup('denominator');
      if (!denominator.ok) return denominator;
      return {
        ok: true,
        value: {
          kind: 'binary',
          op: 'div',
          left: numerator.value,
          right: denominator.value,
          span: { start: token.span.start, end: denominator.value.span.end },
        },
      };
    }

    if (name === 'sqrt') {
      this.advance();
      // An optional degree: \sqrt[3]{x} is the cube root.
      let degree: Expr | null = null;
      if (this.peek()?.kind === 'bracketOpen') {
        const open = this.advance();
        const inner = this.parseExpression(0);
        if (!inner.ok) return inner;
        const close = this.peek();
        if (close?.kind !== 'bracketClose') {
          return {
            ok: false,
            issue: incomplete(open.span, 'That root index is missing its closing bracket.'),
          };
        }
        this.advance();
        degree = inner.value;
      }
      const radicand = this.parseRequiredGroup('radicand');
      if (!radicand.ok) return radicand;

      if (degree === null) {
        return {
          ok: true,
          value: {
            kind: 'call',
            callee: 'sqrt',
            args: [radicand.value],
            span: { start: token.span.start, end: radicand.value.span.end },
          },
        };
      }
      // The nth root is the power one over n.
      return {
        ok: true,
        value: {
          kind: 'binary',
          op: 'pow',
          left: radicand.value,
          right: {
            kind: 'binary',
            op: 'div',
            left: { kind: 'number', value: { n: 1n, d: 1n }, raw: '1', span: token.span },
            right: degree,
            span: degree.span,
          },
          span: { start: token.span.start, end: radicand.value.span.end },
        },
      };
    }

    if (name === 'overline') {
      // The standard notation for the complex conjugate.
      this.advance();
      const inner = this.parseRequiredGroup('argument');
      if (!inner.ok) return inner;
      return {
        ok: true,
        value: {
          kind: 'call',
          callee: 'conj',
          args: [inner.value],
          span: { start: token.span.start, end: inner.value.span.end },
        },
      };
    }

    if (name === 'operatorname') {
      this.advance();
      const operatorName = this.readOperatorName();
      if (!operatorName.ok) return operatorName;
      const mapped =
        OPERATOR_NAMES[operatorName.value] ?? canonicalName(operatorName.value.toLowerCase());
      const span: SourceSpan = { start: token.span.start, end: this.lastSpan().end };
      if (this.peek()?.kind === 'parenOpen') return this.parseCall(mapped, span);
      return { ok: true, value: { kind: 'variable', name: mapped, span } };
    }

    if (name === 'Re' || name === 'Im') {
      this.advance();
      const mapped = name === 'Re' ? 're' : 'im';
      const span: SourceSpan = { start: token.span.start, end: token.span.end };
      if (this.peek()?.kind === 'parenOpen') return this.parseCall(mapped, span);
      return { ok: true, value: { kind: 'variable', name: mapped, span } };
    }

    const greek = GREEK_COMMANDS[name];
    if (greek !== undefined) {
      this.advance();
      const subscript = this.readSubscript();
      if (!subscript.ok) return subscript;
      const full =
        subscript.value === null
          ? canonicalName(greek)
          : `${canonicalName(greek)}_${subscript.value}`;
      const span: SourceSpan = { start: token.span.start, end: this.lastSpan().end };
      return {
        ok: true,
        value: BUILTIN_CONSTANT_NAMES.has(full)
          ? { kind: 'constant', name: full, span }
          : { kind: 'variable', name: full, span },
      };
    }

    const functionName = FUNCTION_COMMANDS[name];
    if (functionName !== undefined) {
      this.advance();
      const canonical = canonicalName(functionName);
      const span: SourceSpan = { start: token.span.start, end: token.span.end };
      if (canonical === 'sqrt') {
        const radicand = this.parseRequiredGroup('radicand');
        if (!radicand.ok) return radicand;
        return {
          ok: true,
          value: {
            kind: 'call',
            callee: 'sqrt',
            args: [radicand.value],
            span: { start: token.span.start, end: radicand.value.span.end },
          },
        };
      }
      return this.parseCallArgument(canonical, span);
    }

    const operatorName = OPERATOR_NAMES[name];
    if (operatorName !== undefined) {
      this.advance();
      return this.parseCallArgument(operatorName, { start: token.span.start, end: token.span.end });
    }

    return {
      ok: false,
      issue: wrong(token.span, `"\\${name}" is not something this parser reads.`),
    };
  }

  /** `name(...)`, already positioned at the opening parenthesis. */
  private parseCall(callee: string, start: SourceSpan): Result<Expr, ParseError> {
    const grouped = this.parseParenthesisedResult();
    if (!grouped.ok) return grouped;
    const args = grouped.value.kind === 'tuple' ? grouped.value.items : [grouped.value];
    if (callee === 'Fourier' || callee === 'DFT') {
      const transformName = callee;
      if (args.length !== 1) {
        return {
          ok: false,
          issue: wrong(
            start,
            `${transformName} needs one source function call, as in ${transformName}(f(t)).`,
          ),
        };
      }
      const source = args[0] as Expr;
      if (source.kind !== 'call' || source.args.length !== 1) {
        return {
          ok: false,
          issue: wrong(
            start,
            `${transformName} needs a one-variable source function call, as in ${transformName}(f(t)).`,
          ),
        };
      }
      const variable = source.args[0] as Expr;
      if (variable.kind !== 'variable') {
        return {
          ok: false,
          issue: wrong(
            start,
            `${transformName} needs the source variable explicitly, as in ${transformName}(f(t)).`,
          ),
        };
      }
      return {
        ok: true,
        value: {
          kind: callee === 'Fourier' ? 'fourier-transform' : 'dft-transform',
          source,
          sourceVariable: variable.name,
          span: { start: start.start, end: this.lastSpan().end },
        },
      };
    }

    if (callee === 'Convolution') {
      if (args.length !== 2) {
        return {
          ok: false,
          issue: wrong(
            start,
            'Convolution needs two source function calls, as in Convolution(f(t), g(t)).',
          ),
        };
      }
      const left = args[0] as Expr;
      const right = args[1] as Expr;
      if (left.kind !== 'call' || left.args.length !== 1) {
        return {
          ok: false,
          issue: wrong(
            start,
            'Convolution needs a unary left source function call, as in Convolution(f(t), g(t)).',
          ),
        };
      }
      if (right.kind !== 'call' || right.args.length !== 1) {
        return {
          ok: false,
          issue: wrong(
            start,
            'Convolution needs a unary right source function call, as in Convolution(f(t), g(t)).',
          ),
        };
      }
      const leftVariable = left.args[0] as Expr;
      const rightVariable = right.args[0] as Expr;
      if (leftVariable.kind !== 'variable' || rightVariable.kind !== 'variable') {
        return {
          ok: false,
          issue: wrong(
            start,
            'Convolution needs explicit real source variables, as in Convolution(f(t), g(t)).',
          ),
        };
      }
      if (leftVariable.name !== rightVariable.name) {
        return { ok: false, issue: wrong(start, 'Convolution source calls must use the same variable.') };
      }
      return {
        ok: true,
        value: {
          kind: 'convolution',
          left,
          right,
          sourceVariable: leftVariable.name,
          span: { start: start.start, end: this.lastSpan().end },
        },
      };
    }

    return {
      ok: true,
      value: {
        kind: 'call',
        callee,
        args: [...args],
        span: { start: start.start, end: this.lastSpan().end },
      },
    };
  }

  /**
   * The argument of a function written without parentheses.
   *
   * `\sin x^2` is the sine of x squared, so the argument is taken at power
   * precedence: it swallows the exponent but stops before a juxtaposed factor.
   */
  private parseCallArgument(callee: string, start: SourceSpan): Result<Expr, ParseError> {
    const next = this.peek();
    if (next?.kind === 'parenOpen') return this.parseCall(callee, start);
    if (next?.kind === 'braceOpen') {
      const grouped = this.parseRequiredGroup('argument');
      if (!grouped.ok) return grouped;
      return {
        ok: true,
        value: {
          kind: 'call',
          callee,
          args: [grouped.value],
          span: { start: start.start, end: grouped.value.span.end },
        },
      };
    }

    const argument = this.parseExpression(PRECEDENCE_MULTIPLICATIVE + 1);
    if (!argument.ok) {
      return { ok: false, issue: incomplete(start, `${callee} is waiting for its argument.`) };
    }
    return {
      ok: true,
      value: {
        kind: 'call',
        callee,
        args: [argument.value],
        span: { start: start.start, end: argument.value.span.end },
      },
    };
  }

  private parseRequiredGroup(what: string): Result<Expr, ParseError> {
    const open = this.peek();
    if (open?.kind !== 'braceOpen') {
      return {
        ok: false,
        issue: incomplete(open?.span ?? this.lastSpan(), `That needs a ${what}.`),
      };
    }
    this.advance();
    const inner = this.parseExpression(0);
    if (!inner.ok) {
      if (inner.issue.incomplete === true) {
        return { ok: false, issue: incomplete(open.span, `That ${what} is empty or unfinished.`) };
      }
      return inner;
    }
    const close = this.peek();
    if (close?.kind !== 'braceClose') {
      return {
        ok: false,
        issue: incomplete(open.span, `That ${what} is missing its closing brace.`),
      };
    }
    this.advance();
    return { ok: true, value: inner.value };
  }

  private parseParenthesised(): Result<Expr, ParseError> {
    const grouped = this.parseParenthesisedResult();
    if (!grouped.ok) return grouped;
    return { ok: true, value: grouped.value };
  }

  /** A parenthesised group, which becomes a tuple when commas separate entries. */
  private parseParenthesisedResult(): Result<Expr, ParseError> {
    const open = this.peek();
    if (open?.kind !== 'parenOpen') {
      return {
        ok: false,
        issue: wrong(open?.span ?? this.lastSpan(), 'Expected an opening parenthesis.'),
      };
    }
    this.advance();

    const first = this.parseExpression(0);
    if (!first.ok) return first;

    const items: Expr[] = [first.value];
    while (this.peek()?.kind === 'comma') {
      this.advance();
      const item = this.parseExpression(0);
      if (!item.ok) return item;
      items.push(item.value);
    }

    const close = this.peek();
    if (close?.kind !== 'parenClose') {
      return {
        ok: false,
        issue: incomplete(open.span, 'That parenthesis is missing its closing partner.'),
      };
    }
    this.advance();

    const span: SourceSpan = { start: open.span.start, end: close.span.end };
    if (items.length === 1) return { ok: true, value: { ...(items[0] as Expr), span } };
    return { ok: true, value: { kind: 'tuple', items, span } };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LatexParseOptions {
  /** Names the document defines as functions, so `f(z)` reads as a call. */
  readonly knownFunctions?: ReadonlySet<string>;
}

/** Parse a LaTeX fragment as a whole statement. */
export function parseLatexStatement(
  latex: string,
  options: LatexParseOptions = {},
): Result<Statement, ParseError> {
  const tokens = tokenizeLatex(latex);
  if (!tokens.ok) return tokens;
  if (tokens.value.length === 0) {
    return {
      ok: false,
      issue: incomplete({ start: 0, end: latex.length }, 'Nothing has been written yet.'),
    };
  }
  return new LatexParser(tokens.value, tokens.value.length, {
    knownFunctions: options.knownFunctions ?? new Set(),
  }).parseStatement();
}

/** Parse a LaTeX fragment as a bare expression. */
export function parseLatexExpression(
  latex: string,
  options: LatexParseOptions = {},
): Result<Expr, ParseError> {
  const tokens = tokenizeLatex(latex);
  if (!tokens.ok) return tokens;
  if (tokens.value.length === 0) {
    return {
      ok: false,
      issue: incomplete({ start: 0, end: latex.length }, 'Nothing has been written yet.'),
    };
  }
  return new LatexParser(tokens.value, tokens.value.length, {
    knownFunctions: options.knownFunctions ?? new Set(),
  }).parseExpressionOnly();
}

/**
 * The name a LaTeX line defines, if it defines one.
 *
 * A token-shape test on the LaTeX head, used to collect function names before any
 * line is parsed — which is what lets a definition be used before it is written.
 */
export function detectLatexDefinition(
  latex: string,
): { name: string; parameters: string[] } | null {
  const tokens = tokenizeLatex(latex);
  if (!tokens.ok) return null;
  return new LatexParser(tokens.value, tokens.value.length, {
    knownFunctions: new Set(),
  }).definitionHeader();
}

/** The name a LaTeX line assigns, if it is a parameter assignment. */
export function detectLatexParameter(latex: string): string | null {
  const tokens = tokenizeLatex(latex);
  if (!tokens.ok) return null;
  return new LatexParser(tokens.value, tokens.value.length, {
    knownFunctions: new Set(),
  }).parameterName();
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const LATEX_PRECEDENCE_ADDITIVE = 10;
const LATEX_PRECEDENCE_MULTIPLICATIVE = 20;
const LATEX_PRECEDENCE_UNARY = 30;

function latexPrecedenceOf(expr: Expr): number {
  switch (expr.kind) {
    case 'binary':
      switch (expr.op) {
        case 'add':
        case 'sub':
          return LATEX_PRECEDENCE_ADDITIVE;
        case 'mul':
        case 'div':
          // A fraction groups itself, so a division needs no parentheses.
          return expr.op === 'div' ? 100 : LATEX_PRECEDENCE_MULTIPLICATIVE;
        case 'pow':
          return 40;
      }
      return 100;
    case 'unary':
      return LATEX_PRECEDENCE_UNARY;
    // Written out rather than left to the default below, so that a reader can see the
    // decision rather than guess that it was forgotten.
    case 'contour-integral':
      return 100;
    case 'fourier-transform':
      return 100;
    case 'dft-transform':
      return 100;
    case 'convolution':
      return 100;
    default:
      return 100;
  }
}

/**
 * A subscript as it is stored in a name.
 *
 * A simple run of letters and digits is kept bare so that `a_1` stays readable in
 * the canonical text. Anything else is braced, so `z_{k+1}` cannot be confused
 * with the sum `z_k + 1`.
 */
function wrapSubscript(text: string): string {
  return /^[A-Za-z0-9]+$/.test(text) ? text : `{${text}}`;
}

/**
 * The reverse, for the one subscript that is not part of a name.
 *
 * A subscript on an operator is a *whole* name rather than a suffix: `\oint_{\gamma}`
 * is the contour `gamma`, not a name `gamma` with something attached. `readSubscript`
 * returns the braced form a name wants, so it is unwrapped here — which is what makes
 * `\oint_{\gamma}` and `∮_gamma` produce the same path, and what makes
 * `nameToLatex('gamma')` print `\gamma` back.
 */
function unwrapSubscript(text: string): string {
  return text.startsWith('{') && text.endsWith('}') ? text.slice(1, -1) : text;
}

/** A variable name as LaTeX: Greek names become commands, subscripts get braces. */
function nameToLatex(name: string): string {
  const underscore = name.indexOf('_');
  const base = underscore === -1 ? name : name.slice(0, underscore);
  const subscript = underscore === -1 ? null : name.slice(underscore + 1);

  const greek = GREEK_BY_NAME[base];
  const renderedBase = greek === undefined ? base : `\\${greek}`;

  if (subscript === null) return renderedBase;
  // Already braced, and a single character needs none.
  if (subscript.startsWith('{') && subscript.endsWith('}')) return `${renderedBase}_${subscript}`;
  return subscript.length === 1 ? `${renderedBase}_${subscript}` : `${renderedBase}_{${subscript}}`;
}

function printLatex(expr: Expr, minimumPrecedence: number): string {
  const precedence = latexPrecedenceOf(expr);

  switch (expr.kind) {
    case 'number':
      return expr.raw;

    case 'variable':
      return nameToLatex(expr.name);

    case 'constant': {
      const greek = GREEK_BY_NAME[expr.name];
      return greek === undefined ? expr.name : `\\${greek}`;
    }

    case 'unary': {
      const inner = printLatex(expr.operand, LATEX_PRECEDENCE_UNARY);
      const text = expr.op === 'neg' ? `-${inner}` : inner;
      return precedence < minimumPrecedence ? `\\left(${text}\\right)` : text;
    }

    case 'binary': {
      if (expr.op === 'div') {
        const numerator = printLatex(expr.left, 0);
        const denominator = printLatex(expr.right, 0);
        return `\\frac{${numerator}}{${denominator}}`;
      }

      if (expr.op === 'pow') {
        const base = printLatex(expr.left, 41);
        const exponent = printLatex(expr.right, 0);
        const text = `${base}^{${exponent}}`;
        return precedence < minimumPrecedence ? `\\left(${text}\\right)` : text;
      }

      const leftMinimum = precedence;
      const rightMinimum = precedence + 1;
      const left = printLatex(expr.left, leftMinimum);
      const right = printLatex(expr.right, rightMinimum);

      let operator: string;
      switch (expr.op) {
        case 'add':
          operator = '+';
          break;
        case 'sub':
          operator = '-';
          break;
        default:
          // Multiplication is written as juxtaposition when it reads naturally
          // that way — `2x`, `2\pi` — and with a dot otherwise.
          operator = shouldJuxtapose(expr) ? ' ' : '\\cdot ';
          break;
      }

      const text = `${left}${operator}${right}`;
      return precedence < minimumPrecedence ? `\\left(${text}\\right)` : text;
    }

    case 'call': {
      const argument = expr.args[0];
      if (argument === undefined) return `${expr.callee}\\left(\\right)`;

      if (expr.callee === 'abs') {
        return `\\left|${printLatex(argument, 0)}\\right|`;
      }
      if (expr.callee === 'conj') {
        return `\\overline{${printLatex(argument, 0)}}`;
      }
      if (expr.callee === 'sqrt') {
        return `\\sqrt{${printLatex(argument, 0)}}`;
      }

      const command = LATEX_BY_FUNCTION[expr.callee];
      if (command !== undefined) return `${command}\\left(${printLatex(argument, 0)}\\right)`;

      const operatorName = OPERATOR_BY_FUNCTION[expr.callee];
      if (operatorName !== undefined) {
        return `\\operatorname{${operatorName}}\\left(${printLatex(argument, 0)}\\right)`;
      }

      return `${expr.callee}\\left(${printLatex(argument, 0)}\\right)`;
    }

    case 'tuple':
      return `\\left(${expr.items.map((item) => printLatex(item, 0)).join(', ')}\\right)`;

    case 'contour-integral': {
      // `\,` between the integrand and the differential is the conventional thin space,
      // and it is what stops `dz` reading as part of the integrand. The integrand is
      // printed at minimum precedence so that a sum inside it is braced.
      const integrand = printLatex(expr.integrand, 1);
      return `\\oint_{${nameToLatex(expr.path)}}${integrand}\\,d${nameToLatex(expr.variable)}`;
    }

    case 'fourier-transform':
      return `\\operatorname{Fourier}\\left(${printLatex(expr.source, 0)}\\right)`;

    case 'dft-transform':
      return `\\operatorname{DFT}\\left(${printLatex(expr.source, 0)}\\right)`;

    case 'convolution':
      return `\\operatorname{Convolution}\\left(${printLatex(expr.left, 0)},${printLatex(expr.right, 0)}\\right)`;
  }
}

/** Whether a product should be written without a multiplication sign. */
function shouldJuxtapose(expr: Extract<Expr, { kind: 'binary' }>): boolean {
  const left = expr.left;
  const right = expr.right;
  const rightIsSimple = right.kind === 'variable' || right.kind === 'constant';
  // A number followed by a symbol, or a symbol by another symbol.
  if (left.kind === 'number' && rightIsSimple) return true;
  if ((left.kind === 'variable' || left.kind === 'constant') && rightIsSimple) return false;
  return false;
}

/** Print an expression as LaTeX. */
export function exprToLatex(expr: Expr): string {
  return printLatex(expr, 0);
}

/** Print a whole statement as LaTeX, including the head of a definition. */
export function statementToLatex(statement: Statement): string {
  switch (statement.kind) {
    case 'function-definition': {
      const parameters = statement.parameters.map(nameToLatex).join(', ');
      const interval =
        statement.interval === undefined
          ? ''
          : `;[${exprToLatex(statement.interval.from)},${exprToLatex(statement.interval.to)}]`;
      return `${nameToLatex(statement.name)}\\left(${parameters}${interval}\\right)=${exprToLatex(statement.body)}`;
    }
    case 'parameter':
      return `${nameToLatex(statement.name)}=${exprToLatex(statement.body)}`;
    case 'expression':
      return exprToLatex(statement.body);
  }
}

/**
 * Rewrite plain-text source as LaTeX, by way of the canonical AST.
 *
 * Used to seed the editor from material written in the plain syntax: the examples
 * offered in the interface, and sessions stored before the editor existed. The tree
 * is the pivot, so the LaTeX cannot say something different from what the plain text
 * said — one representation, converted, rather than two maintained in parallel.
 *
 * Source that does not parse is returned unchanged. That is deliberate: this is a
 * best-effort seeding step, and a line that cannot be read should reach the editor
 * as written and be reported by the parser there, rather than being silently
 * replaced by nothing.
 */
export function plainToLatex(source: string): string {
  const parsed = parseStatement(source);
  return parsed.ok ? statementToLatex(parsed.value) : source;
}

/** Expose the vocabulary so the keypad can label its buttons consistently. */
export const LATEX_GREEK_COMMANDS = GREEK_COMMANDS;
export const LATEX_FUNCTION_COMMANDS = FUNCTION_COMMANDS;

/**
 * Every command this parser reads.
 *
 * Exported so that a caller which *produces* LaTeX — the keypad — can check its own
 * output against the parser's vocabulary, rather than discovering the mismatch when a
 * user presses a key and gets an error.
 */
export const LATEX_KNOWN_COMMANDS: ReadonlySet<string> = new Set([
  ...Object.keys(GREEK_COMMANDS),
  ...Object.keys(FUNCTION_COMMANDS),
  ...Object.keys(OPERATOR_NAMES),
  ...IGNORED_COMMANDS,
  // Structural commands.
  'oint',
  'frac',
  'sqrt',
  'overline',
  'operatorname',
  'cdot',
  'times',
  'ast',
  'left',
  'right',
  'Re',
  'Im',
]);

/** The binary operator a LaTeX command stands for, for the keypad. */
export const LATEX_OPERATOR_COMMANDS: Readonly<Record<string, BinaryOperator>> = {
  cdot: 'mul',
  times: 'mul',
};

/** True when the LaTeX is unfinished rather than wrong. */
export function isIncomplete(error: ParseError): boolean {
  return error.incomplete === true;
}
