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
                    ┌──────────────────────────────────────────┐
   source text ────► │  lexer  →  parser  →  canonical AST      │   mathcore
   "f(z)=sin(z)/     └──────────────────────────────────────────┘
     (z^2+1)"                          │
                                       ▼
                          ┌──────────────────────────┐
                          │  mathematical type system │
                          │  C → C, ComplexFunction   │
                          └──────────────────────────┘
                                       │
               ┌───────────────────────┼───────────────────────┐
               ▼                       ▼                       ▼
    ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
    │ numerical          │  │ symbolic           │  │ GPU                │
    │ evaluator          │  │ lowering → SymPy   │  │ lowering → GLSL    │
    │ (CPU, double)      │  │ (exact)            │  │ (WebGL2, 32-bit)   │
    └────────────────────┘  └────────────────────┘  └────────────────────┘
               │                       │                       │
               ▼                       ▼                       ▼
       readout, mapped        derivative, and          domain colouring,
       grid, scalar range     whatever the engine      scalar field modes
                              can answer
```

Everything left of the three arrows is in `packages/mathcore`, which has **no
runtime dependencies at all** and knows nothing about the DOM, React, the network
or storage. Everything to the right of them is an *engine*: a consumer of the tree,
not a second interpretation of the mathematics.

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

## 3. The parser

`packages/mathcore/src/lexer.ts`, `parser.ts`

Hand-written: a lexer, then a precedence-climbing parser. Not delegated to a
library, because `GOAL.md` section 8 forbids binding the core architecture to a
library's internal data structure, and because the tree *is* the architecture.

Precedence, low to high: `+ -`, `* /` and implicit multiplication, unary sign,
`^` (right associative). So `-z^2` is `-(z^2)` and `2z^2` is `2*(z^2)`.

### The two rules that needed deciding

**Implicit multiplication by juxtaposition.** `2z`, `2(z+1)`, `(z+1)(z-1)` all
multiply. The one ambiguous case is a name followed by `(`: `sin(z)` is a call,
`z(z+1)` is a product. This is resolved using the workspace's own function names,
collected up front by `collectDefinedNames()`, so definition order does not
matter. Parsing therefore depends on the document — a deliberate, documented
choice, since it is the only way to read `z(z+1)` the way a mathematician means
it without inventing notation.

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
4. **The GPU against the CPU** — verified in a real browser by reading pixels out
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
│       │   ├── expression/     ExpressionPanel, ExpressionRow, ParameterSlider
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
