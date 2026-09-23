# Fourier Transform Vertical Slice and Demo CI Gate — Implementation Plan

> **Execution note:** Follow this plan with test-first changes. Each implementation step begins with a failing test, then the smallest production change that makes it pass, followed by focused verification.

## Outcome

Implement the approved Fourier transform vertical slice for `/transforms` and make the repository’s real demo contracts and committed media part of CI. The feature will use the existing expression-first workspace and numerical evaluator, add a dedicated frequency-domain renderer, and keep finite-window approximation/error status visible.

The final local flow will support:

```text
f(t)=exp(-t^2)
F(ω)=Fourier(f(t))
```

with Time Domain and Frequency Domain views, Magnitude/Phase/Real/Imaginary modes, parameter-driven recomputation, a real Playwright scenario, and a generated `transforms-demo.gif` only after the application path is verified.

## Constraints carried from the spec

- Use the existing AST for the transform; no UI-only or demo-only representation.
- Use the project’s forward angular-frequency convention and non-unitary normalization.
- Compute a finite-window direct quadrature estimate from the user’s expression; do not hardcode Gaussian output.
- Report discretization/refinement status and the finite-window limitation.
- Keep time and frequency cursors as separate domains; never imply `t` and `ω` are the same coordinate.
- Unsupported GLSL/SymPy paths must fail explicitly.
- CI runs portable demo tests and validates committed assets; CI does not record browser videos and does not require `C:\Users\16275\Desktop\demo_ArtFlow`.
- Do not add the transforms GIF until the real route can record it from a clean workspace.

## Step 1 — Establish the failing test matrix

Before production changes, add the tests that describe the vertical slice and the CI contract.

### Mathcore tests

Add `packages/mathcore/test/fourier.test.ts` covering:

- plain-text parsing of `F(ω)=Fourier(f(t))` into a `fourier-transform` node;
- LaTeX parsing of the keypad form into the same canonical node;
- formatting/round-tripping of the node in plain text and LaTeX;
- source-variable binding in `collectVariableNames`;
- malformed source calls, multi-argument calls, unresolved source names, and non-real source signatures;
- valid inference as `R → C` and `transform-pair` classification only for a real Fourier definition;
- a normal `R → C` function remaining a complex-valued function rather than becoming a transform pair;
- Gaussian numerical properties (finite values, even real part, small odd imaginary component, concentration near zero, and refinement convergence);
- parameter changes producing different samples and transform values;
- non-finite source evaluation producing diagnostics and unresolved status.

Extend the existing parser, LaTeX, workspace, evaluator, GLSL, and SymPy tests where their current exhaustive behavior is easiest to assert. Keep tests focused on public behavior instead of snapshotting internal helper details.

### App tests

Extend `packages/app/test/viewKinds.test.ts`, `workspaceStore.test.ts`, and related renderer tests for:

- a valid transform pair selecting `cartesian-2d` plus `frequency-domain` by default;
- `transform-pair` being drawable in the transforms subsystem;
- frequency view mode defaulting to Magnitude and allowing only the four transform projections;
- parameter changes invalidating/recomputing the transform estimate;
- separate frequency cursor/selection state not being converted to a plane `Complex` coordinate;
- explicit diagnostics when the transform estimate is unresolved.

Add a focused component/helper test for the frequency projection function so all four modes are checked against one `FourierEstimate`.

### Demo/CI tests

Update the existing Node tests under `scripts/demo/` to express the post-feature contract:

- `transforms` becomes `ready` only after the scenario is implemented;
- the manifest exposes all three recordable routes and media paths;
- README references all three GIFs with the required alt text;
- a new asset test verifies each committed GIF and source WebM exists and satisfies the shared media contract;
- `pnpm demo:test` runs these tests without loading external Playwright.

Run the new tests once and confirm they fail for the expected missing implementation/assets before proceeding.

## Step 2 — Add the canonical Fourier AST and syntax paths

### Files

- `packages/mathcore/src/ast.ts`
- `packages/mathcore/src/parser.ts`
- `packages/mathcore/src/latex.ts`
- `packages/mathcore/src/format.ts`
- `packages/mathcore/src/builtins.ts` or the relevant builtin-name registry
- `packages/mathcore/src/index.ts`
- parser/LaTeX/AST tests

### Changes

