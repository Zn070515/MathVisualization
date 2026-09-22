# MathVisualization

An expression-first environment for exploring complex analysis, integral
transforms and multivariable calculus. You write mathematics; the system works out
what kind of object it is and offers the views and analyses that apply to it.

```
/
├── /complex       Complex Analysis
├── /transforms    Integral Transforms
└── /calculus      Multivariable Calculus
```

The three are peers. They share one mathematical core: one parser, one AST, one
type system, one numerical evaluator, one symbolic adapter. `GOAL.md` is the
product document and the authority on what this project is and is not; this file
covers how to run it.

---

## Requirements

| | |
|---|---|
| Node.js | 20 or newer |
| pnpm | 9 or newer (`corepack enable pnpm`, or `npm i -g pnpm`) |
| Python | 3.12 or newer — **only** for the optional symbolic engine |

Nothing else. No database, no account system, no backend service is required to
use the application.

---

## Running it

```bash
pnpm install
pnpm dev
```

Then open <http://127.0.0.1:5173>. You will land on the homepage.

### The optional symbolic engine

The one feature that needs a second process is the symbolic panel (the derivative
of the active expression, in closed form). Everything else — every picture, every
readout, every parameter slider — works without it, and the interface says plainly
when the engine is absent rather than guessing.

To start it:

```bash
cd services/symbolic
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt    # Windows
# .venv/bin/python -m pip install -r requirements.txt       # macOS / Linux
.venv/Scripts/python server.py
```

It listens on `127.0.0.1:8000`. The application probes it and reports the result;
point the app elsewhere with `VITE_SYMBOLIC_URL` if you move it.

Using `uv` instead of `venv` also works and is faster:

```bash
cd services/symbolic
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
```

---

## Verifying it

```bash
pnpm lint          # ESLint, zero warnings
pnpm typecheck     # tsc, both packages
pnpm test          # 424 tests
pnpm build         # production build of the application
```

`pnpm verify` runs all four in order.

The tests are not smoke tests. Among them:

- parser precedence, implicit multiplication, juxtaposed letters, statement forms;
- exact rational literals, including `0.1` staying `1/10`;
- complex arithmetic and every branch convention (`sqrt(-4) = 2i`, `Arg(-1) = π`,
  `0^0 = 1`, `log` on the negative real axis);
- type inference, including the cases where it deliberately widens
  (`x^0.5 : R → C`) and the cases where it does not (`x^2 : R → R`);
- the workspace: expression updates, parameter updates, the shared cursor, the
  shared selection, multiple views;
- the GLSL lowering, including the shader's mirror of the colouring convention;
- the SymPy lowering, including exactness at the engine boundary;
- the LaTeX front end: that it produces the *same* tree as the plain syntax, that the
  round trip holds, that a compound subscript is not confused with a sum, and that
  unfinished input is reported as unfinished rather than wrong;
- the keypad: that every key inserts LaTeX the parser reads (so no key can offer a
  button that produces a broken line), that insertions land at the caret, that a
  selection is wrapped rather than discarded, and that a press does not steal focus;
- **mathematical reference identities** — `d/dz exp(z) = exp(z)` by central
  differences, `∮ 1/z dz = 2πi` around the unit circle by the trapezoidal rule,
  Cauchy's theorem for entire functions, and Cauchy–Riemann residuals that are
  positive for `z²` and large for `conj(z)`.

---

## What works today

Run the app and press **Analysis** in the canvas toolbar: the implemented and
unimplemented halves are listed by name, from the same source that drives the rest of
the interface. The short version:

**Complex Analysis** — domain colouring; magnitude, phase, real and imaginary
views; the mapped grid; a shared cursor and selection across views; parameters as
live sliders; the symbolic derivative.

**Integral Transforms** — expression typing; the time-domain plot, with real and
imaginary parts separated for a complex signal; the shared cursor.

**Multivariable Calculus** — scalar fields as a heatmap with a stated value range;
the coordinate grid over the field; the shared cursor; parameters.

