# Architecture

This document describes how MathVisualization is actually built. It is deliberately
concrete: every section names the files it is talking about, and every claim it
makes can be checked against them.

The governing idea is the one stated in `GOAL.md` section 6.1 and repeated in
section 30:

> Do not create separate mathematical truths for separate renderers or subsystems.
> One mathematical core should drive symbolic analysis, numerical evaluation, and
> visualization.

---

## 1. The pipeline

```
  ┌── front ends (surface syntaxes) ──┐
  │                                   │
  │  plain text        LaTeX          │
  │  "sin(z)/(z^2+1)"  "\frac{\sin(z)}{z^2+1}"
  │       │                 │         │
  │  lexer+parser     latex.ts        │
  │       │                 │         │
  └───────┴────────┬────────┴─────────┘
                   ▼
        ┌──────────────────────────┐
        │  canonical AST           │   mathcore — one tree, no runtime dependencies
        └──────────────────────────┘
                   │
                   ▼
        ┌──────────────────────────┐
        │  mathematical type system │
        │  C → C, ComplexFunction   │
        └──────────────────────────┘
                   │
     ┌─────────────┼─────────────┬──────────────────┐
     ▼             ▼             ▼                  ▼
┌──────────┐ ┌──────────┐ ┌──────────┐   ┌──────────────────────┐
│ numerical│ │ symbolic │ │ GPU      │   │ AST → LaTeX          │
│ evaluator│ │ → SymPy  │ │ → GLSL   │   │ (printing, for the   │
│ (double) │ │ (exact)  │ │ (WebGL2) │   │  editor to display)  │
└──────────┘ └──────────┘ └──────────┘   └──────────────────────┘
     │             │            │                    │
     ▼             ▼            ▼                    ▼
 readout, mapped  derivative   domain colouring   the structured
 grid, ranges     and more    scalar field modes  math field
```

Everything left of the type system is in `packages/mathcore`, which has **no runtime
dependencies at all** and knows nothing about the DOM, React, the network or storage.
Everything to the right is an *engine*: a consumer of the tree, not a second
interpretation of the mathematics.

Two front ends and four back ends, one tree. That is the whole architecture, and the
sections below are the details of each arrow.

---

## 2. The canonical AST

`packages/mathcore/src/ast.ts`

One tree for the whole project. It is not a parse tree: grouping parentheses leave
no node behind, because they only shape the tree. The node kinds are:

| Node | Represents |
|---|---|
| `NumberLiteralNode` | a numeric literal, held as an **exact rational** |
| `VariableNode` | a name whose meaning depends on context |
| `ConstantNode` | `i`, `pi`, `e`, `tau` — fixed meaning, unlike a variable |
| `UnaryNode` | `neg`, `pos` |
| `BinaryNode` | `add`, `sub`, `mul`, `div`, `pow` |
| `CallNode` | a builtin or user function applied to arguments |
| `TupleNode` | a parenthesised list, e.g. `(-y, x)` |

Two decisions in this file are load-bearing.

**Literals are exact.** `NumberLiteralNode.value` is a `Rational`
(`rational.ts`), not a `number`. `0.1` is `1/10`; `1.25e-3` is `1/800`. The
reason is in `GOAL.md` section 13: the product has to distinguish an exact result
from an approximation, and that is impossible if the parser has already destroyed
the exactness. The evaluator converts to double precision when it *evaluates*;
the symbolic lowering sends the exact rational to the engine.

**Constants are a distinct node kind from variables.** The space of a variable
depends on a naming convention; the space of `i` does not. Merging them would make
type inference ambiguous for no benefit.

Statements (`FunctionDefinition`, `ParameterAssignment`, `ExpressionStatement`)
sit alongside expressions. A definition and a bare expression are the same
mathematics — a function — differing only in whether the user wrote the
parameters. That is why `z^2` on its own is understood as a complex function.

---

## 3. The parsers

`packages/mathcore/src/lexer.ts`, `parser.ts`, `latex.ts`

There are two front ends and one tree. **Plain text** is what the examples, the tests
and the documentation are written in, because it is the readable form; **LaTeX** is
what the structured editor reads and writes, because a math editor's interchange
format is LaTeX and inventing another would be inventing work. Both produce the
canonical AST, so the two can never disagree about the mathematics.