1. Add `FourierTransformNode` to `Expr` with `source`, `sourceVariable`, and `span`.
2. Treat the source variable as bound when collecting free variables, mirroring the existing contour-integral binding rule.
3. Reserve `Fourier` as a transform operation in the parser. Parse exactly one argument, require that it is a one-argument source call such as `f(t)`, and produce the dedicated node rather than a generic call.
4. Add the equivalent LaTeX operation used by the keypad and make both front ends produce the same canonical shape and source spans.
5. Add plain and LaTeX formatters that preserve the mathematical operation and source variable.
6. Ensure the normal function-name pre-pass recognizes the operation without changing the meaning of ordinary implicit multiplication.
7. Export the new types and helpers from the mathcore barrel.

### Verification

Run the parser/LaTeX/fourier tests. Confirm malformed forms fail with useful spans and that `Fourier(f(t))` cannot be mistaken for an ordinary numeric builtin.

## Step 3 — Infer transform signatures and workspace classification

### Files

- `packages/mathcore/src/infer.ts`
- `packages/mathcore/src/types.ts` only where the classification contract requires it
- `packages/mathcore/src/workspace.ts`
- `packages/mathcore/src/evaluator.ts`
- `packages/mathcore/test/infer.test.ts`
- `packages/mathcore/test/workspace.test.ts`

### Changes

1. Add a Fourier inference branch that:
   - verifies the source node is a one-argument call;
   - resolves the source function;
   - requires source domain `R` and source codomain `R`;
   - binds `sourceVariable` only inside the source expression;
   - returns codomain `C` for the transform result.
2. Keep `classifySignature` conservative for generic signatures. Add statement/body-aware classification in the workspace analysis path so only a definition whose body is a valid Fourier node gets `transform-pair`.
3. Preserve the source function and transform function in the normal workspace environment so parameter overrides affect both definitions.
4. Make any transform definition that reaches the generic scalar evaluator return an explicit unsupported issue, directing callers to the numerical transform evaluator. It must never evaluate as zero.
5. Keep definition-order independence: the source may appear before or after `F(ω)`.

### Verification

Run the new inference/workspace tests plus the existing mathcore suite. Inspect an analyzed workspace and verify the source line is `real-function`, the transform line is `transform-pair`, and an unrelated `g(t)=exp(i*t)` is not mislabeled.

## Step 4 — Implement the numerical Fourier engine with honest error metadata

### Files

- `packages/mathcore/src/fourier.ts`
- `packages/mathcore/src/index.ts`
- `packages/mathcore/test/fourier.test.ts`
- possibly `packages/mathcore/src/evaluator.ts` for a small shared evaluation helper

### Changes

1. Define a pure `FourierEstimate` result and options for:
   - symmetric finite time window;
   - deterministic frequency grid;
   - base sample count and refinement count;
   - source expression/environment.
2. Evaluate the source call for each time sample using the existing numerical evaluator and workspace environment. Apply trapezoidal endpoint weights to `f(t)e^{-iωt}` for each frequency.
3. Refine from `N` to `2N` samples on the same window and estimate discretization error from the largest complex difference. Mark the estimate `converged` only when the comparison is finite and below the configured threshold.
4. Carry the time window, sample count, frequencies, values, estimated error, convergence, and diagnostics in the result.
5. Treat infinite-domain truncation as an explicit limitation. Add a diagnostic such as “finite-window estimate; tail convergence is not certified” rather than folding an unmeasured tail into the error budget.
6. Propagate undefined/non-finite source samples as diagnostics and unresolved status. Do not replace them with zero.
7. Keep the engine general over source expressions and parameters. There must be no Gaussian pattern match or closed-form shortcut.

### Verification

Use a Gaussian fixture to check symmetry and qualitative spectrum shape, and compare base/refined numerical results rather than asserting a symbolic Gaussian formula. Add a parameterized fixture such as `exp(-a*t^2)` and verify changing `a` changes both sampled time values and transform values.

## Step 5 — Make every backend exhaustive

### Files

- `packages/mathcore/src/evaluator.ts`
- `packages/mathcore/src/glsl.ts`
- `packages/mathcore/src/sympy.ts`
- `packages/mathcore/src/format.ts`
- any compiler/lowering tests that use expression switches

### Changes

1. Add an explicit `fourier-transform` case to every expression switch.
2. The numerical transform path is the only supported evaluator path.
3. GLSL lowering returns the project’s standard unsupported result because a finite-window transform is not a scalar shader primitive.
4. SymPy lowering returns the project’s standard unsupported result until symbolic transform support exists.
5. Printers preserve the node for diagnostics and future backends.

### Verification

