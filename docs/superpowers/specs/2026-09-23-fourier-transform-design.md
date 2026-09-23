# Fourier Transform Vertical Slice and Demo CI Gate

## Status

Proposed implementation specification. The design has been approved in conversation; implementation begins only after this specification is reviewed.

## Context

MathVisualization already has an expression-first workspace, real one-variable graphing, subsystem routing, and a demo harness for repeatable README recordings. The `/transforms` route currently exposes the time-domain foundation, while the Fourier key and frequency-domain behavior remain planned.

This slice adds a real, numerically honest continuous Fourier transform workflow. It must be represented by the math AST and workspace model, drive an actual frequency-domain view, and remain explicit about finite-window numerical approximation. It must not introduce a demo-only state or a closed-form special case for the README recording.

## Goal

For a real-valued one-variable source function, support an expression such as:

```text
f(t) = exp(-t^2)
F(ω) = Fourier(f(t))
```

and provide:

- a true Fourier-transform AST node and parser/LaTeX input path;
- a `transform-pair` workspace classification for the transform definition;
- a deterministic numerical estimate of the continuous forward transform;
- linked Time Domain and Frequency Domain views that recompute from the same workspace state;
- Magnitude, Phase, Real, and Imaginary frequency display modes;
- parameter-driven updates without hardcoded output;
- explicit diagnostics for finite-window approximation and unsupported backends;
- a portable demo test gate that runs in CI without recording a browser video or depending on the sibling Playwright repository.

## Non-goals

This slice does not implement:

- inverse Fourier transforms;
- discrete Fourier transforms or FFT-specific user semantics;
- Laplace, Z, or other integral transforms;
- symbolic transform simplification or exact Gaussian identities;
- complex-valued source functions as a supported first-class input;
- a theorem-level convergence proof for an arbitrary source function;
- branch cuts, distribution-valued transforms, or generalized functions;
- browser/video recording in CI;
- a transforms GIF until the vertical slice is real, reproducible, and passes its correctness tests.

## Mathematical convention

Use the existing project convention:

\[
F(\omega) = \int_{-\infty}^{\infty} f(t)e^{-i\omega t}\,dt,
\qquad
f(t) = \frac{1}{2\pi}\int_{-\infty}^{\infty}F(\omega)e^{i\omega t}\,d\omega.
\]

The frequency variable is angular frequency `ω`, not cycles-per-unit frequency. The forward transform is non-unitary. The convention is shared by the AST metadata, numerical engine, UI labels, tests, and any future export.

## Expression and AST semantics

### Surface syntax

The canonical text syntax is:

```text
F(ω) = Fourier(f(t))
```

The LaTeX input path accepts the same operation through the project’s transform notation and emits the same AST node. The keypad’s Fourier key inserts the structured operation; it must not insert a visually similar unparsed string.

The initial grammar requires:

- a one-argument transform definition on the left (`F(ω)`);
- a one-argument source call on the right (`f(t)`);
- a real-valued source function `f : R → R`;
- a source variable distinct from the frequency variable;
- a source function that is defined in the same workspace or otherwise resolvable by the existing name-resolution rules.

Invalid forms receive parser/inference diagnostics instead of being silently treated as an ordinary function call. Examples include a missing source variable, a multi-argument source, an unresolved source function, or a complex-valued source.

### AST node

Add an expression node analogous to the existing contour-integral node:

```ts
interface FourierTransformNode {
  kind: 'fourier-transform';
  source: Expr;          // normally the source call f(t)
  sourceVariable: string; // normally t
}
```

The node is an expression, not a UI command. The containing function definition supplies the frequency variable through its bound parameter (`ω`). The node’s source variable is bound by the transform operation and must not leak into the outer definition’s free-variable set.

The AST implementation must update every exhaustive expression switch. Backends that cannot represent a numerical transform must return an explicit unsupported result; they must not drop the node, evaluate it as zero, or pretend to produce a symbolic expression.

### Inference and workspace classification

Inference validates the source call, resolves its function signature, and reports the transform signature as:

```text
R → C
```

because the Fourier transform of a real source is generally complex-valued. The workspace classifier recognizes the containing definition as `transform-pair` only when its body is a valid Fourier-transform node. A plain `R → C` function remains a complex-valued real-input function and is not automatically labeled as a transform pair.

The source definition remains separately available as the time-domain expression. The transform pair retains the source-function reference so the app can render both sides from one workspace rather than duplicating or hardcoding the expression.

