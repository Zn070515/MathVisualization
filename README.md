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

## What you need

| | Version | For |
|---|---|---|
| [Node.js](https://nodejs.org) | 20 or newer | everything |
| pnpm | 11.22.0 — pinned in `package.json`, and Corepack fetches it for you | everything |
| [Python](https://www.python.org) | 3.12 or newer | **only** the optional symbolic engine |

Nothing else. There is no database, no account system and no backend service.

---

## Setting it up

### 1. Node.js

**Windows** — with `winget`, in PowerShell:

```powershell
winget install OpenJS.NodeJS.LTS
```

Or download the LTS `.msi` from <https://nodejs.org> and run it. Either way, open a
**new** terminal afterwards, because `PATH` is only re-read when one starts.

**macOS** — with Homebrew, if you have it:

```bash
brew install node
```

Otherwise download the LTS `.pkg` from <https://nodejs.org> and run it.

**Linux** — distribution packages are often several major versions behind, so on
Debian and Ubuntu the NodeSource build is the reliable one:

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

On Fedora use `sudo dnf install nodejs`, on Arch `sudo pacman -S nodejs npm`. If you
already use `nvm`, `nvm install --lts` is the shortest route.

Check it, in a new terminal:

```bash
node -v      # v20.x or newer
```

### 2. pnpm

You do not have to choose a version. `package.json` has a `packageManager` field
naming the exact pnpm this project builds with, and Corepack — which ships with
Node — reads it and fetches that one:

```bash
corepack enable pnpm
```

If `corepack` is not on your `PATH`, `npm install -g pnpm` works as well; the pinned
version is still the one used, because it is written down in the repository rather
than left to whatever was installed last.

Check it:

```bash
pnpm -v      # 11.22.0
```

### 3. The application

```bash
pnpm install
pnpm dev
```

Then open <http://127.0.0.1:5173>, which is the homepage. `/complex`, `/transforms`
and `/calculus` are the three subsystems.

The first `pnpm install` takes a minute or two; after that `pnpm dev` starts in
about a second and reloads as you edit.

### 4. The symbolic engine — optional, and needs Python

The only feature that needs a second process is the symbolic panel: the derivative
of the active expression, in closed form. **Everything else works without it** —
every picture, every readout, every parameter slider — and the interface says
plainly when the engine is absent rather than guessing.

Python 3.12 or newer, if you do not have it:

- **Windows** — `winget install Python.Python.3.12`, or the installer from
  <https://www.python.org>.
- **macOS** — `brew install python@3.12`, or the installer from
  <https://www.python.org>.
- **Linux** — `sudo apt install python3.12 python3.12-venv` (Debian/Ubuntu),
  `sudo dnf install python3.12` (Fedora), `sudo pacman -S python` (Arch).

Then, from the repository root:

```bash
cd services/symbolic
python -m venv .venv
```

and install into that environment. The only difference between the systems is where
the environment keeps its executables, so this is written with the paths rather
than with an activation step:

```bash
# Windows
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python server.py

# macOS and Linux
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python server.py
```

It listens on `127.0.0.1:8000`. The application probes it and reports the result;
point the app somewhere else with `VITE_SYMBOLIC_URL` if you move it.

With [`uv`](https://docs.astral.sh/uv/) instead, which is faster:

```bash
cd services/symbolic
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt   # Windows
# uv pip install --python .venv/bin/python -r requirements.txt         # macOS, Linux
```

---

## If something does not work

**The page will not load, but `curl 127.0.0.1:5173` answers.** Use
`http://127.0.0.1:5173` rather than `http://localhost:5173`. `localhost` can resolve
to the IPv6 loopback, and the dev server is bound to IPv4 explicitly — the reason is
recorded in `packages/app/vite.config.ts`.

**Nothing on 127.0.0.1 is reachable at all, while external sites are fine.** A VPN
that is configured to send loopback through its proxy will do this, and the browser
is affected even though `curl` is not, because `curl` ignores the Windows system
proxy. If the VPN's bypass list contains `<-loopback>`, turn on its "bypass local
addresses" option.

**Port 5173 is already in use**, which usually means a previous run is still alive.
On Windows:

```powershell
netstat -ano | findstr :5173
taskkill /F /PID <the pid from the last column>
```

On macOS and Linux, `lsof -i :5173` then `kill <pid>`.

**The symbolic panel says the engine is unavailable.** Check that
`http://127.0.0.1:8000` answers, and that only one process is listening on it. On
Windows, `SO_REUSEADDR` lets two processes bind the same port, so a stale server can
answer while the one you just started has quietly failed — `netstat -ano | findstr
:8000` showing two `LISTENING` lines is the symptom, and killing both is the fix.

---

## Verifying it

```bash
pnpm lint          # ESLint, zero warnings
pnpm typecheck     # tsc, both packages
pnpm test          # 629 tests
pnpm build         # production build of the application
```

`pnpm verify` runs all four in order, and GitHub Actions runs that same command on
every push to `main` and every pull request (`.github/workflows/ci.yml`) — the gate
is one command, so a green run means the same thing locally and in CI.

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
- how a number is written: that `2e8` comes out as `2×10⁸` and not `2.00000e+8`,
  that the exponent is exposed as structure rather than buried in a string, that the
  value stays recoverable from what it wrote, and that the strings the readout
  already depended on have not moved;
- axis ticks: that a tick sits at `index × step` so its label and its line agree,
  that the step ladder is 1-2-5 with a quarter subdivision for a step of `2×10ⁿ`,
  and that this generalisation still produces exactly the grid spacing the shader was
  already using;
- **mathematical reference identities** — `d/dz exp(z) = exp(z)` by central
  differences, `∮ 1/z dz = 2πi` around the unit circle by the trapezoidal rule,
  Cauchy's theorem for entire functions, and Cauchy–Riemann residuals that are
  positive for `z²` and large for `conj(z)`.

---

## What works today

Run the app and press **Analysis** in the canvas toolbar: the implemented and
unimplemented halves are listed by name, from the same source that drives the rest of
the interface. The short version:

**Complex Analysis** — the complex plane with real and imaginary axes, a numbered
grid, and the image of the cursor's point joined to it; domain colouring; magnitude,
phase, real and imaginary views; the mapped grid; a shared cursor and selection
across views; parameters as live sliders; the symbolic derivative.

**Integral Transforms** — expression typing; a graph of the signal on graduated
axes, with real and imaginary parts separated for a complex signal, pan, zoom about
the pointer, and a control that frames the measured range; the shared cursor.

**Multivariable Calculus** — a surface for `z = f(x, y)` on a camera of its own,
with orbit, pan and zoom, and with a point where the function has no value drawn as
a hole rather than bridged; the same field as a heatmap with a stated value range;
the coordinate grid; the shared cursor; parameters.

Not implemented, and not approximated: contour integration, residues, Taylor and
Laurent series, pole and zero detection, branch cuts, Cauchy–Riemann residual
fields in the complex subsystem; Fourier series and transforms, the DFT and FFT,
sampling and aliasing, convolution, the Laplace transform, the s-plane and the
region of convergence in the transforms subsystem; contours, gradients,
directional derivatives, tangent planes, critical points, multiple integrals,
coordinate changes, vector fields, divergence, curl, and the three integral
theorems in the calculus subsystem.

**Which views a subsystem opens with is decided by the mathematics**, not by the
subsystem: a signature is inferred from the expression, and a table maps it to the
views that suit it. `f(x, y) = x² − y²` opens on a surface wherever it is typed.
A view whose renderer does not exist yet is never offered and never chosen as a
default.

**The expression editor is a structured mathematical editor**, not a text field: real
fractions, exponents, radicals, subscripts, Greek letters and function notation, with a
caret that navigates the structure. It is built on MathLive, wrapped behind a
three-verb adapter; the reasoning, and why MathQuill was rejected, is in
`docs/ARCHITECTURE.md` section 7.5.

Under the expression list is a mathematical keypad with three pages — digits, letters,
functions — whose function page differs per subsystem. The keypad inserts LaTeX the
canonical AST reads; mathematics the language does not have yet is shown inert and
labelled, rather than as a button that returns a wrong answer.

---

## Repository layout

```
packages/mathcore/   the shared mathematical core. No runtime dependencies.
  errors  rational  complex  conventions  builtins
  ast  lexer  parser  latex  types  infer  evaluator
  format  display  ticks  workspace  coloring  surface
  glsl  surfaceGlsl  sympy  cas

packages/app/        the interface: React, Vite, WebGL2
  subsystems  shell  routes  state  views  render  display
  readout  symbolic  analysis  styles
  expression/   the editor, the row, the panel and the keypad
                (MathExpressionField, mathInputAdapter, MathKeypad,
                 ParameterSlider, keypad/{types,common,complex,transforms,calculus})
  display/      how a number is written, once, for every surface
  render/       matrix + camera3d, the two WebGL2 pipelines, the axis
                drawing and the canvas text

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

Set it in `.env.local` at the repository root — that file is git-ignored, so it is
the right place for anything machine-specific:

```
VITE_SYMBOLIC_URL=http://127.0.0.1:9000
```

Then restart `pnpm dev`. Vite reads environment files when it starts, not while it
is running, so a change made with the server up has no effect until it is.

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

**Numbers are written in one place.** Every number a reader sees — the readout, a
tick label, a legend range, a slider's value — comes from one policy in the core,
which returns a *structured* value rather than a string so that the document can set
an exponent as a real superscript and a canvas can position one by hand. Four
copies of that policy used to disagree about both the threshold and the digits.

**Views are chosen by the object, not by the subsystem.** The inferred signature
decides which views suit an expression, so `f(x, y)` opens on a surface wherever it
is written. A view kind with no renderer is `planned`, and a planned kind is never
offered and never chosen as a default — a button that opens a blank frame is worse
than no button.

**The math core has no opinion about the editor.** Everything mathematical lives in
`packages/mathcore`; the editor is one module in the application behind a three-verb
adapter, so it can be replaced without touching any mathematics.

**Nothing is faked.** A capability that is not implemented appears as a named
intention, never as a button that returns a wrong answer. If you add a feature,
add it to `subsystems.ts` with the right status and put a test behind it. The keypad
holds itself to the same rule: a key whose LaTeX the parser cannot read is disabled
and labelled, and a test enforces it.