Not implemented, and not approximated: contour integration, residues, Taylor and
Laurent series, pole and zero detection, branch cuts, Cauchy–Riemann residual
fields in the complex subsystem; Fourier series and transforms, the DFT and FFT,
sampling and aliasing, convolution, the Laplace transform, the s-plane and the
region of convergence in the transforms subsystem; contours, gradients,
directional derivatives, tangent planes, critical points, multiple integrals,
coordinate changes, vector fields, divergence, curl, and the three integral
theorems in the calculus subsystem.

**The expression editor is a structured mathematical editor**, not a text field: real
fractions, exponents, radicals, subscripts, Greek letters and function notation, with a
caret that navigates the structure. It is built on MathLive, wrapped behind a
three-verb adapter; the reasoning, and why MathQuill was rejected, is in
`docs/ARCHITECTURE.md` section 7.4.

Under the expression list is a mathematical keypad with three pages — digits, letters,
functions — whose function page differs per subsystem. The keypad inserts LaTeX the
canonical AST reads; mathematics the language does not have yet is shown inert and
labelled, rather than as a button that returns a wrong answer.

---

## Repository layout

```
packages/mathcore/   the shared mathematical core. No runtime dependencies.
  errors  rational  complex  conventions  builtins
  ast  lexer  parser  types  infer  evaluator  format  workspace
  coloring  glsl  sympy  cas

packages/app/        the interface: React, Vite, WebGL2
  subsystems  shell  routes  state  views  render
  readout  symbolic  analysis  styles
  expression/   the editor, the row, the panel and the keypad
                (MathExpressionField, mathInputAdapter, MathKeypad,
                 keypad/{types,common,complex,transforms,calculus})

services/symbolic/   SymPy behind an adapter. Standard library only.

docs/ARCHITECTURE.md    how it is built, and why
docs/CONVENTIONS.md     every mathematical convention, for a reader
```

---

## Configuration

The repository-root `.npmrc` points npm at `registry.npmmirror.com`, a fast mirror
for networks in mainland China. Delete that line if your network reaches the public
registry directly.

| Variable | Default | Purpose |
|---|---|---|
| `VITE_SYMBOLIC_URL` | `http://127.0.0.1:8000` | where the symbolic engine is |

---

## Design notes

A few choices that are worth knowing before changing anything.

**The core has zero runtime dependencies.** Complex arithmetic, parsing, the type
system and the domain-colouring convention are defined here rather than delegated
to libraries, so the project owns its mathematical model. Third-party code sits
behind interfaces: SymPy behind `CasAdapter`, WebGL behind a renderer.

**Two front ends, four back ends, one tree.** Plain text and LaTeX both parse into the
same canonical AST; that tree is then walked by the numerical evaluator, lowered to
SymPy syntax, lowered to a WebGL2 fragment shader, and printed back to LaTeX. There is
no second parser and no per-subsystem mathematics.

**Undefined is a reason, not `NaN`.** `1/z` at the origin does not produce a
number; it produces a sentence saying the divisor is zero. The GPU path cannot
carry a sentence, so it marks the pixel and the CPU evaluator remains the
reference.

**Exact and approximate are shown differently.** A symbolic result is labelled
`exact`; a readout is a double-precision number. Numeric literals survive parsing
as exact rationals so that the distinction remains available.

**Linked views are data, not wiring.** One `hover` and one `selection` in the
store, read by every view. A view cannot have a private cursor because there is
nowhere to put one.

**LaTeX is a surface syntax, not a second truth.** The editor reads and writes LaTeX;
`latex.ts` in the core parses it into the *same* canonical AST the plain-text parser
produces. Two front ends, four back ends, one tree.

**The math core has no opinion about the editor.** Everything mathematical lives in
`packages/mathcore`; the editor is one module in the application behind a three-verb
adapter, so it can be replaced without touching any mathematics.

**Nothing is faked.** A capability that is not implemented appears as a named
intention, never as a button that returns a wrong answer. If you add a feature,
add it to `subsystems.ts` with the right status and put a test behind it. The keypad
holds itself to the same rule: a key whose LaTeX the parser cannot read is disabled
and labelled, and a test enforces it.