Both are hand-written. Not delegated to a library, because `GOAL.md` section 8
forbids binding the core architecture to a library's internal data structure, and
because the tree *is* the architecture.

Precedence, low to high, in both syntaxes: `+ -`, `* /` and implicit multiplication,
unary sign, `^` (right associative). So `-z^2` is `-(z^2)` and `2z^2` is `2*(z^2)`.

### LaTeX, and why parsing it is not a formality

LaTeX has **no operator precedence**. `a+b\cdot c` is three atoms in a row, and it
only *reads* as `a + b·c` by convention. A tree needs an answer, so `latex.ts`
recovers the conventional reading. That is what makes

```
\frac{\sin(z)}{z^{2}+1}   ⟹   sin(z) / (z^2 + 1)
```

rather than a denominator that swallows the addition — the failure mode is tested
explicitly, because it is the one that would quietly change the mathematics.

Three further decisions in that module:

- **A subscript belongs to the name.** `a_1` is a different symbol from `a`, not an
  operation applied to one. A compound subscript is braced in the name, so
  `z_{k+1}` cannot be confused with the sum `z_k + 1`.
- **Unfinished is not wrong.** An empty fraction or a missing closing brace is a
  normal state while someone is typing, and is reported as `incomplete` rather than
  as an error. Without that flag the interface would flag a mistake on every
  keystroke that opens a structure.
- **Trailing input is an error.** `z\int` must not parse as `z`. Without the check it
  would, silently discarding the rest of the line.

### The two rules that needed deciding, in both syntaxes

**Implicit multiplication by juxtaposition.** `2z`, `2(z+1)`, `(z+1)(z-1)` all
multiply. The one ambiguous case is a name followed by `(`: `sin(z)` is a call,
`z(z+1)` is a product. This is resolved using the workspace's own function names,
collected up front by `collectNamesAcrossSyntaxes()`, so definition order does not
matter. Parsing therefore depends on the document — a deliberate, documented
choice, since it is the only way to read `z(z+1)` the way a mathematician means
it without inventing notation.

**A bare `i` is the imaginary unit** in both syntaxes, for the same reason: it is
what the letter means in this subject.

**Juxtaposed letters multiply.** The lexer reads a maximal run of letters as one
token, so `it` and `ay` arrive as single names. If such a run is *not* a name the
document defines, the parser splits it into single letters and multiplies them.
This is what makes `GOAL.md`'s own examples mean what they look like:

```text
gamma(t) = 2e^(it)     ⟹  2 * e^(i * t)
f(x,y) = x^2 + a y^2   ⟹  x^2 + a * y^2
```

while `pi`, `sin`, a parameter you defined (`a = 2`) and a function you defined
all stay single symbols, because they *are* known names. This is a naming
convention with a rule attached, not a guess: the set of known names comes from
the document and the builtin registry.

---

## 4. The mathematical type system

`packages/mathcore/src/types.ts`, `infer.ts`

The ground truth is a **signature**: a domain space and a codomain space. Spaces
are deliberately coarse — `R`, `R²`, `R³`, `C` — because those are the
distinctions that change what mathematics is available.

Classification into `ComplexFunction`, `ScalarField`, `VectorField`,
`ComplexPath`, `ParametricCurve` and the rest is a *documented reading* of the
signature. Where one signature is genuinely ambiguous — `R → C` is a complex path
to the complex-analysis subsystem and a complex-valued signal to the transforms
subsystem — the signature is the shared truth and the reading differs. The
subsystems never disagree about the signature.

Inference is a real pass over the tree, and it **widens only when the mathematics
forces it**:

| Expression | Type | Why |
|---|---|---|
| `z^2` | `C → C` | `z` is complex by the naming convention |
| `f(x) = x^2` | `R → R` | integer exponent, no widening needed |
| `f(x) = x^0.5` | `R → C` | `(-1)^0.5 = i`; claiming `R` would be wrong |
| `f(x) = log(x)` | `R → C` | the principal log of a negative real is imaginary |
| `f(x) = sqrt(4)` | `R → R` | the argument is provably non-negative |
| `f(x,y) = x^2-y^2` | `R² → R` | a scalar field |
| `gamma(t) = 2e^(it)` | `R → C` | a complex path |
| `F(x,y) = (-y, x)` | `R² → R²` | a vector field |

