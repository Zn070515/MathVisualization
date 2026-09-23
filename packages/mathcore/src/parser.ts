/**
 * Parser.
 *
 * A hand-written precedence-climbing (Pratt) parser producing the canonical AST
 * from `ast.ts`. Written here rather than delegated to a third-party parser so
 * that the tree the whole project depends on is ours: a library can be an
 * engine, but it must not own the product's mathematical model (GOAL.md 8).
 *
 * What it understands:
 *
 *   numbers, names, constants, + - * / ^, parentheses, function calls,
 *   tuples, implicit multiplication, unary sign, and the two statement forms
 *   `f(x) = ...` and `a = 2`.
 *
 * Implicit multiplication
 * -----------------------
 * Juxtaposition multiplies: `2z`, `2(z+1)`, `2pi`, `(z+1)(z-1)`.
 *
 * The one genuinely ambiguous case is a name followed by `(`. `sin(z)` is a
 * call; `z(z+1)` is a product. This is resolved with the caller-supplied set of
 * known function names, which the application builds from the workspace's
 * function definitions plus the builtin registry. Parsing therefore depends on
 * the workspace, and that is a deliberate, documented choice: it is the only way
 * to read `z(z+1)` the way a mathematician means it without inventing notation.
 * A name that is not a known function followed by `(` is a product.
 *
 * Precedence (low to high): `+ -`, `* /` and implicit multiplication, unary sign,
 * `^` (right associative). So `-z^2` is `-(z^2)` and `2^-3` is well formed.
 * Because implicit multiplication has the precedence of `*`, `2z^2` is `2*(z^2)`.
 */
import {
  type BinaryOperator,
  type Expr,
  type PathInterval,
  type Statement,
  type UnaryOperator,
} from './ast';
import { BUILTIN_CONSTANT_NAMES } from './conventions';
import { BUILTIN_FUNCTION_NAMES } from './builtins';
import { type ParseError, type Result, span } from './errors';
import { tokenize, type Token } from './lexer';
import { rationalFromLiteralText } from './rational';

const PRECEDENCE_ADDITIVE = 10;
const PRECEDENCE_MULTIPLICATIVE = 20;
const PRECEDENCE_UNARY = 30;
const PRECEDENCE_POWER = 40;

export interface ParseOptions {
  /**
   * Names to treat as functions, so that `f(x)` is a call rather than a product.
   * Builtin function names are always included; callers add the workspace's own
   * definitions so that definition order does not matter.
   */
  readonly knownFunctions?: ReadonlySet<string>;
  /**
   * Names bound as values: parameters, and the parameters of definitions. A name
   * in this set is read as one symbol; a name outside it is subject to the
   * juxtaposed-letter rule below. Builtin constants are always included.
   */
  readonly knownValues?: ReadonlySet<string>;
}

class Parser {
  private readonly tokens: readonly Token[];
  private readonly source: string;
  private readonly knownFunctions: ReadonlySet<string>;
  private readonly knownValues: ReadonlySet<string>;
  private index = 0;

