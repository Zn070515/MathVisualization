<div align="center">

<h1>MathVisualization</h1>

<p><strong>表达式优先的数学探索环境</strong> · <strong>An expression-first environment for mathematics</strong></p>

<p>
  <a href="https://github.com/Zn070515/MathVisualization/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Zn070515/MathVisualization/ci.yml?branch=main&label=CI" alt="CI status"></a>
</p>

<p>
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.9">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=20232A" alt="React 19">
  <img src="https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white" alt="Vite 5">
  <img src="https://img.shields.io/badge/WebGL2-two%20pipelines-990000" alt="WebGL2">
  <img src="https://img.shields.io/badge/MathLive-0.110-1e40af" alt="MathLive 0.110">
  <img src="https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white" alt="Python 3.12 or newer">
</p>

<p>
  <a href="#setting-it-up">快速开始 · Get started</a> ·
  <a href="#what-you-should-see">界面导览 · A tour</a> ·
  <a href="#verifying-it">验证 · Verifying</a> ·
  <a href="#design-notes">设计说明 · Design notes</a>
</p>

</div>

MathVisualization is an environment for exploring complex analysis, integral
transforms and multivariable calculus by _writing mathematics_. You type an
expression; the system infers what kind of object it is — `C → C`, `R² → R` — and
puts the pictures and the analyses that suit **that object** in front of you, rather
than asking you to pick a tool first.

| Subsystem     | What it is for                                                                |
| ------------- | ----------------------------------------------------------------------------- |
| `/complex`    | Functions of a complex variable, drawn as maps of the plane.                  |
| `/transforms` | Signals in the time domain, and what they become in the transform domain.     |
| `/calculus`   | Scalar and vector fields, their local structure, and the integrals over them. |

They are peers, and each is the beginning of a subject rather than a demonstration.
Underneath, they are one program: one parser, one AST, one type system, one
numerical evaluator, one symbolic adapter — and a core with **no runtime
dependencies at all**.

## Complex Analysis

Write a complex expression, inspect its zeros and poles on the plane, and follow a
contour integral together with its accumulated value.

<p align="center">
  <img src="docs/assets/complex-demo.gif" alt="Complex Analysis in MathVisualization" width="100%" />
</p>

## Integral Transforms

Enter a real-valued signal, inspect its finite-window numerical Fourier spectrum,
switch between magnitude, phase, real and imaginary views, and change a live
parameter while the time and frequency views update together.

<p align="center">
  <img src="docs/assets/transforms-demo.gif" alt="Integral Transforms in MathVisualization" width="100%" />
</p>

## Multivariable Calculus

Enter a scalar field and work with its Cartesian 3D surface, orbiting the view,
reading a point, and deforming the surface with a live parameter slider.

<p align="center">
  <img src="docs/assets/calculus-demo.gif" alt="Multivariable Calculus in MathVisualization" width="100%" />
</p>

## Read these first

| Document                                                                       | What it governs                                                                                                                   |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| [`GOAL.md`](GOAL.md)                                                           | The product document, and the authority on what this project is and is not.                                                       |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                                 | How it is built, and why — every claim naming the file it is about.                                                               |
| [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md)                                   | Every mathematical convention, rendered for a reader.                                                                             |
| [`packages/mathcore/src/conventions.ts`](packages/mathcore/src/conventions.ts) | The same conventions as a machine-readable table the tests assert against, so the document above cannot drift from the behaviour. |

## What it refuses to do

The interesting part of this project is what it will not do, because each of these
is a thing that would have been easier.

- **A second mathematical truth.** There is one AST. Plain text and LaTeX both
  produce it; the CPU evaluator, the symbolic engine and two GPU pipelines all read
  it. A renderer that needed its own parser would be a second answer to the same
  question.
- **Fabrication.** An unimplemented capability is named and marked as such, never
  offered as a button that returns a wrong answer. A value that does not exist is
  reported with a _reason_ — the divisor is zero here — rather than as `NaN`.
- **A number written two ways.** One policy for how a number is written, in the core,
  so the readout and the axis labels cannot disagree about the same magnitude.
- **Hidden scaling.** A curve that leaves the frame is stated as a number in the
  legend rather than silently rescaled to fit. Moving the frame is a thing you ask
  for, not a thing done behind your back.
- **A claim without evidence.** A result obtained numerically is presented as one. A
  place where a curve crosses the axis and a place where it merely touches are
  different statements, and are labelled differently.
- **An account system.** There is no login, no server, and no telemetry. Your work is
  written in your own browser.

> **What is verified** is stated in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §11,
> and **whether it passes** is stated by the [CI workflow](.github/workflows/ci.yml) —
> which runs one command, `pnpm verify`, the same one a developer runs. Counts and
> stage numbers are deliberately left to those, so that this file cannot go stale.

