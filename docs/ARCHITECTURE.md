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

### 7.2 The CPU paths

`MappedGridView`, `CartesianView`, `ComplexPlaneView` and `Cartesian3DView` all
evaluate on the CPU, through the same evaluator. For the first three this is not a
shortcut: a mapped grid needs a *polyline* — a curve followed through the map — and
a fragment shader cannot do that. Having both paths also means the CPU evaluator is
an independent check on the shader.

The **scalar range** for the magnitude, phase, real and imaginary modes is
measured on the CPU by sampling the visible region through the evaluator. That is
what keeps the colour a pixel gets and the number the readout prints coming from
one piece of mathematics.

The three two-dimensional views share their scaffolding, because a plane and a pair
of axes are one object seen from two directions:

| module | what it owns |
|---|---|
| `views/window2d.ts` | the pixel ↔ plane conversion, and its inverse, and framing a range |
| `render/axes2d.ts` | the grid, the axes, the tick marks and the numbers on them |
| `render/canvasText.ts` | drawing a structured number on a canvas, exponent and all |
| `render/canvasSurface.ts` | sizing a canvas from its CSS box, and the colours the canvases draw with |

`axes2d.ts` draws an axis only when it is in view, keeps the numbers on the frame
edge when it is not, and drops a label that would collide with the one before it —
decided from *measured* text widths. That last rule is a pure function
(`readableLabels`) so that it can be tested without a canvas, which jsdom does not
have.

**Points of interest.** `mathcore/src/pointsOfInterest.ts` finds where a curve crosses the
axis and where it turns round, and the cartesian view marks them and lets the
cursor take them. It is worth stating what it does *not* claim, because the tool it
is modelled on gets this wrong and says so: intercepts and extrema are
*approximations*, and a minimum at height 0.0001 looks exactly like a root until
you zoom in. So a crossing and a touch are different variants of the result type,
and the difference is on screen in the *shape of the mark* — a filled disc for a
crossing, an open ring for a turn — which leaves the label to say the one thing the
picture cannot, namely which numbers the point stands at. `(t − 2)² + 0.0001`
therefore reports a minimum at 0.0001 and never a root.

**It is deliberately not root analysis.** `t²` has a double zero at the origin, and
this reports the *turn* rather than a crossing, because a crossing is a claim about a
sign change and there is none. The module is named after what it marks — points of
interest *on the picture* — rather than after what a caller might hope it computes,
which is the difference between a name that guides and a name that invites the wrong
use. Where the zeros of a function are, and with what multiplicity, is a different
question needing different mathematics. The complex plane has one — `zerosAndPoles.ts`,
by the argument principle, which returns an integer order rather than an estimate, and
is called only there, on a function of a complex variable. A real signal's roots are
still not computed, and nothing should call this module as if they were.

Two numerical decisions carry that:

- **A sign change is not a crossing.** `tan` runs from `+∞` to `−∞` across `π/2`,
  which every sampler reads as a sign change and no function has a root there.
  Bisection tells them apart by asking which way the magnitude moved — at a root it
  shrinks towards zero, at a pole it grows towards infinity — which is scale-free,
  so no tolerance has to be guessed for a function measured in millions.
- **A turn wins the place.** Where an exact zero and a turn coincide — `t²` and
  `|t|` both land their minimum exactly on a sample — the true statement is that
  the curve *touched*, and calling that a crossing is the mistake being avoided.

**Zeros and poles.** `mathcore/src/zerosAndPoles.ts` answers where a complex
function vanishes and where it blows up, and it answers the *count* exactly, which
is what makes it worth having. The **argument principle** says that the change in
the argument of `f` around a closed curve, divided by a full turn, is the number of
zeros minus the number of poles inside — an integer. A small circle around a
candidate therefore returns `+k` for a zero of order `k` and `−k` for a pole of
order `k`, and that is a fact about the function rather than a threshold applied to
`|f|`. A search for "where is `|f|` small" cannot tell a double zero from a single
one; a contour can, and the test that says so asserts exactly 2.