  constructor(tokens: readonly Token[], source: string, options: ParseOptions) {
    this.tokens = tokens;
    this.source = source;
    const names = new Set<string>(BUILTIN_FUNCTION_NAMES);
    for (const name of options.knownFunctions ?? []) names.add(name);
    this.knownFunctions = names;

    const values = new Set<string>(BUILTIN_CONSTANT_NAMES);
    for (const name of options.knownValues ?? []) values.add(name);
    this.knownValues = values;
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset];
  }

  private advance(): Token {
    const token = this.tokens[this.index];
    // Callers only advance after checking, so a missing token is a bug in the
    // parser rather than bad user input.
    if (token === undefined) throw new Error('parser advanced past end of input');
    this.index += 1;
    return token;
  }

  private errorAt(token: Token | undefined, message: string): ParseError {
    const at = token ?? this.tokens[this.tokens.length - 1];
    const position = at === undefined ? this.source.length : at.start;
    return { kind: 'parse-error', message, span: span(position, at?.end ?? position) };
  }

  // ---------------------------------------------------------------- statements

  /**
   * Parse the whole input as one statement.
   *
   * `f(x) = ...` is a definition, `a = ...` is a parameter, anything else is a
   * bare expression. Trailing tokens are an error rather than silently ignored.
   */
  parseStatement(): Result<Statement, ParseError> {
    const first = this.peek();
    if (first === undefined) {
      return { ok: false, issue: this.errorAt(undefined, 'The expression is empty.') };
    }

    if (first.type === 'name') {
      const second = this.peek(1);
      if (second?.type === 'equals') {
        this.advance();
        this.advance();
        const body = this.parseExpressionResult(0);
        if (!body.ok) return body;
        const trailing = this.trailingError();
        if (trailing !== null) return { ok: false, issue: trailing };
        return {
          ok: true,
          value: {
            kind: 'parameter',
            name: first.text,
            body: body.value,
            span: span(first.start, body.value.span.end),
          },
        };
      }

      if (second?.type === 'lparen') {
        const header = this.tryParseDefinitionHeader();
        if (header !== null) {
          if (BUILTIN_FUNCTION_NAMES.has(header.name)) {
            return {
              ok: false,
              issue: this.errorAt(
                first,
                `"${header.name}" is a builtin function and cannot be redefined.`,
              ),
            };
          }
          const body = this.parseExpressionResult(0);
          if (!body.ok) return body;
          const trailing = this.trailingError();
          if (trailing !== null) return { ok: false, issue: trailing };
          return {
            ok: true,
            value: {
              kind: 'function-definition',
              name: header.name,
              parameters: header.parameters,
              ...(header.interval === undefined ? {} : { interval: header.interval }),
              body: body.value,
              span: span(first.start, body.value.span.end),
            },
          };
        }
      }
    }

    const body = this.parseExpressionResult(0);
    if (!body.ok) return body;
    const trailing = this.trailingError();
    if (trailing !== null) return { ok: false, issue: trailing };
    return {
      ok: true,
      value: { kind: 'expression', body: body.value, span: body.value.span },
    };
  }

  /**
   * Recognise `name ( ident [, ident]* ) =`, leaving the parser positioned at the
   * body. Returns `null` without consuming anything if the shape does not match,
   * in which case the input is an ordinary expression such as `sin(z)`.
   */
  private tryParseDefinitionHeader(): {
    name: string;
    parameters: string[];
    interval?: PathInterval;
  } | null {
    const saved = this.index;
    const nameToken = this.advance();
    this.advance(); // lparen

    const parameters: string[] = [];
    if (this.peek()?.type === 'rparen') {
      this.index = saved;
      return null;
    }

    for (;;) {
      const parameter = this.peek();
      if (parameter?.type !== 'name') {
        this.index = saved;
        return null;
      }
      this.advance();
      parameters.push(parameter.text);

      const separator = this.peek();
      if (separator?.type === 'semicolon') {
        if (parameters.length !== 1) {
          this.index = saved;
          return null;
        }
        const interval = this.parseIntervalHeader(parameters[0] as string);
        if (interval === null) {
          this.index = saved;
          return null;
        }
        if (this.peek()?.type !== 'rparen') {
          this.index = saved;
          return null;
        }
        this.advance();
        if (this.peek()?.type !== 'equals') {
          this.index = saved;
          return null;
        }
        this.advance();
        return { name: nameToken.text, parameters, interval };
      }
      if (separator?.type === 'comma') {
        this.advance();
        continue;
      }
      if (separator?.type === 'rparen') {
        this.advance();
        break;
      }
      this.index = saved;
      return null;
    }

    if (this.peek()?.type !== 'equals') {
      this.index = saved;
      return null;
    }
    this.advance(); // equals

    return { name: nameToken.text, parameters };
  }

  /** Parse `[from, to]` after the semicolon in a one-parameter path header. */
  private parseIntervalHeader(parameter: string): PathInterval | null {
    const semicolon = this.advance();
    const open = this.peek();
    if (open?.type !== 'bracketOpen') return null;
    this.advance();

    const fromStart = this.index;
    let depth = 0;
    let comma = -1;
    for (; this.index < this.tokens.length; this.index += 1) {
      const token = this.tokens[this.index] as Token;
      if (token.type === 'lparen') depth += 1;
      else if (token.type === 'rparen') depth -= 1;
      else if (token.type === 'comma' && depth === 0) {
        comma = this.index;
        break;
      }
    }
    if (comma === -1) return null;

    const from = new Parser(this.tokens.slice(fromStart, comma), this.source, {
      knownFunctions: this.knownFunctions,
      knownValues: this.knownValues,
    }).parseWholeExpression();
    if (!from.ok) return null;

    this.index = comma + 1;
    const toStart = this.index;
    depth = 0;
    let close = -1;
    for (; this.index < this.tokens.length; this.index += 1) {
      const token = this.tokens[this.index] as Token;
      if (token.type === 'lparen') depth += 1;
      else if (token.type === 'rparen') depth -= 1;
      else if (token.type === 'bracketClose' && depth === 0) {
        close = this.index;
        break;
      }
    }
    if (close === -1) return null;

    const to = new Parser(this.tokens.slice(toStart, close), this.source, {
      knownFunctions: this.knownFunctions,
      knownValues: this.knownValues,
    }).parseWholeExpression();
    if (!to.ok) return null;

    const closeToken = this.tokens[close] as Token;
    this.index = close + 1;
    return {
      parameter,
      from: from.value,
      to: to.value,
      span: { start: semicolon.start, end: closeToken.end },
    };
  }

  /**
   * Parse every remaining token as one expression.
   *
   * Used for the integrand of a contour integral, which is parsed by a second parser
   * over a slice of this one's tokens — the same mechanism `LatexParser` uses for a
   * definition head, and the reason the differential can be found before the
   * expression that precedes it is parsed.
   */
  parseWholeExpression(): Result<Expr, ParseError> {
    const body = this.parseExpressionResult(0);
    if (!body.ok) return body;
    const trailing = this.trailingError();
    if (trailing !== null) return { ok: false, issue: trailing };
    return body;
  }

  private trailingError(): ParseError | null {
    const token = this.peek();
    if (token === undefined) return null;
    if (token.type === 'equals') {
      return this.errorAt(
        token,
        'A definition needs a name or a function header on the left of "=", as in `a = 2` or `f(z) = ...`.',
      );
    }
    return this.errorAt(token, `Unexpected "${token.text}" after the end of the expression.`);
  }

  // --------------------------------------------------------------- expressions

  /** Parse a complete expression, or report the first syntax problem. */
  parseExpressionResult(minPrecedence: number): Result<Expr, ParseError> {
    const first = this.parsePrefix();
    if (!first.ok) return first;
    let left: Expr = first.value;

    for (;;) {
      const token = this.peek();
      if (token === undefined) break;

      const binding = this.infixBinding(token);
      if (binding === null) break;
      if (binding.precedence < minPrecedence) break;

      // An explicit operator is consumed here. A juxtaposition is not: the token
      // that triggers it is the first token of the right operand, so consuming it
      // would lose the operand's opening parenthesis or name.
      if (binding.consumesToken) this.advance();
      const right = this.parseExpressionResult(
        binding.rightAssociative ? binding.precedence : binding.precedence + 1,
      );
      if (!right.ok) return right;

      left = {
        kind: 'binary',
        op: binding.op,
        left,
        right: right.value,
        span: span(left.span.start, right.value.span.end),
      };
    }

    return { ok: true, value: left };
  }

  private infixBinding(token: Token): {
    op: BinaryOperator;
    precedence: number;
    rightAssociative: boolean;
    /** Whether the token is the operator itself, as opposed to a juxtaposition. */
    consumesToken: boolean;
  } | null {
    if (token.type === 'operator') {
      switch (token.text) {
        case '+':
          return {
            op: 'add',
            precedence: PRECEDENCE_ADDITIVE,
            rightAssociative: false,
            consumesToken: true,
          };
        case '-':
          return {
            op: 'sub',
            precedence: PRECEDENCE_ADDITIVE,
            rightAssociative: false,
            consumesToken: true,
          };
        case '*':
          return {
            op: 'mul',
            precedence: PRECEDENCE_MULTIPLICATIVE,
            rightAssociative: false,
            consumesToken: true,
          };
        case '/':
          return {
            op: 'div',
            precedence: PRECEDENCE_MULTIPLICATIVE,
            rightAssociative: false,
            consumesToken: true,
          };
        case '^':
          return {
            op: 'pow',
            precedence: PRECEDENCE_POWER,
            rightAssociative: true,
            consumesToken: true,
          };
        default:
          return null;
      }
    }
    // Juxtaposition multiplies. The token is not consumed; it starts the operand.
    if (token.type === 'number' || token.type === 'name' || token.type === 'lparen') {
      return {
        op: 'mul',
        precedence: PRECEDENCE_MULTIPLICATIVE,
        rightAssociative: false,
        consumesToken: false,
      };
    }
    return null;
  }

  private parsePrefix(): Result<Expr, ParseError> {
    const token = this.peek();
    if (token === undefined) {
      return { ok: false, issue: this.errorAt(undefined, 'Expected an expression.') };
    }

    if (token.type === 'number') {
      this.advance();
      const value = rationalFromLiteralText(token.text);
      if (value === null) {
        return {
          ok: false,
          issue: this.errorAt(
            token,
            `The number ${token.text} is outside the representable range.`,
          ),
        };
      }
      return {
        ok: true,
        value: {
          kind: 'number',
          value,
          raw: token.text,
          span: span(token.start, token.end),
        },
      };
    }

    if (token.type === 'integral') {
      return this.parseContourIntegral(token);
    }

    if (token.type === 'name') {
      this.advance();
      const next = this.peek();
      if (next?.type === 'lparen' && this.knownFunctions.has(token.text)) {
        return this.parseCall(token);
      }
      // A leading underscore is how a contour is named after the `∮`, and nowhere
      // else. Without this, `_gamma` would go to the juxtaposed-letters rule and
      // quietly become `_ · g · a · m · m · a`, which is a wrong answer rather than a
      // message.
      if (token.text.startsWith('_')) {
        return {
          ok: false,
          issue: this.errorAt(
            token,
            'A name beginning with an underscore names a contour, and only after ∮ — as in ∮_gamma f(z) dz.',
          ),
        };
      }
      if (BUILTIN_CONSTANT_NAMES.has(token.text)) {
        return {
          ok: true,
          value: { kind: 'constant', name: token.text, span: span(token.start, token.end) },
        };
      }
      if (this.knownValues.has(token.text)) {
        return {
          ok: true,
          value: { kind: 'variable', name: token.text, span: span(token.start, token.end) },
        };
      }
      // A function name used without an argument list is a mistake worth naming,
      // rather than an unbound variable that would fail later.
      if (this.knownFunctions.has(token.text)) {
        return {
          ok: false,
          issue: this.errorAt(token, `"${token.text}" is a function. Write ${token.text}(...).`),
        };
      }
      return { ok: true, value: this.juxtaposedLetters(token) };
    }

    if (token.type === 'operator' && (token.text === '-' || token.text === '+')) {
      this.advance();
      const operand = this.parseExpressionResult(PRECEDENCE_UNARY);
      if (!operand.ok) return operand;
      const op: UnaryOperator = token.text === '-' ? 'neg' : 'pos';
      // A leading `+` is not part of the mathematics; drop it but keep the span
      // so that error positions still cover the text the user wrote.
      if (op === 'pos') {
        return {
          ok: true,
          value: { ...operand.value, span: span(token.start, operand.value.span.end) },
        };
      }
      return {
        ok: true,
        value: {
          kind: 'unary',
          op,
          operand: operand.value,
          span: span(token.start, operand.value.span.end),
        },
      };
    }

    if (token.type === 'lparen') {
      return this.parseParenthesised(token);
    }

    return {
      ok: false,
      issue: this.errorAt(token, `Expected an expression, found "${token.text}".`),
    };
  }

  /**
   * `∮_gamma f(z) dz`.
   *
   * The differential is looked for *first*, by a scan at bracket depth zero, and the
   * integrand is then parsed by a second parser over the tokens that precede it. The
   * order matters: without it the ordinary expression parser would swallow `dz` as a
   * factor — juxtaposition multiplies, so `f(z) dz` reads as `f(z)·d·z` — and the
   * differential would have to be recognised after the fact, from a tree that no
   * longer contains it.
   *
   * The alternative, teaching the *lexer* that `d` followed by a letter is a
   * differential, was rejected: it would change the meaning of the documented variable
   * `d` in every line of every workspace, and `d(x)` would stay a product while `dx`
   * would not. Confining the rule to this construct keeps the rest of the language
   * exactly as it was.
   */
  private parseContourIntegral(sign: Token): Result<Expr, ParseError> {
    this.advance();

    const nameToken = this.peek();
    if (nameToken === undefined || nameToken.type !== 'name') {
      return {
        ok: false,
        issue: this.errorAt(nameToken, 'A contour integral names its path, as in ∮_gamma f(z) dz.'),
      };
    }
    this.advance();
    const path = nameToken.text.startsWith('_') ? nameToken.text.slice(1) : nameToken.text;
    if (path === '') {
      return {
        ok: false,
        issue: this.errorAt(nameToken, 'A contour is named after the ∮, as in ∮_gamma f(z) dz.'),
      };
    }

    const found = this.findDifferential();
    if (!found.ok) return found;
    if (found.value === null) {
      return {
        ok: false,
        issue: this.errorAt(
          this.peek(),
          'A contour integral needs a differential saying what is integrated, as in ∮_gamma f(z) dz.',
        ),
      };
    }
    const differential = found.value;

    const integrandTokens = this.tokens.slice(this.index, differential.index);
    const inner = new Parser(integrandTokens, this.source, {
      knownFunctions: this.knownFunctions,
      // The integration variable is bound by the integral, so inside the integrand it
      // is a name like any other bound name.
      knownValues: new Set([...this.knownValues, differential.variable]),
    });
    const integrand = inner.parseWholeExpression();
    if (!integrand.ok) {
      return {
        ok: false,
        issue: this.errorAt(
          integrandTokens[0] ?? sign,
          `The integrand of a contour integral is an expression in ${differential.variable}: ${integrand.issue.message}`,
        ),
      };
    }

    this.index = differential.index + differential.length;
    const last = this.tokens[this.index - 1];
    return {
      ok: true,
      value: {
        kind: 'contour-integral',
        path,
        pathSpan: span(nameToken.start, nameToken.end),
        variable: differential.variable,
        integrand: integrand.value,
        span: span(sign.start, last?.end ?? sign.end),
      },
    };
  }

  /**
   * The differential that ends the integrand, found by shape and bracket depth.
   *
   * Depth matters: in `∮_γ f(g(dz)) dz` the inner `dz` is inside brackets and is part
   * of the integrand, not the differential. An operator immediately before the
   * differential is the other case worth catching — `f(z)*dz` is someone writing the
   * product they mean, and saying so is better than letting the integrand parse fail
   * somewhere confusing.
   */
  private findDifferential(): Result<
    { index: number; variable: string; length: number } | null,
    ParseError
  > {
    let depth = 0;
    for (let scan = this.index; scan < this.tokens.length; scan += 1) {
      const token = this.tokens[scan];
      if (token === undefined) break;
      if (token.type === 'lparen') {
        depth += 1;
        continue;
      }
      if (token.type === 'rparen') {
        depth -= 1;
        if (depth < 0) break;
        continue;
      }
      if (depth !== 0) continue;

      const spelled = differentialAt(token, this.tokens[scan + 1]);
      if (spelled === null) continue;

      const before = this.tokens[scan - 1];
      if (before !== undefined && before.type === 'operator') {
        return {
          ok: false,
          issue: this.errorAt(
            before,
            `"${token.text}" multiplied by "${before.text}" is a product, not a differential. In a contour integral the differential stands beside the integrand: ∮_gamma f(z) dz.`,
          ),
        };
      }
      return { ok: true, value: { index: scan, ...spelled } };
    }
    return { ok: true, value: null };
  }

  /**
   * Read an unknown run of letters as a product of its letters.
   *
   * In mathematics, `ay` means `a * y` and `it` means `i * t`. Since the lexer
   * reads a maximal run of letters as one token, a run that is not a name the
   * workspace knows is split back into single letters and multiplied. This is
   * what makes `gamma(t) = 2e^(it)` and `f(x,y) = x^2 + a y^2` mean what they
   * look like, while `pi`, `sin`, a parameter you defined and a function you
   * defined all stay single symbols because they *are* known names.
   */
  private juxtaposedLetters(token: Token): Expr {
    const characters = [...token.text];
    let result: Expr | null = null;
    let offset = token.start;

    for (const character of characters) {
      const end = offset + character.length;
      const node: Expr = BUILTIN_CONSTANT_NAMES.has(character)
        ? { kind: 'constant', name: character, span: span(offset, end) }
        : { kind: 'variable', name: character, span: span(offset, end) };

      result =
        result === null
          ? node
          : {
              kind: 'binary',
              op: 'mul',
              left: result,
              right: node,
              span: span(token.start, end),
            };
      offset = end;
    }

    // The token text is non-empty, so the loop always produced a node.
    return result as Expr;
  }

  /** Arguments of a call, or a tuple when there is more than one item. */
  private parseParenthesised(open: Token): Result<Expr, ParseError> {
    this.advance(); // lparen

    const first = this.parseExpressionResult(0);
    if (!first.ok) return first;

    const items: Expr[] = [first.value];
    while (this.peek()?.type === 'comma') {
      this.advance();
      const item = this.parseExpressionResult(0);
      if (!item.ok) return item;
      items.push(item.value);
    }

    const closing = this.peek();
    if (closing?.type !== 'rparen') {
      return {
        ok: false,
        issue: this.errorAt(closing, 'Expected a closing parenthesis.'),
      };
    }
    this.advance();

    const end = closing.end;
    if (items.length === 1) {
      const only = items[0] as Expr;
      return { ok: true, value: { ...only, span: span(open.start, end) } };
    }
    return {
      ok: true,
      value: { kind: 'tuple', items, span: span(open.start, end) },
    };
  }

  private parseCall(callee: Token): Result<Expr, ParseError> {
    this.advance(); // lparen
    const args: Expr[] = [];

    if (this.peek()?.type !== 'rparen') {
      for (;;) {
        const argument = this.parseExpressionResult(0);
        if (!argument.ok) return argument;
        args.push(argument.value);
        if (this.peek()?.type === 'comma') {
          this.advance();
          continue;
        }
        break;
      }
    }

    const closing = this.peek();
    if (closing?.type !== 'rparen') {
      return { ok: false, issue: this.errorAt(closing, 'Expected a closing parenthesis.') };
    }
    this.advance();

    if (callee.text === 'Fourier' || callee.text === 'DFT') {
      const transformName = callee.text;
      if (args.length !== 1) {
        return {
          ok: false,
          issue: this.errorAt(
            callee,
            `${transformName} needs one source function call, as in ${transformName}(f(t)).`,
          ),
        };
      }
      const source = args[0] as Expr;
      if (source.kind !== 'call' || source.args.length !== 1) {
        return {
          ok: false,
          issue: this.errorAt(
            callee,
            `${transformName} needs a one-variable source function call, as in ${transformName}(f(t)).`,
          ),
        };
      }
      const variable = source.args[0] as Expr;
      if (variable.kind !== 'variable') {
        return {
          ok: false,
          issue: this.errorAt(
            callee,
            `${transformName} needs the source variable explicitly, as in ${transformName}(f(t)).`,
          ),
        };
      }
      return {
        ok: true,
        value: {
          kind: callee.text === 'Fourier' ? 'fourier-transform' : 'dft-transform',
          source,
          sourceVariable: variable.name,
          span: span(callee.start, this.lastTokenEnd(args)),
        },
      };
    }

    if (callee.text === 'Convolution') {
      if (args.length !== 2) {
        return {
          ok: false,
          issue: this.errorAt(
            callee,
            'Convolution needs two source function calls, as in Convolution(f(t), g(t)).',
          ),
        };
      }
      const left = args[0] as Expr;
      const right = args[1] as Expr;
      if (left.kind !== 'call' || left.args.length !== 1) {
        return {
          ok: false,
          issue: this.errorAt(
            callee,
            'Convolution needs a unary left source function call, as in Convolution(f(t), g(t)).',
          ),
        };
      }
      if (right.kind !== 'call' || right.args.length !== 1) {
        return {
          ok: false,
          issue: this.errorAt(
            callee,
            'Convolution needs a unary right source function call, as in Convolution(f(t), g(t)).',
          ),
        };
      }
      const leftVariable = left.args[0] as Expr;
      const rightVariable = right.args[0] as Expr;
      if (leftVariable.kind !== 'variable' || rightVariable.kind !== 'variable') {
        return {
          ok: false,
          issue: this.errorAt(
            callee,
            'Convolution needs explicit real source variables, as in Convolution(f(t), g(t)).',
          ),
        };
      }
      if (leftVariable.name !== rightVariable.name) {
        return {
          ok: false,
          issue: this.errorAt(callee, 'Convolution source calls must use the same variable.'),
        };
      }
      return {
        ok: true,
        value: {
          kind: 'convolution',
          left,
          right,
          sourceVariable: leftVariable.name,
          span: span(callee.start, this.lastTokenEnd(args)),
        },
      };
    }

    return {
      ok: true,
      value: {
        kind: 'call',
        callee: callee.text,
        args,
        span: span(callee.start, closing.end),
      },
    };
  }

  private lastTokenEnd(args: readonly Expr[]): number {
    const token = this.tokens[this.index - 1];
    return token?.end ?? args[args.length - 1]?.span.end ?? this.source.length;
  }
}