The conservative cases are stated rather than hidden. `log(x)` typed `R → C` is
correct for half the domain, and a caller that needs a narrower type has to prove
non-negativity to get one.

The only place a variable's space comes from its *name* is the convention table in
`conventions.ts`, applied when a definition's parameter list becomes a domain. The
codomain is always computed.

---

## 5. The numerical evaluator

`packages/mathcore/src/evaluator.ts`, `complex.ts`

Double precision, complex from the start. Realness is preserved exactly: for a
real input, `csin`, `cexp`, `clog` and the rest return an imaginary part of
exactly zero, so a real function never drifts into looking complex.

It returns a **reason**, not `NaN`, when there is no value:

```ts
evaluateScalar(parse('1/(z^2-1)'), { z: 1 })
// ⟹ { ok: false, issue: {
//      kind: 'division-by-zero',
//      message: '"z ^ 2 - 1" is zero here, so the expression is not defined at this point.' } }
```

`GOAL.md` section 14 asks for mathematical errors presented as mathematical
information. That is only possible if the conditions that produce `NaN` are
checked *before* the arithmetic runs, which is what the evaluator does. `NaN` is
still used inside `complex.ts`; it never escapes the evaluator.

---

## 6. The symbolic adapter

`packages/mathcore/src/cas.ts` (contract), `sympy.ts` (lowering), and
`services/symbolic/server.py` (the engine)

The contract is a plain interface. `SymbolicOutcome` has three cases and they are
not conflated:

- `unavailable` — no engine is reachable. **Not an error**: the application is
  fully usable without it, so absence is a first-class answer.
- `computed` — the result is marked `exact: true`, which is the flag the interface
  uses to distinguish it from a numerical readout.
- `failed` — the engine ran and could not answer, with a message.

The lowering to SymPy syntax keeps literals exact: `0.1` becomes
`Rational(1, 10)`, and literal arithmetic is folded exactly (`1/3` becomes
`Rational(1, 3)`). That fold is not cosmetic. Emitting `(1 / 3)` would be Python's
*float* division, and the exactness the rationals exist to preserve would be lost
at the engine boundary.

The service is standard library plus SymPy — no web framework — and it does **not**
`exec` client input. Symbols are constructed from the request's symbol list and
expressions are parsed against an explicit allowlist of names, so the only thing a
request can do is construct and differentiate an expression.

The engine boundary is also where branch conventions are stated back to the user.
`d/dz log(z)` returns `1/z` **and** the note that the principal branch is in use.

---

## 7. Rendering

### 7.1 The GPU path

`packages/mathcore/src/glsl.ts` lowers the same canonical AST to a WebGL2
fragment shader. This is the concrete proof that the AST is a real intermediate
representation rather than a frontend convenience: one tree, executed by two
independent engines.

GLSL has no complex type, so complex values are `vec2` pairs and every elementary
function is reimplemented in a shader prelude. Those implementations reproduce
`complex.ts` operation for operation, including the branch conventions:

| `complex.ts` | shader prelude |
|---|---|
| `cadd csub cmul cdiv cneg cconj` | same names |
| `cabs carg clog csqrt cpow cintpow` | same names, same branches |
| `cexp csin ccos ctan csinh ccosh ctanh` | same names |
| `domainColor` (`coloring.ts`) | `colorForValue` |
| `SCALAR_RAMP` (`coloring.ts`) | `RAMP_COLOR` / `RAMP_POSITION`, **generated from it** |

The ramp table is generated from the TypeScript source rather than written out
again, so the two cannot drift.

The differences that remain are the ones 32-bit floating point forces. Agreement
is verified in a browser, not assumed — see section 11.

**Parameters become uniforms.** Dragging a slider updates a uniform and does not
recompile the shader. Only an expression change produces a new program.

### 7.2 The CPU path

`MappedGridView` and `PlotView` run on the CPU, through the same evaluator. This
is not a shortcut: a mapped grid needs a *polyline* — a curve followed through the
map — and a fragment shader cannot do that. Having both paths also means the CPU
evaluator is an independent check on the shader.

The **scalar range** for the magnitude, phase, real and imaginary modes is
measured on the CPU by sampling the visible region through the evaluator. That is
what keeps the colour a pixel gets and the number the readout prints coming from
one piece of mathematics.

### 7.3 The renderer

`packages/app/src/render/fieldRenderer.ts` owns a WebGL2 context, a compiled
program and the uniform plumbing, and nothing else. It receives a shader the core
produced and values to bind; it does not know what the expression means.

