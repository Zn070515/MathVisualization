# Sampling, DFT, and Aliasing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real sampled-signal vertical slice with `DFT(f(t))`, shared sampling state, discrete spectrum bins, sample markers, and a refinement-based aliasing diagnostic.

**Architecture:** Add a dedicated `dft-transform` AST node and pure `estimateDft()` mathcore module. Keep continuous Fourier in its existing `frequency-domain` view, and add a separate `dft-domain` view that consumes a shared cached DFT estimate with the Cartesian sample markers and readout.

**Tech Stack:** TypeScript, Vitest, React 19, Vite, MathLive, the existing `@mathviz/mathcore` AST/evaluator/workspace, canvas renderers, and the existing Zustand-like mutable workspace store.

**Spec:** `docs/superpowers/specs/2026-09-23-sampling-dft-aliasing-design.md`

## Global Constraints

- Keep `DFT` distinct from the mathematical Fourier transform and the FFT algorithm.
- Use the half-open sampling grid `t_n = t_min + nΔt`, `n = 0 ... N-1`, with `Δt = (t_max - t_min) / N`.
- Use the time-integral-scaled forward DFT `D[k] = Δt Σ f(t_n)e^(-iω_k t_n)` and project frequencies in angular frequency `ω`.
- Use the single positive Nyquist representative for the even-`N` boundary; do not create a second negative-Nyquist bin.
- Compare primary signed bin `m` with refined signed bin `2m`; do not compare raw array positions without signed-index mapping.
- Bound direct computation with estimator `N` in `2, 4, ..., 512`, expose only `16, 32, 64, 128, 256, 512` in the UI, and enforce `2N <= 1024`.
- Treat refinement difference as a stability indicator, not a certified error bound or proof that aliasing exists or does not exist.
- Register DFT normalization, units, bins, and Nyquist convention in `packages/mathcore/src/conventions.ts`.
- Use TDD: every production behavior starts with a failing test that is run and observed before implementation.
- Do not modify `README.md` in this feature.
- Work directly on `main`; commit each completed task and push the completed feature to `origin/main` after the final verification gate.

---

## File map

### Mathcore

- Create `packages/mathcore/src/dft.ts`: sampling grid, direct DFT, refinement comparison, and diagnostic result.
- Create or extend `packages/mathcore/test/dft.test.ts`: syntax, inference, numerical reference, Nyquist, refinement, and unsupported-backend tests.
- Modify `packages/mathcore/src/ast.ts`: `DftTransformNode`, child traversal, and bound-variable collection.
- Modify `packages/mathcore/src/parser.ts` and `packages/mathcore/src/latex.ts`: `DFT(f(t))` parsing and validation.
- Modify `packages/mathcore/src/format.ts` and `packages/mathcore/src/latex.ts`: canonical plain and LaTeX printing.
- Modify `packages/mathcore/src/builtins.ts`: reserve `DFT` as transform syntax.
- Modify `packages/mathcore/src/infer.ts`: real-source validation and transform-pair classification.
- Modify `packages/mathcore/src/evaluator.ts`, `sympy.ts`, and `glsl.ts`: explicit non-pointwise/unsupported handling.
- Modify `packages/mathcore/src/conventions.ts`: centralized DFT convention entry.
- Modify `packages/mathcore/src/index.ts`: export the DFT module.

### App state and numerical sharing

- Create `packages/app/src/views/dftEvaluation.ts`: DFT selection, cache, projection, bin snapping, range helpers, and sample-marker data.
- Create `packages/app/test/dftEvaluation.test.ts`: app-level DFT selection, cache-key behavior, projection, and bin/readout consistency.
- Modify `packages/app/src/state/workspaceStore.ts`: shared `SamplingSettings`, defaults, setter, and persistence-facing state shape.
- Modify `packages/app/src/state/persistence.ts` and `packages/app/src/state/StoreProvider.tsx`: optional migration-safe sampling settings restoration.
- Modify `packages/app/src/state/viewKinds.ts`: DFT-aware preferred/default views and DFT mode defaults.
- Modify `packages/app/test/viewKinds.test.ts`, `workspaceStore.test.ts`, and `persistence.test.ts`: state and default-view gates.