/**
 * The names a set of sources defines as functions.
 *
 * Needed before parsing, because the parser has to know whether `f(x)` is a call
 * or `f` multiplied by `x`. Detection is a pure token-shape test — the tokens
 * must be exactly `name ( name [, name]* ) =` — so it cannot misfire on
 * `z(z+1)`, whose tokens are `name ( name + number )`. Doing it as a separate
 * pass is what makes function definitions order-independent: `f` may be used
 * before it is written.
 */
export function detectDefinitionHeader(
  source: string,
): { name: string; parameters: string[] } | null {
  const tokens = tokenize(source);
  if (!tokens.ok) return null;
  const list = tokens.value;

  const nameToken = list[0];
  if (nameToken === undefined || nameToken.type !== 'name') return null;
  if (list[1]?.type !== 'lparen') return null;

  const parameters: string[] = [];
  let index = 2;
  for (;;) {
    const parameter = list[index];
    if (parameter === undefined || parameter.type !== 'name') return null;
    parameters.push(parameter.text);
    index += 1;

    const separator = list[index];
    if (separator?.type === 'semicolon') {
      if (parameters.length !== 1 || list[index + 1]?.type !== 'bracketOpen') return null;
      index += 2;
      let depth = 0;
      let foundComma = false;
      for (; index < list.length; index += 1) {
        const token = list[index];
        if (token?.type === 'lparen') depth += 1;
        else if (token?.type === 'rparen') depth -= 1;
        else if (token?.type === 'comma' && depth === 0) {
          foundComma = true;
          index += 1;
          break;
        }
      }
      if (!foundComma) return null;
      depth = 0;
      for (; index < list.length; index += 1) {
        const token = list[index];
        if (token?.type === 'lparen') depth += 1;
        else if (token?.type === 'rparen') depth -= 1;
        else if (token?.type === 'bracketClose' && depth === 0) break;
      }
      if (list[index]?.type !== 'bracketClose' || list[index + 1]?.type !== 'rparen') return null;
      index += 2;
    } else if (separator?.type === 'comma') {
      index += 1;
      continue;
    } else if (separator?.type === 'rparen') {
      index += 1;
      break;
    } else {
      return null;
    }
  }

  if (list[index]?.type !== 'equals') return null;
  return { name: nameToken.text, parameters };
}