---

## 7.4 The expression editor

`packages/app/src/expression/`

### Why MathLive, and why not MathQuill

MathQuill was the first choice. Desmos's editing behaviour is the behaviour being
reproduced, and MathQuill came out of Desmos. It was rejected on evidence:

| | MathQuill | MathLive |
|---|---|---|
| published version | `0.10.1-a` — a prerelease | `0.110.0` |
| last published | 2023, and 2016 before that | months ago, actively |
| runtime dependency | `jquery ^1.12.3` | none in the editor itself |
| TypeScript types | **none**; `@types/mathquill` does not exist (404) | ships its own |
| React 19 | manipulates the DOM directly, against the reconciler | a web component, framework-agnostic |
| accessibility | no meaningful screen-reader support | designed with it: ARIA and spoken mathematics |

A hard jQuery 1.x dependency, no types at all, and unmaintained prerelease releases
are not acceptable for the input layer of a project meant to last. The editing
semantics that were wanted are not lost by the substitution: MathLive navigates
structures with the arrow keys, emits and accepts LaTeX, and reports a **cancellable
`move-out` event carrying a direction** when the caret runs out of structure. That
last one is what makes structural-then-row navigation fall out for free:

```
ArrowDown inside a fraction   → moves to the denominator        (the editor's job)
ArrowDown at the bottom        → move-out{direction:'downward'}  → the next row
```

The application handles `move-out`; it never has to guess where the caret should go.

### What MathLive is *not* used for

It carries its own computer algebra system as a dependency. **That system is never
called.** MathLive here is a text-entry widget that reads and writes LaTeX. The
canonical AST remains the only mathematical truth, and `latex.ts` in the core is what
turns LaTeX into it. A second CAS evaluating anything would be exactly the dual truth
this architecture exists to prevent. The production build contains no reference to it;
the development build of MathLive imports it from a content delivery network, which is
one more reason the editor is the only module that touches LaTeX and the only module
that would need changing if it were ever replaced.

### The adapter, and the interface it holds to

`mathInputAdapter.ts` defines `MathFieldHandle` — insert, backspace, focus, read — and
`MathExpressionField.tsx` implements it over the element. Nothing else in the
application touches the editor. That is what makes the editor replaceable, and it is
also what makes the integration testable: the tests drive a double that behaves like an
editable field with a caret, so the *integration* is tested without a TeX engine.

Three details in that adapter are load-bearing:

- **The value is written only when it differs.** The element owns its editing state; a
  blind write per render would reset the caret on every keystroke.
- **Keypad buttons cancel their own pointer-down.** Without it, pressing a key moves
  focus out of the formula and the caret is lost. This is asserted directly.
- **The caret follows the focused row.** Enter, the keypad's return key and an arrow
  that runs out of structure all move the *store's* focus; the caret has to follow or
  the next keystroke lands in the previous formula.

### The removed chrome

The editor's own menu and virtual-keyboard buttons are hidden through the parts it
exposes, because this application supplies the keypad and the editor's menu is empty.
Two icon buttons inside every row would be precisely the chrome this round set out to
remove.

## 7.5 The keypad

`packages/app/src/expression/keypad/`

One keypad, three configurations. The digits and the letters are the same everywhere;
only the function page differs, and it is *composed* from the shared groups plus the
subsystem's own. There is no `ComplexKeypad` component — only a configuration, which
is what stops the three subsystems growing three input systems.

Every key carries **LaTeX**, not a command name or a callback. It goes straight into
the field, which is the same representation the field reads and writes, so the keypad
cannot drift into a second vocabulary. A key whose LaTeX the canonical AST cannot read
is a key that should not exist: the calculus and transforms operators that the language
does not yet have are rendered **inert and labelled**, with the reason in the tooltip,
rather than inserting something the parser would reject. Two tests enforce this — one
checks that every command in every insertion is one the parser knows, the other that
every insertion is valid in some natural context.

Keys for mathematics the language *does* have are live: the fraction key builds a real
fraction with the caret in the numerator, and pressing it with a selection wraps the
selection rather than discarding it (`#@` is MathLive's placeholder for the selection,
`#?` for an empty box).

## 8. Linked view state

`packages/app/src/state/workspaceStore.ts`