The division of labour is the same one used above, and it is deliberate:

- **The kind and the order are facts**, from the winding number. They cannot be
  changed by moving the point.
- **The coordinates are a deduction.** A candidate comes from a local extremum of
  `|f|` on a search grid and is then walked downhill, so the position is approximate
  and is presented as a number like any other.

Candidates that are neither a zero nor a pole are discarded by a winding of *zero*
rather than by a tolerance: `sin(z)/z` at the origin has a removable singularity, and
nothing is reported there. A contour that runs through a singularity has no value on
it to take the argument of, and the answer is that there is no answer rather than a
number that happens to be nearby. And the search reports only what is inside the
region it was given — `tan` has a zero at every multiple of π, so a candidate near
the edge of a window walks straight out of it and must not be reported.

The complex plane draws them: a filled disc for a zero and an open ring for a pole,
because the two are opposites of each other in the mathematics and the drawing should
not have to be read twice to say so. Taking one with the cursor labels it `(0, 0)`, or
`(0, 0) ×2` where the order is above one: which of the two it is lives in the shape of
the mark and in the legend, and the order is the single exception because nothing else
in that picture carries it. The coordinate is rounded to the place the picture can
support before it is written, since the search *located* the point rather than solving
for it and `-1.06×10⁻¹⁶` is not a better answer than `0`.

The capability flipped to `implemented` in the same commit as the drawing, which is
the rule: a capability may not claim more than the interface shows.

This is the first thing here that Desmos does not do. It marks where a curve meets
the axis; it does not tell you that `z²` has a *double* zero there, and it has no
notion of a pole at all. And the contour integral behind it is one step from the
residue theorem, which is where the complex subsystem goes next.

### 7.3 The renderers

Two WebGL2 renderers, deliberately siblings rather than one generalised class:

| | `fieldRenderer.ts` | `surfaceRenderer.ts` |
|---|---|---|
| geometry | one full-screen quad | a sampled mesh, indexed |
| where the maths happens | in the fragment shader, per pixel | on the CPU, once per mesh |
| depth buffer | off | on |
| program | the AST, lowered | fixed, and takes no part of the AST |
| uniforms | floats and `vec2`s | matrices and vectors too |

Neither receives a shader it has to understand; the field renderer receives one the
core produced, and the surface renderer's is a constant. Sharing the
compile-and-link step (`shaderProgram.ts`) is the whole of what they have in
common, and merging them would mean a class with two vertex layouts and a flag that
changes how it draws.

The surface program is **not** a `GlslProgram`. That type means "the expression,
compiled", and it has exactly one producer; a 3D surface evaluates the AST sixteen
thousand times to build its geometry and then hands the GPU a fixed program that
places vertices and colours them. What the two *do* share is the colouring:
`scalarFieldColoringSource()` in the core is generated from `SCALAR_RAMP` and
interpolated into both shaders, so a surface of `f(x, y)` and a heatmap of
`f(x, y)` cannot come out different colours.

**The camera is data.** `render/matrix.ts` and `render/camera3d.ts` are pure
functions — orbit, dolly, pan, and the matrices they produce — with the four
conventions that a scene can be silently wrong about stated once at the top of
`matrix.ts`: right-handed, looking down `-z`, column-major, and a clip space of
`[-1, 1]` on all three axes. Each is pinned by a value worked out by hand rather
than by agreement with the implementation, because a sign error in any of them
produces a picture that still looks like a picture.

The 3D view draws on **two stacked canvases**: the surface and its scaffolding in
WebGL, and the numbers — tick labels, axis names, the cursor — on a transparent 2D
canvas above it. WebGL has no text and building one is a tar pit; keeping only the
text floating also means the occlusion between the surface and the grid underneath
it is still the depth buffer's business.

### 7.4 The number display layer