## Numerical transform engine

### Honest finite-window estimate

The first implementation uses deterministic direct composite quadrature over a finite time window. It estimates:

\[
F_{T,N}(\omega)
=
\int_{-T}^{T} f(t)e^{-i\omega t}\,dt
\approx
\operatorname{trap}_{N}\left(f(t)e^{-i\omega t}\right).
\]

The default view configuration uses a symmetric window and a fixed frequency grid suitable for the initial Gaussian demonstration. The numerical result must carry its computation metadata:

```ts
interface FourierEstimate {
  values: Complex[];
  frequencies: number[];
  timeWindow: { min: number; max: number };
  timeSamples: number;
  estimatedError: number;
  convergence: 'converged' | 'unresolved';
  diagnostics: string[];
}
```

The error estimate comes from deterministic refinement (for example, comparing `N` and `2N` samples on the same window) and is labeled as a numerical discretization estimate. Truncation of the infinite integral is not silently treated as certified; the result metadata and UI must state that it is a finite-window numerical estimate. If the refinement comparison is not stable, `convergence` is `unresolved` and the UI reports that status instead of displaying unwarranted precision.

The engine must evaluate the user’s source function through the existing numerical evaluator. It must not detect `exp(-t^2)` and substitute a known closed form. Parameter changes therefore recompute the actual source samples and both views.

The initial implementation may use a stable fixed frequency grid (for example a symmetric interval around zero) for the view. The grid and window are implementation configuration, not user-facing claims that the transform is exact over all frequencies. The frequency axis must be labeled with `ω` and the active mode must be explicit.

### Numerical failure behavior

Undefined source evaluations, non-finite values, unresolved function names, or failed refinement produce a visible diagnostic in the Frequency Domain view. They must not be converted to zero or hidden behind an apparently valid curve.

The generic scalar evaluator does not need to return a scalar value for a transform node. The transform-specific numerical path owns `FourierEstimate` creation, while the AST and inference layers remain responsible for structure and diagnostics.

## App view architecture

### View kinds

Add a dedicated frequency-domain view kind rather than overloading the ordinary Cartesian graph. The default transform-pair layout contains:

1. Time Domain: the source `f(t)` on a Cartesian 2D plot;
2. Frequency Domain: the numerical `F(ω)` estimate on a Cartesian 2D plot.

The existing view-kind persistence and renderer maps must be exhaustive. A frequency-domain view must never silently fall back to a complex-plane or ordinary source graph when its renderer is unavailable.

### Display modes

The Frequency Domain view supports four explicit modes:

- Magnitude: `|F(ω)|`;
- Phase: `arg F(ω)`;
- Real: `Re F(ω)`;
- Imaginary: `Im F(ω)`.

Mode changes are view state, not expression edits. They update only the displayed projection of the same `FourierEstimate`. Phase uses a stable readout convention and indicates undefined/unstable values where the magnitude is numerically negligible.

### Linked state without false point correspondence

The views share workspace expressions, parameters, and transform estimates. They do not claim that a time cursor `t` and a frequency cursor `ω` are the same mathematical point. Each domain owns its own cursor/readout coordinate:

- Time Domain readout: `t`, `f(t)`;
- Frequency Domain readout: `ω`, selected transform mode, and the corresponding `F(ω)` components.

Hovering or selecting in one view can update shared selection styling and the relevant readout, but it must not fabricate a one-to-one `t ↔ ω` mapping. Parameter edits recompute both domains and preserve the selected mode where possible.

### Readout and diagnostics

The expression row identifies the transform pair and keeps the source/transform definitions visible. The Frequency Domain view displays:

- the active mode;
- `ω` axis labeling;
- a finite-window estimate notice;
- the current error/convergence status when available;
- numerical diagnostics instead of a curve when evaluation is invalid.

The UI must not display an exact symbolic result such as `√π exp(-ω²/4)` merely because a test function is Gaussian.

## Input and interaction

The `/transforms` route enables the Fourier keypad operation once the AST and numerical path are implemented. A normal user can:

1. enter `f(t)=exp(-t^2)`;
2. enter `F(ω)=Fourier(f(t))` using structured text or the keypad;
3. see the time and frequency views appear from the workspace;
4. switch Magnitude, Phase, Real, and Imaginary modes;
5. edit a real parameter used by `f` and observe both views recompute.

The implementation must expose stable semantic selectors or accessible labels for these actions so the reusable demo scenario can exercise the real UI. No demo-only hooks, hidden result labels, or recording-only controls may be added.