Run the GLSL/SymPy/evaluator tests and inspect failure messages. Add regression assertions that none of these paths silently emit `0`, an empty string, or a generic function call.

## Step 6 — Route transform pairs to two real views

### Files

- `packages/app/src/subsystems.ts`
- `packages/app/src/state/workspaceStore.ts`
- `packages/app/src/state/viewKinds.ts`
- `packages/app/src/state/persistence.ts`
- `packages/app/src/views/ViewCanvas.tsx`
- `packages/app/src/views/FrequencyDomainView.tsx` (new)
- `packages/app/src/state/workspaceStore.ts` selector additions
- app state/view tests

### Changes

1. Add the `frequency-domain` `ViewKind`, mark it available only once the renderer exists, add its title, persistence migration entry, and exhaustive renderer dispatch.
2. Include `transform-pair` in the transforms subsystem’s drawable kinds.
3. Make view inference aware of the active entry’s classification, not just its signature. A transform pair defaults to:
   - `cartesian-2d` for the source/time-domain expression;
   - `frequency-domain` for the transform estimate.
4. Keep `FieldMode` as the storage union, but make the frequency frame offer only `magnitude`, `phase`, `real`, and `imaginary`; normalize any invalid/legacy `complex` mode to Magnitude for this view.
5. Add a selector that finds the active transform-pair definition and its source call/function without making the renderer parse source text.
6. Implement `FrequencyDomainView` as a dedicated Cartesian canvas. It samples the transform estimate, projects the selected mode, draws axes and the curve, shows the `ω` range, and provides an accessible view label and mode select.
7. Use the existing viewport/canvas interaction conventions where they make mathematical sense, but keep frequency coordinates separate from the shared complex-plane cursor.
8. Show the finite-window and convergence diagnostics in the frame. When unresolved, render the diagnostic overlay rather than a plausible curve.
9. Update view inference/re-inference tests so changing an expression from a normal signal to a transform pair changes the default panes only while the layout still follows inference.

### Verification

Run app state tests and a focused renderer test. Confirm a clean `/transforms` workspace with the two expressions opens with both panes, while an ordinary signal still opens only on the time-domain plot.

## Step 7 — Add separate frequency readout and shared parameter recomputation

### Files

- `packages/app/src/state/workspaceStore.ts`
- `packages/app/src/readout/ReadoutBar.tsx`
- `packages/app/src/views/FrequencyDomainView.tsx`
- `packages/app/src/views/evaluation.ts` or a new transform-evaluation helper
- `packages/app/src/expression/ExpressionRow.tsx` / `ValueLine.tsx` only if a transform-specific status row is needed
- app tests

### Changes

1. Add frequency hover/selection state as a numeric `ω` coordinate, separate from the existing plane `Complex` hover/selection. Entering one domain clears the other domain’s active cursor so the global readout cannot mix meanings.
2. Extend the readout to state its domain explicitly:
   - time domain: `t`, `f(t)`;
   - frequency domain: `ω`, selected projection, and transform value/components.
3. Keep selection and pointer interaction deterministic. A frequency hover must never be converted to `cx(ω, 0)` and displayed as a time/complex point.
4. Memoize transform estimates by workspace, parameter values, and numerical configuration. A slider update must recompute the source graph and transform estimate from the same state.
5. Ensure phase readout is undefined/marked unstable near numerically zero magnitude rather than reporting an arbitrary angle.

### Verification

Test the readout labels and state transitions directly. Move/hold a frequency cursor in the component test and assert that the displayed coordinate is `ω`, not `t`; change a parameter and assert both renderer inputs change.

## Step 8 — Enable the real transforms input/keypad flow

### Files

- `packages/app/src/expression/keypad/transforms.ts`
- `packages/app/src/expression/keypad/types.ts` if a structured Fourier insertion needs a new key kind
- `packages/app/src/expression/MathKeypad.tsx` / `mathInputAdapter.ts` only where insertion is wired
- `packages/app/src/subsystems.ts`
- keypad/component tests

### Changes

1. Replace the planned Fourier key with a real structured insertion that produces the canonical Fourier operation.
2. Keep inverse Fourier, Laplace, convolution, and other planned keys disabled.
3. Update the transforms capability description from planned to implemented only after the numerical/UI tests pass. Describe it as a finite-window numerical estimate with magnitude/phase/component modes, not as closed-form symbolic output.
4. Add stable accessible labels/selectors for the expression rows, frequency frame, mode select, and convergence notice so the demo uses the actual product controls.