### App views and controls

- Create `packages/app/src/views/DftDomainView.tsx`: discrete stem/point renderer, shared frequency cursor, sample controls, and stability diagnostics.
- Modify `packages/app/src/views/CartesianView.tsx`: draw sample markers from the shared DFT estimate without changing curve discontinuity handling.
- Modify `packages/app/src/views/ViewCanvas.tsx`: add exhaustive `dft-domain` title, renderer, mode handling, and toolbar behavior.
- Modify `packages/app/src/state/workspaceStore.ts` and related selector helpers: distinguish focused continuous Fourier and DFT pairs while retaining focused-expression precedence.
- Modify `packages/app/src/readout/ReadoutBar.tsx`: DFT bin readout with `k`, signed `k`, `ω_k`, `D[k]`, `Δt`, Nyquist, and stability.
- Modify `packages/app/src/subsystems.ts`: mark the implemented DFT/sampling capability available and retain FFT as a separate planned capability if applicable.
- Modify `packages/app/src/expression/keypad/transforms.ts` and `packages/app/test/keypad.test.tsx`: make DFT insertion live with the canonical operator spelling.

### Final validation

- No README changes.
- Existing Fourier tests remain unchanged in meaning and continue to pass.
- Run repository lint, typecheck, mathcore/app tests, build, and the existing tooling contract before commit/push.

---

### Task 1: Add the DFT AST and expression syntax

**Files:**
- Create: `packages/mathcore/test/dft.test.ts`
- Modify: `packages/mathcore/src/ast.ts`
- Modify: `packages/mathcore/src/parser.ts`
- Modify: `packages/mathcore/src/latex.ts`
- Modify: `packages/mathcore/src/format.ts`
- Modify: `packages/mathcore/src/builtins.ts`
- Modify: `packages/mathcore/src/infer.ts`
- Modify: `packages/mathcore/src/evaluator.ts`
- Modify: `packages/mathcore/src/sympy.ts`
- Modify: `packages/mathcore/src/glsl.ts`

**Interfaces:**
- Produce `DftTransformNode` with `kind: 'dft-transform'`, `source: Expr`, `sourceVariable: string`, and `span`.
- `parseExpression('DFT(f(t))')` and `parseLatexExpression('\\operatorname{DFT}(f(t))')` produce the same node shape.
- `collectVariableNames()` treats `sourceVariable` as bound, just as it does for `FourierTransformNode`.
- `classifyDefinitionWith()` returns the existing `transform-pair` kind with a DFT-specific description.

- [ ] **Step 1: Write failing syntax and backend tests.**

Add tests that assert:

```ts
const parsed = parseExpression('DFT(f(t))', {
  knownFunctions: new Set(['DFT', 'f']),
  knownValues: new Set(['t', 'ω']),
});
expect(parsed.ok && parsed.value.kind).toBe('dft-transform');
expect(parsed.ok && collectVariableNames(parsed.value)).toEqual([]);
```

Also test LaTeX parsing, canonical printing, rejection of `DFT(t^2)` and `DFT(f(t,t))`, real-source inference, and the three unsupported backends.

- [ ] **Step 2: Run the focused test and verify the expected red failure.**

Run:

```bash
pnpm --filter @mathviz/mathcore exec vitest run test/dft.test.ts
```

Expected: FAIL because `dft-transform` is not yet part of `Expr` or the parser.

- [ ] **Step 3: Implement the canonical node and all exhaustive consumers.**

Add `DftTransformNode` to `Expr`, return its source from `childNodes`, bind its source variable in `collectVariableNames`, and add the parser/LaTeX special cases. Print plain text as `DFT(...)` and LaTeX as `\\operatorname{DFT}\\left(...\\right)`. Add explicit numerical-transform rejection to the evaluator, SymPy, and GLSL switches instead of allowing a default branch to hide the new node.