## Backend policy

The numerical app path is the supported first backend. Existing GLSL and SymPy/export switches must handle `fourier-transform` explicitly:

- GLSL: reject as unsupported for this numerical transform node;
- SymPy: reject or emit the project’s standard unsupported diagnostic until symbolic transform support exists;
- numerical evaluator: route through the transform engine rather than pretending the node is a scalar primitive.

All unsupported responses must be user-visible or test-visible and must preserve the original node for future backends.

## Demo and CI gate

### Recording policy

The reusable local Playwright recording continues to use the external repository at `C:\Users\16275\Desktop\demo_ArtFlow` without adding that repository as a dependency of MathVisualization. The transforms scenario is added only after the real `/transforms` flow is available.

CI must not record GIFs. Browser video capture, external Playwright repository discovery, and local display/runtime conditions are unsuitable for a merge gate. CI validates the demo implementation and committed media instead.

### Portable demo test command

Add a root command:

```text
pnpm demo:test
```

It runs the repository-local Node test files for:

- scenario contracts and route coverage;
- timing and mouse helpers;
- recording argument/config behavior;
- GIF conversion/filter contracts;
- README references and required alt text;
- committed demo asset existence and media metadata.

Asset validation uses FFmpeg/ffprobe through the existing media helpers. The CI workflow installs FFmpeg on the Linux runner before invoking the demo test command. The test verifies the two currently committed GIF/source pairs and is written so the transforms pair can be added when its real recording exists; it must not require an unimplemented transforms GIF prematurely.

The existing local `pnpm demo:check` remains the prerequisite check for actual recording. It may continue to require the sibling Playwright repository and local browser runtime. It is not called by CI.

### CI placement

The merge workflow runs `pnpm demo:test` as a distinct step after dependency installation and before the aggregate verification command, or as part of the aggregate command if the repository’s check ordering makes failures equally visible. A failure in a demo contract, README reference, or committed GIF metadata blocks the merge just like a type or unit-test failure.

CI does not write generated GIFs or modify the working tree. The demo test is read-only apart from process-local temporary files, which are cleaned by the test helper.

## Test plan

### Mathcore tests

- Parse canonical text syntax into `fourier-transform`.
- Parse the LaTeX/keypad form into the same node.
- Reject malformed source calls and unresolved source functions.
- Verify the source variable is bound and does not become a free variable.
- Infer a valid transform definition as `R → C` and classify it as `transform-pair`.
- Confirm ordinary `R → C` functions are not mislabeled as transform pairs.
- Verify unsupported GLSL/SymPy paths return explicit unsupported results.
- Numerically test a Gaussian estimate for symmetry, concentration near zero, and refinement convergence without comparing against a hardcoded exact curve.
- Verify parameter changes alter the sampled source and transform estimates.
- Verify non-finite source values produce diagnostics.

### App tests

- Infer the default Time Domain + Frequency Domain layout for a valid transform pair.
- Render all four frequency modes from the same estimate.
- Verify mode switches do not change the underlying workspace expression.
- Verify parameter edits trigger recomputation for both views.
- Verify time and frequency readouts use separate domain coordinates and do not claim point correspondence.
- Verify unresolved/error estimates render diagnostics rather than a plausible curve.
- Verify semantic selectors used by the transforms demo are present in the real UI path.

### Demo/CI tests

- Run `pnpm demo:test` without the sibling Playwright repository.
- Verify README links only to assets that exist and have the required alt text.
- Verify committed GIFs are within the configured dimensions/frame-rate/duration/size contract.
- Verify source WebMs remain present for reproducibility.
- Verify CI does not invoke browser recording or write generated media.

## Acceptance criteria

This slice is complete only when:

1. `F(ω)=Fourier(f(t))` is a real AST/workspace expression and not UI-only state.
2. A valid real source produces both Time Domain and Frequency Domain views through the normal application route.
3. The numerical result is generated from user expressions, reports finite-window/error metadata, and never masquerades as exact symbolic output.
4. Magnitude, Phase, Real, and Imaginary modes work on the same computed transform.
5. Parameter changes update both domains through shared workspace state.
6. Unsupported backends reject the new node explicitly.
7. The transforms mathcore/app/demo tests pass.
8. `pnpm demo:test` passes in CI with FFmpeg installed and without the external Playwright repository.
9. No transforms README GIF is added until the real scenario can be recorded and replayed locally from a clean workspace.