/**
 * The integration variable, if these tokens spell a differential.
 *
 * Two spellings for one thing, because the lexer reads a maximal run of letters as a
 * single token: `dz` arrives as one name and `d z` as two. Reading both is what keeps
 * the plain and LaTeX front ends agreeing, since `d z` is two letters on the LaTeX
 * side no matter how it was written.
 */
function differentialAt(
  token: Token,
  next: Token | undefined,
): { variable: string; length: number } | null {
  if (token.type !== 'name') return null;
  if (/^d[A-Za-z]$/.test(token.text)) return { variable: token.text.slice(1), length: 1 };
  if (token.text === 'd' && next?.type === 'name' && /^[A-Za-z]$/.test(next.text)) {
    return { variable: next.text, length: 2 };
  }
  return null;
}

/**
 * The name of the parameter a source defines, if it defines one.
 *
 * Token shape only: `name =`. Anything else is not a parameter assignment, so a
 * bare expression such as `z^2` is not mistaken for one.
 */
export function detectParameterName(source: string): string | null {
  const tokens = tokenize(source);
  if (!tokens.ok) return null;
  const list = tokens.value;
  if (list[0]?.type !== 'name') return null;
  if (list[1]?.type !== 'equals') return null;
  return list[0].text;
}

/** Names a set of sources defines, split into callable functions and values. */
export interface DefinedNames {
  readonly functions: Set<string>;
  /** Parameter names, and the parameters of every definition. */
  readonly values: Set<string>;
}