- [ ] **Step 4: Run the focused tests and mathcore typecheck.**

Run:

```bash
pnpm --filter @mathviz/mathcore exec vitest run test/dft.test.ts
pnpm --filter @mathviz/mathcore typecheck
```

Expected: all DFT syntax/inference/backend tests pass and all exhaustive switches typecheck.

- [ ] **Step 5: Commit the syntax slice.**

```bash
git add packages/mathcore/src packages/mathcore/test/dft.test.ts
git commit -m "feat: add DFT expression syntax"
```

### Task 2: Implement and verify the direct DFT numerical contract

**Files:**
- Modify: `packages/mathcore/test/dft.test.ts`
- Create: `packages/mathcore/src/dft.ts`
- Modify: `packages/mathcore/src/conventions.ts`
- Modify: `packages/mathcore/src/index.ts`

**Interfaces:**
- `DftTimeWindow` reuses the same `{ min: number; max: number }` shape as `FourierTimeWindow` or is exported as a compatible alias.
- `DftBin` is `{ index: number; signedIndex: number; angularFrequency: number }`.
- `DftEstimateOptions` is `{ timeWindow: DftTimeWindow; sampleCount: number; tolerance?: number }`, with estimator sample counts restricted to powers of two from `2` through `512`.
- `DftEstimate` contains `samples`, `sampleTimes`, `bins`, `values`, `timeWindow`, `sampleCount`, `sampleInterval`, `samplingFrequency`, `nyquistAngularFrequency`, `estimatedError`, `stability`, and `diagnostics`.
- `estimateDft(transform: DftTransformNode, environment: EvaluationEnvironment, options: DftEstimateOptions): DftEstimate` performs the primary and refined estimates.

- [ ] **Step 1: Add failing numerical reference tests.**

Test these exact behaviors before writing `dft.ts`:

```ts
// constant signal: D[0] = Δt * N over [0, 4)
expect(estimate.values[0]).toEqual({ re: 4, im: 0 });

// grid metadata for [0, 4), N = 4
expect(estimate.sampleInterval).toBe(1);
expect(estimate.samplingFrequency).toBe(1);
expect(estimate.nyquistAngularFrequency).toBe(Math.PI);
expect(estimate.bins.map((bin) => bin.signedIndex)).toEqual([0, 1, 2, -1]);
```

Also add an on-grid sinusoid test, a `sin(3πt/2)` coarse-grid alias test on `[0,4)` with `N=4`, a `2N` refinement sensitivity assertion, a non-finite source test returning `unresolved`, and a `t_min !== 0` phase-preservation test.

- [ ] **Step 2: Run the focused numerical tests and verify red.**

Run:

```bash
pnpm --filter @mathviz/mathcore exec vitest run test/dft.test.ts
```

Expected: FAIL because `estimateDft` and the DFT result types do not exist.

- [ ] **Step 3: Add the centralized DFT convention and minimal estimator.**

Register the DFT normalization, angular-frequency units, signed-bin rule, and positive Nyquist boundary in `CONVENTIONS`. Implement half-open sampling, direct `O(N^2)` accumulation with the actual `t_n` in the exponential, signed-bin generation, `2N <= 1024` validation, non-finite source handling, and signed-index refinement matching.

- [ ] **Step 4: Run numerical tests, typecheck, and inspect diagnostics.**

Run:

```bash
pnpm --filter @mathviz/mathcore exec vitest run test/dft.test.ts
pnpm --filter @mathviz/mathcore typecheck
```

Expected: the numerical reference tests pass, aliasing is described only as sampling-sensitive, and no result reports a fabricated exact transform.

- [ ] **Step 5: Commit the numerical slice.**

```bash
git add packages/mathcore/src/dft.ts packages/mathcore/src/conventions.ts packages/mathcore/src/index.ts packages/mathcore/test/dft.test.ts
git commit -m "feat: add direct DFT estimation"
```

### Task 3: Add shared sampling state and one cached app estimate