---

## What you need

Three pieces of software. Only the first two are required.

|                                  | Version                                                                  | What it is                                                                                                              | For                          |
| -------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| [Node.js](https://nodejs.org)    | 20 or newer                                                              | the program that runs JavaScript outside a browser — this application is written in JavaScript, so it needs this to run | everything                   |
| pnpm                             | 11.22.0 (written down in `package.json`; Corepack fetches the right one) | a _package manager_: it downloads the libraries the project depends on                                                  | everything                   |
| [Python](https://www.python.org) | 3.12 or newer                                                            | another language, used by one optional feature that does algebra in closed form                                         | **only** the symbolic engine |

Nothing else. There is no database to install, no account to create and no server to
set up.

---

## Setting it up

Six steps, in order. Every command is meant to be typed into a terminal — that is the
window where you type words and press Enter — and step 2 shows you how to open one if
you have never done it before.

Nothing here is dangerous. You cannot break your computer by getting a step wrong;
the worst that happens is an error message, and the last section deals with those.

### 1. Get the code onto your computer

The project lives at <https://github.com/Zn070515/MathVisualization>. There are two
ways to get it, and the first needs no other software.

**The easy way — download a zip.** Open that link, click the green **Code** button,
choose **Download ZIP**, and then unzip the file you get. On Windows, right-click the
downloaded file and choose _Extract All_; on macOS, double-click it. You now have a
folder called `MathVisualization-main` (or similar) with the project inside.

**The way that keeps it updatable — `git clone`.** If you already have Git, open a
terminal anywhere and run:

```bash
git clone https://github.com/Zn070515/MathVisualization.git
```

That creates a folder called `MathVisualization`.

Either way, **remember where that folder is**. Everything from here happens inside it.
On Windows it might be `C:\Users\YourName\Downloads\MathVisualization-main`. Move it
somewhere you will find again — `Desktop` or `Documents` is fine.

### 2. Open a terminal in that folder

You do not need to know any terminal commands for this. Every system has a way to open
a terminal that is _already pointed at a folder_:

- **Windows** — open the folder in File Explorer, then right-click on some empty
  space inside it and choose **Open in Terminal** (Windows 11) or **Open PowerShell
  window here** (Windows 10; hold Shift while right-clicking if you do not see it).
- **macOS** — right-click the folder in Finder, then _Services_ → **New Terminal at
  Folder**. If that is missing, enable it in _System Settings_ → _Keyboard_ →
  _Keyboard Shortcuts_ → _Services_ → _Files and Folders_.
- **Linux** — most file managers have **Open in Terminal** on the right-click menu.
  Otherwise open a terminal and type `cd ` (with a space), then drag the folder into
  the window and press Enter.

The terminal now starts _inside_ the project. You can tell you are in the right place
because `ls` (macOS, Linux) or `dir` (Windows) lists files including `package.json`,
`README.md` and a folder called `packages`.

### 3. Install Node.js

**Windows** — in the terminal you just opened:

```powershell
winget install OpenJS.NodeJS.LTS
```

Or download the LTS `.msi` installer from <https://nodejs.org>, run it, and click
through. Either way, **close the terminal and open a new one** afterwards — the list
of programs is only read when a terminal starts, so the old one will not know Node.js
exists yet.

**macOS** — with Homebrew, if you have it:

```bash
brew install node
```

Otherwise download the LTS `.pkg` installer from <https://nodejs.org> and run it.

**Linux** — the version in your distribution's repositories is often several major
versions behind, so on Debian and Ubuntu use the NodeSource build:

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

On Fedora use `sudo dnf install nodejs`, on Arch `sudo pacman -S nodejs npm`. If you
already use `nvm`, `nvm install --lts` is the shortest route.

**Check that it worked.** In a terminal — a _new_ one, if you just installed — type:

```bash
node -v
```

You should see something like `v20.11.1` or a larger number. If instead you see
`command not found` or `not recognized`, the install did not take: close the terminal,
open a new one, and try again. If it still fails, the installer probably did not finish
— run it again and watch for an error.

### 4. Install pnpm

You do not have to choose a version. `package.json` contains a `packageManager` field
naming the exact pnpm this project is built with, and Corepack — which came with
Node.js in the previous step — reads that field and fetches that exact one:

```bash
corepack enable pnpm
```

If that says `command not found` or `is not recognized`, use this instead:

```bash
npm install -g pnpm
```

Then **check it**:

```bash
pnpm -v
```

You should see `11.22.0`. Any other number means a different pnpm is being picked up;
the pinned one is used as soon as `corepack enable pnpm` has succeeded.

### 5. Download the libraries, and start it

Still in the project folder:

```bash
pnpm install
```

This downloads the libraries the project is built on. It prints a spinner and takes
between thirty seconds and two minutes. **Text in yellow is a warning and is normal.**
Only lines containing `ERR!` or `error` are a problem — if you see one of those, look
under _If something does not work_ below.

> **Outside mainland China?** The repository is configured to use a mirror that is fast
> in China. If this step is crawling, open the file `.npmrc` in the project folder,
> delete the line beginning with `registry=`, save it, and run `pnpm install` again.

When it finishes, start the application:

```bash
pnpm dev
```

You should see something very close to this:

```
  VITE v5.4.11  ready in 162 ms

  ➜  Local:   http://127.0.0.1:5173/
```

and then the terminal stops responding. **That is what success looks like — the
application is running.** Leave the terminal window open.

Now open **<http://127.0.0.1:5173>** in your browser: type it into the address bar, or
in the terminal click the address while holding Ctrl (Windows, Linux) or Cmd (macOS).

**To stop it**, click on the terminal window and press **Ctrl + C** — the same on all
three systems. To start it again later, open a terminal in the folder and run
`pnpm dev`. `pnpm install` only ever has to be done once.

### 6. The symbolic engine — optional, and needs Python

**You can skip this.** Everything visual — every graph, every readout, every slider —
works without it. The one feature that needs it is the symbolic panel: the derivative
of the expression you are working on, in closed form, from a computer-algebra system
rather than by numerical approximation. When the engine is not running the interface
says so plainly instead of guessing at an answer.

Python 3.12 or newer, if you do not have it:

- **Windows** — `winget install Python.Python.3.12`, or the installer from
  <https://www.python.org> (tick _Add Python to PATH_ during installation).
- **macOS** — `brew install python@3.12`, or the installer from
  <https://www.python.org>.
- **Linux** — `sudo apt install python3.12 python3.12-venv` (Debian, Ubuntu),
  `sudo dnf install python3.12` (Fedora), `sudo pacman -S python` (Arch).

Then, from the project folder:

```bash
cd services/symbolic
python -m venv .venv
```

> On macOS and Linux, `python` may not exist and you have to type `python3` instead.
> If `python -m venv` fails, try `python3 -m venv .venv`.

That creates a private, throwaway Python installation inside the project, so nothing
you do here can affect the rest of your computer. Install into it — the _only_
difference between the systems is where an environment keeps its programs:

```bash
# Windows
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python server.py

# macOS and Linux
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python server.py
```

The second of those two lines starts the engine. It listens on `127.0.0.1:8000`, and
like `pnpm dev` it will sit there without returning — that is correct. Leave it
running in **its own terminal window**, alongside the application's.

With [`uv`](https://docs.astral.sh/uv/), which is faster:

```bash
cd services/symbolic
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt   # Windows
# uv pip install --python .venv/bin/python -r requirements.txt         # macOS, Linux
```

---

## What you should see

The homepage lists the three subsystems and, under each, how many of its capabilities
are implemented. They are peers: none is the main feature and none is a demo.

Open any of them and you get the same layout — expressions on the left, the picture
they make on the right, and a readout along the bottom:

```
┌────────────────────┬──────────────────────┐
│  expressions       │       canvas         │
│  (type here)       │    (the picture)     │
│  +            ⌨    │                      │
└────────────────────┴──────────────────────┘
   readout: the value where you point
```

Things worth trying straight away:

- **Just start typing.** The first expression row is already focused, so you do not
  have to click into it first.
- **Write a fraction.** Type `sin(z)/(z^2+1)`. It becomes a two-dimensional fraction
  as you type, and the arrow keys move the caret _inside_ the numerator and
  denominator rather than along a line of text.
- **Press Enter** on the last row to get another one. Press `⌨` at the bottom of the
  left panel for a mathematical keypad whose function page differs per subsystem.
- **Point at the canvas.** The readout along the bottom shows the value of your
  expression there, with the modulus, the argument, and the colour the picture is
  painting — so the colour is tied to a number rather than left as decoration.
- **Drag to pan, wheel to zoom.** On the surface view, drag to orbit and shift-drag to
  pan.
- **Press Analysis** in the canvas toolbar to see exactly what is implemented and what
  is not. Unimplemented things are named there, and never appear as a button that
  returns a wrong answer.

---

## If something does not work

Listed roughly in the order people hit them. Nothing here can damage your computer,
and nothing here needs a reinstall of the whole project.

### `node: command not found`, or `'node' is not recognized`

Node.js is not installed, or the terminal has not noticed it yet. **Close the terminal
window, open a new one, and try again** — a terminal reads the list of installed
programs only when it starts, so one that was already open when you installed Node
will not find it. If a new terminal still cannot find it, run the Node.js installer
again and watch for an error.

### `pnpm: command not found`, or `'pnpm' is not recognized`

The same thing, one step later: go back to step 4 and run `corepack enable pnpm`
(again in a **new** terminal). If `corepack` itself is not found, use
`npm install -g pnpm` instead.

### The browser says it cannot reach the address

Almost always one of two things:

1. **The application is not running.** Look at the terminal where you ran `pnpm dev`.
   If you closed it, or if you can type in it and get a prompt back, it has stopped —
   start it again with `pnpm dev`. A running dev server _looks_ frozen, which is
   correct.
2. **You are at the wrong address.** It must be `http://127.0.0.1:5173`, exactly. Not
   `https`, and not `localhost`.

### The address is already in use

A previous run is still alive somewhere. On Windows:

```powershell
netstat -ano | findstr :5173
taskkill /F /PID <the number in the last column>
```

On macOS and Linux, `lsof -i :5173` then `kill <the number it prints>`.

Or simply **restart your computer**, which clears it too.

### It works at `127.0.0.1` but not at `localhost`

Use `127.0.0.1`. `localhost` can resolve to the IPv6 form of the address, and the dev
server listens on the IPv4 form explicitly — the reason is recorded in
`packages/app/vite.config.ts`. Both spellings look like they should mean the same
thing, and for this project they do not.

### Nothing on `127.0.0.1` works, but ordinary websites are fine

A VPN is sending that traffic through itself. This affects the browser but not
commands typed into a terminal, because a terminal ignores the system's proxy
settings — which is why the two can disagree about whether the server is up. Turn on
the VPN's **"bypass local addresses"** / **"allow LAN"** option. If its bypass list
contains `<-loopback>`, that is the setting responsible.

### The page loads but is blank or unstyled

Reload with **Ctrl + Shift + R** (Windows, Linux) or **Cmd + Shift + R** (macOS) to
bypass the browser's cache. If that does not help, look at the terminal running
`pnpm dev`: a red error there is the cause, and copying it into a search engine is the
fastest way to understand it.

### The symbolic panel says the engine is unavailable

You can ignore this and use everything else. If you want it:

- Check that the engine's terminal is still running, and that you visited
  `http://127.0.0.1:8000` — it should answer with something, rather than refusing.
- On Windows, two programs can quietly share the same port: a stale engine keeps
  answering while the one you just started has failed to start. `netstat -ano |
findstr :8000` printing two `LISTENING` lines is the symptom. Kill both and start it
  once.

### Starting over

If the install itself looks broken — odd errors during `pnpm install`, or a build
failure that makes no sense — this resets the downloaded libraries without touching
your work or the project:

```bash
# stop anything running first with Ctrl+C in each terminal, then:
rm -rf node_modules packages/mathcore/node_modules packages/app/node_modules
pnpm install
```

On Windows, use `Remove-Item -Recurse -Force` in place of `rm -rf`.

---

## Verifying it

```bash
pnpm lint          # ESLint, zero warnings
pnpm typecheck     # tsc, both packages
pnpm test          # the suite
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
- the LaTeX front end: that it produces the _same_ tree as the plain syntax, that the
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
the pointer, and a control that frames the measured range; a finite-window numerical
Fourier transform with magnitude, phase, real and imaginary projections; the shared
time-domain cursor and an independent frequency-domain cursor.

**Multivariable Calculus** — a surface for `z = f(x, y)` on a camera of its own,
with orbit, pan and zoom, and with a point where the function has no value drawn as
a hole rather than bridged; the same field as a heatmap with a stated value range;
the coordinate grid; the shared cursor; parameters.

The complex subsystem also now includes numerical contour integrals, accumulated
integral trajectories, detected zero/pole orders, numerical residues, and an
uncertainty-aware residue-theorem cross-check. Still not implemented, and not
approximated: Taylor and Laurent series, branch cuts, Cauchy–Riemann residual
fields in the complex subsystem; Fourier series, the DFT and FFT, sampling and
aliasing, convolution, the Laplace transform, the s-plane and the region of
convergence in the transforms subsystem; contours, gradients,
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

| Variable            | Default                 | Purpose                      |
| ------------------- | ----------------------- | ---------------------------- |
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
`latex.ts` in the core parses it into the _same_ canonical AST the plain-text parser
produces. Two front ends, four back ends, one tree.

**Numbers are written in one place.** Every number a reader sees — the readout, a
tick label, a legend range, a slider's value — comes from one policy in the core,
which returns a _structured_ value rather than a string so that the document can set
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