### Verification

Run keypad tests and manually rehearse the exact flow with the real MathLive input: source definition, transform definition, mode switch, and parameter edit.

## Step 9 — Update the reusable demo and generate the transforms media

### Files

- `scripts/demo/scenarios/transforms.mjs`
- `scripts/demo/scenarioManifest.mjs`
- `scripts/demo/config.mjs`
- `scripts/demo/contract.test.mjs`
- `scripts/demo/scenarios.test.mjs`
- `scripts/demo/readme.test.mjs`
- `scripts/demo/assets.test.mjs` (new)
- `README.md`
- `docs/assets/source/transforms-demo.webm`
- `docs/assets/transforms-demo.gif`

### Changes

1. Convert the transforms scenario from `planned` to `ready` only after the route supports the complete real flow.
2. Use the existing external Playwright repository through the local loader. Do not add it to this repository’s dependencies.
3. Record a deterministic 12–18 second sequence at the same viewport/scale as the other demos:
   - enter `f(t)=exp(-t^2)` naturally;
   - enter `F(ω)=Fourier(f(t))` naturally or through the real keypad operation;
   - pause for both panes and the finite-window status;
   - move to the Frequency Domain view with stepped human-like motion;
   - switch Magnitude/Phase or Magnitude/Real with visible pauses;
   - change a real parameter and show both domains update;
   - finish with both linked views visible.
4. Generate the WebM and GIF through the existing FFmpeg palette pipeline. Inspect the output for blank startup frames, excessive end hold, accidental pointer jitter, and any diagnostic that contradicts the actual result.
5. Add the transforms GIF to the README only after the recording is reproducible from a clean workspace. Keep source WebM committed beside the GIF.

### Verification

Run `pnpm demo:rehearse transforms` first, then `pnpm demo:transforms` locally with the sibling Playwright repo. Probe the generated media with the repository media helpers and review the rendered GIF visually.

## Step 10 — Put demo validation in CI without browser recording

### Files

- `scripts/demo/assets.test.mjs`
- `package.json`
- `.github/workflows/ci.yml`
- `scripts/demo/record.test.mjs` if argument behavior needs a CI-only distinction

### Changes

1. Add the root script:

   ```text
   "demo:test": "node --test scripts/demo/*.test.mjs"
   ```

2. Make `assets.test.mjs` validate the committed GIF/source pairs with `probeMedia`/`validateGif`: dimensions, frame rate, duration, file size, and presence of source WebM.
3. Keep `demo:check` as the local recording prerequisite check. Do not make CI invoke it, because it intentionally loads the sibling Playwright repository and a browser.
4. Add an Ubuntu CI step to install FFmpeg/ffprobe, then run `pnpm demo:test` as a distinct merge-gate step after `pnpm install` and before `pnpm verify`.
5. Ensure the test suite is read-only with respect to committed assets and leaves no palette or generated temporary file in the workspace.

### Verification

Run `pnpm demo:test` locally with FFmpeg on PATH. Run the full CI-equivalent sequence locally (`pnpm demo:test`, then `pnpm verify`) and inspect `git status` to confirm no generated files changed.

## Step 11 — Documentation and final correctness pass

### Files

- `README.md`
- `packages/app/src/subsystems.ts`
- `docs/superpowers/specs/2026-09-23-fourier-transform-design.md` only if an implementation-discovered correction is needed
- relevant tests and changelog/release notes if present

### Changes

1. State clearly that the Fourier result is a numerical finite-window estimate and identify angular frequency `ω`.
2. Keep the README demo focused on actual interaction, not an exact symbolic Gaussian identity.
3. Remove stale “planned” wording for the implemented Fourier capability while leaving inverse transforms/DFT/etc. planned.
4. Check that unsupported backend messages and unresolved convergence diagnostics remain visible in the product.

## Verification checklist

Run, in this order:

1. focused mathcore Fourier/parser/inference tests;
2. focused app view/store/readout/keypad tests;
3. `pnpm demo:test`;
4. `pnpm lint`;
5. `pnpm typecheck`;
6. `pnpm test`;
7. `pnpm build`;
8. `pnpm verify`;
9. local `pnpm demo:rehearse transforms` and `pnpm demo:transforms` with the external Playwright repo;
10. final GIF/source asset validation and `git diff --check`.

The final handoff must report the feature commit(s), the demo asset paths, the CI command/FFmpeg setup, and any numerical limitation still intentionally shown to users.