Every number a reader sees — the readout, a tick label, a legend range, a slider's
value — comes from `mathcore/src/display.ts`, via `app/src/display/`. It exists
because the policy had grown into four copies that disagreed about both where to
switch to exponential form (`1000` versus `100`) and how many digits to keep.

The core returns a **structured** number, not a string:

```ts
{ kind: 'scientific', mantissa: 2, exponent: 8 }
```

because the exponent of `2×10⁸` belongs in smaller type, and a string cannot say
which characters those are. `NumberText` renders it in the document with a real
`<sup>`; `canvasText.ts` renders it in a canvas by positioning the exponent by
hand. One function produces the plain text (`2×10^8`) for tooltips, ARIA labels
and tests.

One consequence is worth knowing rather than discovering: a superscript is a
*layout*, not a character, so the text content of the rendered element is
`2×108`. The value is carried on the element's label as well, and a test asserts
both halves so that the trade-off stays deliberate.

---

## 7.5 The expression editor

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

## 7.6 The keypad

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

Five design points worth naming:

- **`selectActiveExpression` is a pure function**, not a method reading mutable
  state. Views memoise against exactly `(workspace, focusedLineId, drawableKinds)`,
  so the shader is not re-lowered when the pointer moves.
- **View identities are assigned by the store** (`ViewBlueprint` → `ViewSpec`), so
  a view restored from storage, opened with a subsystem, or added from the toolbar
  cannot collide with another.
- **The cursor is a point of the *domain*.** Not a value, and not a triple: the
  shared state is the plane coordinate `(x, y)`, and every view derives what it
  shows from that. That is why a 3D surface's readout has a `z` without `z` being
  stored anywhere — it is `f(x, y)`, computed by the same evaluator the picture was
  drawn from.
- **The camera is a second piece of state, not a meaning given to the first.** The
  two-dimensional views share one `viewport`, a plane rectangle. An orbit position
  is not a plane rectangle, so pretending otherwise would be the kind of lie this
  project avoids elsewhere; `camera3d` is its own field, moved through the same
  store and therefore testable without a canvas.
- **What the picture marks and what the readout states are the same point.** The
  readout reads `hover ?? selection`, and the views mark on that same rule, so a mark
  cannot point at a place the readout is not describing — which is why a held point
  shows once the pointer has left the canvas and not while it is over it. Where a mark
  takes one of the analysed points, the coordinate is stated to the place the picture
  can support and is rounded *before* it reaches the shared cursor; rounding it in the
  label while publishing the raw value would be two statements of one point, and two
  statements that round differently are two different answers.

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

The subsystems differ only in which object kinds they accept and which capabilities
are implemented. Everything else is shared — **including which views they open
with**, which is not the subsystem's decision at all. `state/viewKinds.ts` derives
it from the expression's inferred signature, so `f(x, y) = x² − y²` opens on a
surface wherever it is typed.

4. **The view taxonomy is a statement about mathematics, not about renderers.**
   `ViewKind` names the *space and the representation*: `complex-plane` is the
   plane itself, and `domain-coloring` is one way of drawing a map on that plane.
   Conflating the two — one kind called `field` doing every job — is the confusion
   the taxonomy exists to undo, because it made the plane and a picture of a
   function on the plane the same choice. A single table maps a signature to the
   views that suit it, most natural first; a kind with no renderer is `planned`,
   and a planned kind is never offered and never chosen as a default, because a
   button that opens a blank frame is worse than no button.

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
| Writing a number | plain decimals in `[1e-4, 1e6)`, `m×10^e` outside it, and one policy for every surface |
| Axis ticks | 1-2-5 steps, each tick computed as `index × step`, a quarter subdivision for a step of `2×10ⁿ` |
| Surface normals | outward, by central differences over the sampled grid; a singularity is a hole, not a bridge |
| 3D camera | right-handed, looking down `-z`, column-major, clip space `[-1, 1]` on all three axes |
| The world's up axis | `+z` — `x` and `y` span the plane and `z` is the height, because that is how a graph is read |
| Editor interchange format | LaTeX, parsed by `latex.ts` into the same canonical AST the plain syntax produces |
| Unfinished input | reported as `incomplete`, and shown as nothing rather than as an error |