Linked views are implemented as **data, not wiring**. There is one `hover` and one
`selection` in the store's state, and every view reads them. A view cannot have a
private cursor because there is nowhere to put one. That is the entire mechanism.

The store is hand-written (`store.ts`, ~60 lines) rather than taken from a library,
for a specific reason: `GOAL.md` section 24 asks for tests of "expression update,
parameter update, linked cursor, linked selection, multi-view synchronization",
and keeping this state in plain TypeScript outside React means those tests need no
DOM and no rendering. `packages/app/test/workspaceStore.test.ts` is that test.

Two design points worth naming:

- **`selectActiveExpression` is a pure function**, not a method reading mutable
  state. Views memoise against exactly `(workspace, focusedLineId, drawableKinds)`,
  so the shader is not re-lowered when the pointer moves.
- **View identities are assigned by the store** (`ViewBlueprint` → `ViewSpec`), so
  a view restored from storage, opened with a subsystem, or added from the toolbar
  cannot collide with another.

---

## 9. Subsystem boundaries

`packages/app/src/subsystems.ts` is the single description of the three
subsystems: their routes, their examples, the object kinds they can draw, and
their capabilities with an honest `implemented` / `planned` status.

Three structural rules keep them peers rather than three applications:

1. **One route component.** `/complex`, `/transforms` and `/calculus` all render
   `SubsystemPage`, parameterised by the subsystem definition.
2. **One shell, one panel, one canvas.** There is one `AppShell`, one
   `ExpressionPanel`, one `ViewCanvas`. A second copy is how three subsystems
   quietly become three apps.
3. **One capability list, from one source.** The homepage entries, the header and
   the capability panel are built by iterating the same array, so the three
   cannot drift into a main feature and two secondary ones.

The subsystems differ only in: which object kinds they draw, which views they open
with, and which capabilities are implemented. Everything else is shared.

---

## 10. Mathematical conventions

`packages/mathcore/src/conventions.ts` is the single table, and `CONVENTIONS.md`
renders it for a reader. Every entry is consumed by the evaluator, the type
system, the lowering and the test suite, so documentation cannot drift from
behaviour. The most consequential:

| Convention | Choice |
|---|---|
| Principal argument | `(-π, π]` — the negative real axis is the **upper** edge |
| Complex logarithm | `Log z = ln|z| + i·Arg z`, cut on the negative real axis |
| Complex power | `exp(w Log z)`; exact repeated multiplication for integer `w`; `0^0 = 1` |
| Square root | principal: `sqrt(-4) = 2i`, never `-2i` |
| Fourier transform | angular frequency, `1/(2π)` on the *inverse* only |
| Laplace transform | one-sided, lower limit `0⁻`, ROC reported separately |
| Domain colouring | hue from `arg`, brightness from `log₂|w|` per octave |
| Scalar ramp | the viridis palette, monotone in lightness |
| Undefined values | reported as a mathematical issue, never as `NaN` reaching the UI |
| Editor interchange format | LaTeX, parsed by `latex.ts` into the same canonical AST the plain syntax produces |
| Unfinished input | reported as `incomplete`, and shown as nothing rather than as an error |

There is one convention per row and one place it is written down.

---

## 11. What is verified, and how

Four levels, all of them runnable:

1. **`pnpm test`** — 339 tests. Parser, AST, type inference, complex arithmetic,
   numerical evaluation, workspace behaviour, GLSL lowering, SymPy lowering,
   colouring, and the mathematical reference identities. The identity suite
   (`identities.test.ts`) evaluates source text and compares against mathematics:
   `d/dz exp(z) = exp(z)` by central differences, `∮ 1/z dz = 2πi` around the unit
   circle by the trapezoidal rule, Cauchy's theorem for entire functions,
   Cauchy–Riemann residuals positive for `z²` and large for `conj(z)`.
2. **`pnpm lint`, `pnpm typecheck`, `pnpm build`** — clean.
3. **The symbolic engine** — `services/symbolic/server.py`, exercised against a
   running instance: `d/dz exp(z) = exp(z)` comes back exact.