/**
 * Collect every name a set of sources defines.
 *
 * Needed before parsing, because the parser has to decide whether `f(x)` is a
 * call or a product, and whether `ay` is one symbol or two. Detection uses token
 * shapes only — never the contents of an expression — so it cannot be misled by
 * how the mathematics is written.
 *
 * Collecting all names up front is what makes definition order irrelevant: `f`
 * may be used before it is defined, and a parameter may be written after the
 * expression that uses it.
 */
export function collectDefinedNames(sources: readonly string[]): DefinedNames {
  const functions = new Set<string>();
  const values = new Set<string>();

  for (const source of sources) {
    const header = detectDefinitionHeader(source);
    if (header !== null) {
      functions.add(header.name);
      for (const parameter of header.parameters) values.add(parameter);
      continue;
    }
    const parameter = detectParameterName(source);
    if (parameter !== null) values.add(parameter);
  }

  return { functions, values };
}

/** Parse one line of the workspace. */
export function parseStatement(
  source: string,
  options: ParseOptions = {},
): Result<Statement, ParseError> {
  const tokens = tokenize(source);
  if (!tokens.ok) return tokens;
  if (tokens.value.length === 0) {
    return {
      ok: false,
      issue: { kind: 'parse-error', message: 'The expression is empty.', span: span(0, 0) },
    };
  }
  return new Parser(tokens.value, source, options).parseStatement();
}

/** Parse source as a bare expression, for callers that have no statement form. */
export function parseExpression(
  source: string,
  options: ParseOptions = {},
): Result<Expr, ParseError> {
  const tokens = tokenize(source);
  if (!tokens.ok) return tokens;
  if (tokens.value.length === 0) {
    return {
      ok: false,
      issue: { kind: 'parse-error', message: 'The expression is empty.', span: span(0, 0) },
    };
  }
  const parser = new Parser(tokens.value, source, options);
  return parser.parseExpressionResult(0);
}