**Files:**
- Create: `packages/app/src/views/dftEvaluation.ts`
- Create: `packages/app/test/dftEvaluation.test.ts`
- Modify: `packages/app/src/state/workspaceStore.ts`
- Modify: `packages/app/src/state/persistence.ts`
- Modify: `packages/app/src/state/StoreProvider.tsx`

**Interfaces:**
- `SamplingSettings` is `{ timeWindow: { min: number; max: number }; sampleCount: number }`.
- Export `DEFAULT_DFT_SAMPLING` with `timeWindow: { min: -8, max: 8 }` and `sampleCount: 64`.
- `selectDftTransform(active: ActiveExpression | null): DftTransformNode | null` selects only a focused `dft-transform` body.
- `estimateActiveDft(active, workspace, parameterValues, sampling): DftEstimate | null` caches by workspace, active entry id, parameter values, and all sampling fields.
- `projectDftValue`, `dftRange`, `snapDftBin`, and `sampleMarkerValues` are pure helpers used by both views.
- `DftBinReadout` contains one snapped `DftBin`, its exact complex value, magnitude, sample interval, Nyquist value, and stability; `readoutAtFrequency(estimate, frequency)` returns it or `null`.

- [ ] **Step 1: Write failing app-state and cache tests.**

Test that DFT selection ignores a continuous Fourier body, default sampling is deterministic, changing `sampleCount` changes `sampleInterval`, and repeated calls with identical workspace/parameters/settings return the same cached estimate object. Test `snapDftBin()` returns a real bin and never an interpolated frequency.

- [ ] **Step 2: Run the focused app tests and verify red.**

Run:

```bash
pnpm --filter @mathviz/app exec vitest run test/dftEvaluation.test.ts test/workspaceStore.test.ts
```

Expected: FAIL because sampling state and DFT evaluation helpers are absent.

- [ ] **Step 3: Add sampling state, persistence, and cache.**

Add `sampling` to `WorkspaceState`, initialize it in `createInitialState`, add `setSamplingSettings`, persist it as an optional field, and restore it only after validating finite increasing windows and allowed sample counts. Keep old sessions valid by falling back to `DEFAULT_DFT_SAMPLING`. Implement the cache in `dftEvaluation.ts` using `workspaceEnvironment()` and the mathcore estimator.

- [ ] **Step 4: Run focused tests and app typecheck.**

Run:

```bash
pnpm --filter @mathviz/app exec vitest run test/dftEvaluation.test.ts test/workspaceStore.test.ts test/persistence.test.ts
pnpm --filter @mathviz/app typecheck
```

Expected: state, persistence, cache, and bin-snap tests pass.

- [ ] **Step 5: Commit the shared-state slice.**

```bash
git add packages/app/src/state packages/app/src/views/dftEvaluation.ts packages/app/test/dftEvaluation.test.ts packages/app/test/workspaceStore.test.ts packages/app/test/persistence.test.ts
git commit -m "feat: share DFT sampling state"
```

### Task 4: Make view inference distinguish continuous Fourier and DFT pairs

**Files:**
- Modify: `packages/app/src/state/viewKinds.ts`
- Modify: `packages/app/src/state/workspaceStore.ts`
- Modify: `packages/app/src/state/persistence.ts`
- Modify: `packages/app/src/views/ViewCanvas.tsx`
- Modify: `packages/app/test/viewKinds.test.ts`
- Modify: `packages/app/test/workspaceStore.test.ts`

**Interfaces:**
- Add `ViewKind = 'dft-domain'` without changing the meaning of `'frequency-domain'`.
- Add a small `TransformViewKind = 'fourier' | 'dft'` discriminator derived from the active function-definition body.
- `preferredViewKinds`, `drawableViewKinds`, `defaultViewKinds`, and `defaultModeForView` accept the discriminator so a DFT pair returns `['cartesian-2d', 'dft-domain']` and a Fourier pair remains `['cartesian-2d', 'frequency-domain']`.
- `ViewCanvas` remains exhaustive over all `ViewKind` values.

- [ ] **Step 1: Write failing view inference tests.**