There is one convention per row and one place it is written down.

---

## 11. What is verified, and how

Four levels, all of them runnable:

1. **`pnpm test`** — 663 tests. Parser, AST, type inference, complex arithmetic,
   numerical evaluation, workspace behaviour, GLSL lowering, SymPy lowering,
   colouring, surface sampling, how a number is written, where the axis ticks go,
   and the mathematical reference identities. The identity suite
   (`identities.test.ts`) evaluates source text and compares against mathematics:
   `d/dz exp(z) = exp(z)` by central differences, `∮ 1/z dz = 2πi` around the unit
   circle by the trapezoidal rule, Cauchy's theorem for entire functions,
   Cauchy–Riemann residuals positive for `z²` and large for `conj(z)`.
2. **`pnpm lint`, `pnpm typecheck`, `pnpm build`** — clean.
3. **The symbolic engine** — `services/symbolic/server.py`, exercised against a
   running instance: `d/dz exp(z) = exp(z)` comes back exact.
4. **The number display layer** — the policy is asserted against the three
   formatters it replaced, kept verbatim in `numbers.test.ts` as the reference, so
   that every change to what is on screen is stated in one place rather than
   discovered in a legend. The rule that decides which axis labels fit is a pure
   function tested without a canvas — which is the only way it can be tested at all,
   because jsdom has no 2D context.
5. **Persistence** — tested as a table: every historical shape of stored record,
   including one that is partly unreadable, the old view vocabulary translated rather
   than discarded, and the wiring that decides whether a layout which did not come
   back should be replaced by an inferred one.
6. **The editor and the keypad** — driven in a real browser, because a TeX engine
   cannot be exercised in jsdom. Verified there: `f(z)=sin(z)/(z^2+1)` typesets as a
   two-dimensional quotient; the fraction key builds `rac{\placeholder{}}{\placeholder{}}`
   with the caret in the numerator; `ArrowDown` inside a fraction moves to the
   denominator with **no** `move-out`, while `ArrowDown` at the bottom emits
   `move-out{downward}` and the panel opens the next row; `Enter` creates a row and the
   caret follows it, so typing lands in the new formula; the three subsystem URLs share
   one input system with per-subsystem function keys; and the editor's own menu and
   virtual-keyboard buttons are absent.