4. **The editor and the keypad** — driven in a real browser, because a TeX engine
   cannot be exercised in jsdom. Verified there: `f(z)=sin(z)/(z^2+1)` typesets as a
   two-dimensional quotient; the fraction key builds `rac{\placeholder{}}{\placeholder{}}`
   with the caret in the numerator; `ArrowDown` inside a fraction moves to the
   denominator with **no** `move-out`, while `ArrowDown` at the bottom emits
   `move-out{downward}` and the panel opens the next row; `Enter` creates a row and the
   caret follows it, so typing lands in the new formula; the three subsystem URLs share
   one input system with per-subsystem function keys; and the editor's own menu and
   virtual-keyboard buttons are absent.
5. **The GPU against the CPU** — verified in a real browser by reading pixels out
   of the framebuffer and checking them against the convention. For `f(z) = z²`:

   | Point | Expected | Measured |
   |---|---|---|
   | `z = 0` | a zero, so black | dark, luminance ≈ 0.17 |
   | `z ≈ 1`, `w = 1`, `arg 0` | hue 0.5, cyan | `g ≈ b > r` |
   | `z ≈ i`, `w = -1`, `arg π` | hue 1, red | `r > b > g` |
   | `z ≈ 1+0.9i`, `arg w ≈ 1.47` | hue 0.73, blue | `b > r > g`, ratio 0.55 vs 0.52 predicted |

   The subtle predictions — which of `g` and `b` is larger — are the ones that
   make this a real check rather than a smoke test.

---

## 12. Repository layout

```
MathVisualization/
├── GOAL.md                     product goals and boundaries
├── docs/
│   ├── ARCHITECTURE.md         this file
│   └── CONVENTIONS.md          the mathematical conventions, for a reader
├── packages/
│   ├── mathcore/               the shared mathematical core. No runtime deps.
│   │   ├── src/
│   │   │   errors.ts  rational.ts  complex.ts  conventions.ts  builtins.ts
│   │   │   ast.ts  lexer.ts  parser.ts  types.ts  infer.ts
│   │   │   evaluator.ts  format.ts  workspace.ts
│   │   │   coloring.ts  glsl.ts  sympy.ts  cas.ts  index.ts
│   │   └── test/               280 tests
│   └── app/                    the interface. React, Vite.
│       ├── src/
│       │   ├── subsystems.ts   the three subsystems, one description
│       │   ├── shell/          AppShell
│       │   ├── routes/         HomePage, SubsystemPage
│       │   ├── state/          store, workspaceStore, persistence, viewKinds
│       │   ├── expression/     MathExpressionField, ExpressionRow, ExpressionPanel
│       │   │                   MathKeypad, mathInputAdapter,
│       │   │                   keypad/{types,common,complex,transforms,calculus}
│       │   ├── views/          FieldView, MappedGridView, PlotView, ViewCanvas
│       │   ├── render/         fieldRenderer (WebGL2)
│       │   ├── readout/        ReadoutBar
│       │   ├── symbolic/       the HTTP adapter and its panel
│       │   ├── analysis/       CapabilityList
│       │   └── styles/         tokens.css, app.css
│       └── test/               59 tests
└── services/
    └── symbolic/               SymPy behind an adapter, stdlib only
```

The `mathcore → app` arrow is the only dependency between packages, and it points
one way.

---

## 13. Where the next feature goes

`GOAL.md` section 28 gives the order of architectural importance. Applying it to
what exists now:

| Next feature | Where it goes |
|---|---|
| Zeros, poles and their orders | A new module in `mathcore` (numerical detection through the evaluator), a new view in `app`. The type system and AST do not change. |
| Contour integrals and residues | A `ComplexPath` already has a signature (`R → C`). Add path sampling to `mathcore` and a view that draws the accumulated integral. The evaluator is reused unchanged. |
| Cauchy–Riemann residuals | Already expressible: `re`/`im` of a complex function are scalar fields of `x` and `y`. A scalar-field view of `u_x - v_y` needs no new mathematics, only a way to express the partial derivative. |
| Fourier and Laplace | New `mathcore` modules with their conventions added to `conventions.ts`, plus a transform-domain view. The `s-plane` view is the existing field view with `s` bound as the complex variable. |
| Contours, gradients, divergence | The existing field view already draws `R² → R`. Gradients and vector fields need a vector-valued rendering path, which is the one place the current shader design needs extending. |

The recurring pattern: a new mathematical concept becomes a new module in
`mathcore` that consumes the existing AST, and a view in `app` that consumes the
existing store. Neither the parser nor the type system needs to be revisited,
which is the property the architecture was built to have.