Build workspaces containing `F(ω)=Fourier(f(t))` and `D(ω)=DFT(f(t))`, then assert their default view blueprints differ exactly as specified. Assert `dft-domain` defaults to `magnitude`, is available, and survives persistence migration.

- [ ] **Step 2: Run the view tests and verify red.**

Run:

```bash
pnpm --filter @mathviz/app exec vitest run test/viewKinds.test.ts test/workspaceStore.test.ts test/persistence.test.ts
```

Expected: FAIL because the new view kind and transform discriminator do not exist.

- [ ] **Step 3: Implement the discriminator and exhaustive view wiring.**

Derive the discriminator from the active statement body rather than from the generic `transform-pair` classification. Add `dft-domain` to statuses, defaults, persistence migration, renderer title, mode set, and add-view logic. Preserve focused-expression precedence when multiple transform pairs exist.

- [ ] **Step 4: Run focused tests and typecheck.**

Run:

```bash
pnpm --filter @mathviz/app exec vitest run test/viewKinds.test.ts test/workspaceStore.test.ts test/persistence.test.ts
pnpm --filter @mathviz/app typecheck
```

Expected: DFT and continuous Fourier open with distinct default views and all view dispatch switches compile.

- [ ] **Step 5: Commit the view taxonomy slice.**

```bash
git add packages/app/src/state packages/app/src/views/ViewCanvas.tsx packages/app/test/viewKinds.test.ts packages/app/test/workspaceStore.test.ts packages/app/test/persistence.test.ts
git commit -m "feat: add a dedicated DFT view kind"
```

### Task 5: Render samples and the discrete spectrum

**Files:**
- Create: `packages/app/src/views/DftDomainView.tsx`
- Modify: `packages/app/src/views/CartesianView.tsx`
- Modify: `packages/app/src/views/ViewCanvas.tsx`
- Modify: `packages/app/src/views/dftEvaluation.ts`
- Modify: `packages/app/test/dftEvaluation.test.ts`

**Interfaces:**
- `DftDomainView` consumes `estimateActiveDft()` and the shared `frequencyHover`, `frequencySelection`, `frequencyViewport`, and `sampling` state.
- `sampleMarkerValues()` returns finite `(t, value)` pairs from the same `DftEstimate.samples` and `sampleTimes` consumed by the DFT renderer.
- `snapDftBin()` returns `{ bin, value }` or `null`, so the cursor cannot label one frequency with another bin's value.

- [ ] **Step 1: Add failing pure rendering-data tests.**

Test that sample marker data has exactly `N` time/value pairs for a finite source, excludes non-finite samples without joining across them, and that a requested frequency snaps to the actual bin whose `angularFrequency` is returned in the readout. Test all four projection modes, including null phase at zero magnitude.

- [ ] **Step 2: Run the focused tests and verify red.**

Run:

```bash
pnpm --filter @mathviz/app exec vitest run test/dftEvaluation.test.ts
```

Expected: FAIL because the DFT view data helpers and sample overlay do not exist.

- [ ] **Step 3: Implement the DFT canvas and time-domain overlay.**

Render axes in angular frequency, draw each projected bin as a stem and point, snap pointer updates to real bins, preserve the explicit frequency viewport, and show `N`, `Δt`, sampling frequency, Nyquist, refinement status, and diagnostics. In `CartesianView`, draw finite sample markers over the existing source curve without changing its existing null/non-finite segment breaks.

- [ ] **Step 4: Run pure tests and app typecheck.**

Run:

```bash
pnpm --filter @mathviz/app exec vitest run test/dftEvaluation.test.ts
pnpm --filter @mathviz/app typecheck
```

Expected: all sample/bin helper tests pass and the renderer is included in exhaustive view dispatch.

- [ ] **Step 5: Commit the rendering slice.**

```bash
git add packages/app/src/views/DftDomainView.tsx packages/app/src/views/CartesianView.tsx packages/app/src/views/ViewCanvas.tsx packages/app/src/views/dftEvaluation.ts packages/app/test/dftEvaluation.test.ts
git commit -m "feat: visualize DFT samples and bins"
```