7. **The GPU against the CPU** — verified in a real browser by reading pixels out
   of the framebuffer and checking them against the convention. For `f(z) = z²`:

   | Point | Expected | Measured |
   |---|---|---|
   | `z = 0` | a zero, so black | dark, luminance ≈ 0.17 |
   | `z ≈ 1`, `w = 1`, `arg 0` | hue 0.5, cyan | `g ≈ b > r` |
   | `z ≈ i`, `w = -1`, `arg π` | hue 1, red | `r > b > g` |
   | `z ≈ 1+0.9i`, `arg w ≈ 1.47` | hue 0.73, blue | `b > r > g`, ratio 0.55 vs 0.52 predicted |

   The subtle predictions — which of `g` and `b` is larger — are the ones that
   make this a real check rather than a smoke test.

   For the 3D surface, three checks that no CPU test can make:

   - **The depth buffer is doing work.** With the camera deliberately left
     unchanged, disabling `DEPTH_TEST` and forcing a single redraw changes the
     framebuffer — a hash over the pixels goes from `1235388183` to `1830031926`.
     A scene that merely *had* a depth buffer, and did not depend on it, would
     produce the same image either way.
   - **Picking is exact.** Hovering a pixel reports the domain point
     `-1.9875 - 0.075i`, and the readout's value is `3.94453`, which is `x² − y²` at
     that point to every digit shown. The surface therefore participates in the
     shared cursor, and the cursor is still a domain point: `z` is computed, not
     stored.
   - **The context is configured as intended** — `DEPTH_TEST` on, `depthFunc`
     `LEQUAL`, `CULL_FACE` off so that looking at a surface from underneath shows it
     rather than hiding it, and `getError()` zero after a frame.

   Two bugs were found by these checks and by nothing else in the suite, which is
   the argument for making a browser check a gate rather than a follow-up: the
   vertical axis came out with a single number on it, because the label-thinning
   pass assumed positions ascend in iteration order — true for a horizontal axis,
   and backwards for a vertical one; and the projection's width-over-height ratio
   was passed inverted, which a square test canvas cannot distinguish.

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
│   │   │   ast.ts  lexer.ts  parser.ts  latex.ts  types.ts  infer.ts
│   │   │   evaluator.ts  format.ts  display.ts  ticks.ts  workspace.ts
│   │   │   pointsOfInterest.ts  zerosAndPoles.ts
│   │   │   coloring.ts  surface.ts  glsl.ts  surfaceGlsl.ts  sympy.ts  cas.ts
│   │   └── test/               443 tests
│   └── app/                    the interface. React, Vite.
│       ├── src/
│       │   ├── subsystems.ts   the three subsystems, one description
│       │   ├── shell/          AppShell
│       │   ├── routes/         HomePage, SubsystemPage
│       │   ├── state/          store, workspaceStore, persistence, viewKinds,
│       │   │                   StoreProvider
│       │   ├── expression/     MathExpressionField, ExpressionRow, ExpressionPanel
│       │   │                   MathKeypad, ParameterSlider, mathInputAdapter,
│       │   │                   keypad/{types,common,complex,transforms,calculus}
│       │   ├── display/        NumberText, numbers,   the number display layer
│       │   ├── views/          ViewCanvas, CartesianView, Cartesian3DView,
│       │   │                   ComplexPlaneView, FieldView, MappedGridView,
│       │   │                   evaluation, window2d, cameraKeys, useResizeVersion
│       │   ├── render/         matrix, camera3d, shaderProgram, fieldRenderer,
│       │   │                   surfaceRenderer, axes2d, canvasText, canvasSurface
│       │   ├── readout/        ReadoutBar
│       │   ├── symbolic/       the HTTP adapter and its panel
│       │   ├── analysis/       CapabilityList
│       │   └── styles/         tokens.css, app.css
│       └── test/               220 tests
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
| Zeros, poles and their orders | A new module in `mathcore` (numerical detection through the evaluator), drawn on the existing `complex-plane` view. The type system and AST do not change. |
| Contour integrals and residues | A `ComplexPath` already has a signature (`R → C`) and `complex-plane` already draws one. Add path sampling and the accumulated integral to `mathcore`. The evaluator is reused unchanged. |
| Cauchy–Riemann residuals | Already expressible: `re`/`im` of a complex function are scalar fields of `x` and `y`. A view of `u_x - v_y` needs no new mathematics, only a way to express the partial derivative. |
| Fourier and Laplace | New `mathcore` modules with their conventions added to `conventions.ts`, plus a transform-domain view. The `s-plane` is `complex-plane` with `s` bound as the complex variable, which is what the view already does. |
| Gradients and divergence | `surface.ts` already samples a scalar field into a mesh, so a gradient can be shown as arrows over the existing surface or heatmap. Vector fields are the one case the current rendering design does not cover: a `vec2` per point is not a scalar, so `scalarRamp` does not apply to it. |
| Contours and level sets | A two-dimensional representation of `R² → R`, alongside the surface and the heatmap, using the same `axisTicks` ladder the grid already uses. |

The recurring pattern: a new mathematical concept becomes a new module in
`mathcore` that consumes the existing AST, and a view in `app` that consumes the
existing store. Neither the parser nor the type system needs to be revisited,
which is the property the architecture was built to have.