### Task 6: Add DFT readout, controls, and live keypad entry

**Files:**
- Modify: `packages/app/src/readout/ReadoutBar.tsx`
- Modify: `packages/app/src/views/DftDomainView.tsx`
- Modify: `packages/app/src/expression/keypad/transforms.ts`
- Modify: `packages/app/src/subsystems.ts`
- Modify: `packages/app/test/keypad.test.tsx`
- Modify: `packages/app/test/dftEvaluation.test.ts`

**Interfaces:**
- DFT readout consumes the same snapped bin object used by `DftDomainView`; it must not recompute a spectrum or nearest-value lookup independently.
- Sample-count controls call `store.setSamplingSettings()` with only values from `16, 32, 64, 128, 256, 512`.
- The live keypad inserts `\\operatorname{DFT}\\left(#?\\right)` and the parser canonicalizes it to `DFT(...)`.

- [ ] **Step 1: Write failing readout/control/keypad tests.**

Add a keypad assertion that the DFT key is live and produces a parseable DFT node. Add pure assertions for `readoutAtFrequency()` proving the readout includes `k`, signed `k`, `ω_k`, `D[k]`, `Δt`, Nyquist, and stability from one snapped bin/estimate pair, and that changing `N` invalidates the old cached estimate key.

- [ ] **Step 2: Run focused tests and verify red.**

Run:

```bash
pnpm --filter @mathviz/app exec vitest run test/keypad.test.tsx test/dftEvaluation.test.ts
```

Expected: FAIL because the DFT keypad entry, readout branch, and sample controls are absent.

- [ ] **Step 3: Implement the shared readout and controls.**

Branch in `ReadoutBar` on `selectDftTransform(active)`, use `readoutAtFrequency()` so the snapped bin's own `angularFrequency` and value are displayed, and display refinement status as stability information rather than exactness. Add the sample-count control to `DftDomainView`; keep the time window unchanged when `N` changes. Promote the DFT/sampling capability and keypad row from planned to available/live without changing other planned transform keys.

- [ ] **Step 4: Run focused tests and app build checks.**

Run:

```bash
pnpm --filter @mathviz/app exec vitest run test/keypad.test.tsx test/dftEvaluation.test.ts
pnpm --filter @mathviz/app typecheck
pnpm --filter @mathviz/app build
```

Expected: DFT input, controls, readout, and production bundling pass without changing continuous Fourier behavior.

- [ ] **Step 5: Commit the interaction slice.**

```bash
git add packages/app/src/readout/ReadoutBar.tsx packages/app/src/views/DftDomainView.tsx packages/app/src/expression/keypad/transforms.ts packages/app/test/keypad.test.tsx packages/app/test/dftEvaluation.test.ts
git commit -m "feat: add DFT controls and readout"
```

### Task 7: Run the complete correctness gate and push

**Files:**
- Modify only files required by failing verification; do not broaden scope or change `README.md`.

- [ ] **Step 1: Run the complete test and static gates.**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:tooling
pnpm build
```

Expected: all existing Fourier, contour, calculus, persistence, keypad, and new DFT tests pass.

- [ ] **Step 2: Run the DFT-specific regression set once more.**

Run:

```bash
pnpm --filter @mathviz/mathcore exec vitest run test/dft.test.ts
pnpm --filter @mathviz/app exec vitest run test/dftEvaluation.test.ts test/viewKinds.test.ts test/workspaceStore.test.ts test/persistence.test.ts test/keypad.test.tsx
```

Expected: the aliasing example reports sampling sensitivity under refinement, not a theorem-level claim about the continuous source.

- [ ] **Step 3: Inspect the final diff and repository status.**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~6..HEAD
```

Expected: no whitespace errors, no generated artifacts, no README changes, and only the DFT feature files are included.

- [ ] **Step 4: Push the completed feature directly to main.**

```bash
git push origin main
```

Report the final commit SHA and the exact verification commands/results.
