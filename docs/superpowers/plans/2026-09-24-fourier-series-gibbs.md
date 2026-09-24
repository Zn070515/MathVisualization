# Fourier Series and Gibbs Phenomenon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an expression-first, numerically honest real Fourier-series partial-sum view, including a reproducible `sign(sin(u))` Gibbs example, without presenting numerical evidence as exact coefficients or a convergence theorem.

**Architecture:** Add a `FourierSeriesNode` to the shared AST and a pure
`fourierSeries.ts` numerical kernel. The application will classify series definitions as
`series-pair`, select them with the same focus/source rules as existing transform pairs,
and render a dedicated `series-domain` view backed by shared series settings and a
nullable persistent series viewport. The source signal and partial sum will share the
existing real-axis point state, while frequency cursors remain separate.

**Tech Stack:** TypeScript, Vitest, React 19, Testing Library, Vite, MathLive LaTeX adapter, WebGL2 lowering, localStorage persistence.

**Spec:** `docs/superpowers/specs/2026-09-24-fourier-series-gibbs-design.md`

## Global Constraints

- Use `FourierSeries(f(u), 2π)` as the canonical operation shape; `u` is bound for coefficient integration and the containing function parameter is the evaluation variable.
- Period expressions may use constants/workspace parameters, but not the source integration variable or the outer evaluation variable.
- The real trigonometric convention is `a₀ = (2/P)∫f`, `aₙ = (2/P)∫f cos(nω₀u)`, `bₙ = (2/P)∫f sin(nω₀u)`, with `Sₙ = a₀/2 + Σ(aₙcos + bₙsin)`.
- Use `Q_eff = max(requestedIntegrationSampleCount, 4 * order)` and report requested, base, and refined counts separately.
- Refinement disagreement is a scale-aware numerical indicator, never a rigorous error bound or exact convergence claim.
- A failed base/refined sample produces an unresolved estimate and no fabricated partial-sum curve.
- `sign(x)` is real-only and uses `-1, 0, +1` for negative, zero, and positive real inputs.
- `seriesViewport` is nullable: `null` derives a centered one-period frame; user pan/zoom/Fit stores an explicit frame; Reset clears it.
- Do not modify README or regenerate GIFs in this feature.
- Every production change starts with a failing test, followed by a targeted green run; keep commits small and push completed commits to `origin/main`.

## Pre-implementation audit findings

The approved spec was checked against the current repository before this plan was
written. These are resolved in the tasks below rather than assumed to already exist:

- `MathObjectKind` currently has `transform-pair` and `convolution-pair`, but no
  `series-pair`; classification and focus selection must be extended explicitly.
- `ViewKind` and `VIEW_RENDERERS` are exhaustive and currently have no
  `series-domain`; adding the renderer requires updating the status, title, dispatch,
  persistence migration, and view inference tables together.
- `WorkspaceState` persists `sampling`, `frequencyViewport`, and
  `convolutionViewport`, but no series settings or viewport; both must be added to
  construction, restore, save, and validation paths.
- The parser/LaTeX adapter special-case `Fourier`, `DFT`, and `Convolution`; adding a
  generic builtin name alone would produce a call node, not a series AST node.
- `collectVariableNames`, `childNodes`, `format`, evaluator, GLSL, and SymPy all have
  exhaustive transform cases and must receive the new node explicitly.
- `ReadoutBar` currently evaluates a point through `store.sourceExpression()` and has
  separate frequency branches; it needs a series branch so the plotted source and
  computed partial sum use the same estimate.
- The current builtin space rules do not include a real-only rule; `sign` requires a
  type-inference rule in addition to evaluator and shader entries.
- The centered-period Fourier coefficient formulas are mathematically correct, but a
  fixed `Q` without the `4N` floor can alias high harmonics. The plan therefore treats
  `Q_eff` as part of the numerical contract, not as a UI suggestion.

---

### Task 1: Add the real-only `sign` builtin

**Files:**
- Modify: `packages/mathcore/src/builtins.ts`
- Modify: `packages/mathcore/src/infer.ts`
- Modify: `packages/mathcore/src/evaluator.ts`
- Modify: `packages/mathcore/src/glsl.ts`
- Test: `packages/mathcore/test/builtins.test.ts` (create)
- Test: `packages/mathcore/test/infer.test.ts`
- Test: `packages/mathcore/test/evaluator.test.ts`
- Test: `packages/mathcore/test/glsl.test.ts`

**Interfaces:**
- Produce `SpaceRule = 'real-only'` and a registered builtin `{ name: 'sign', arity: 1, ... }`.
- Produce evaluator semantics `sign(x): Result<Complex, MathIssue>` with real input only.
- Produce GLSL helper `signToComplex(vec2): vec2` that returns a runtime undefined value for non-real input.

- [ ] **Step 1: Write failing tests.** Add assertions for `sign(-2) = -1`, `sign(0) = 0`, `sign(2) = 1`, and `sign(1+i)` returning a domain/dimension issue. Add inference assertions that `sign(x)` is real for a real variable and `sign(z)` is rejected for a complex variable. Add a GLSL lowering assertion that the generated source contains `signToComplex`.

```ts
expect(evaluate(parseExpr('sign(-2)'), environment)).toEqual({ ok: true, value: cx(-1, 0) });
expect(evaluate(parseExpr('sign(1 + i)'), environment)).toMatchObject({ ok: false });
expect(inferSpace(parseExpr('sign(x)'), realContext).value).toEqual(R1);
expect(inferSpace(parseExpr('sign(z)'), complexContext)).toMatchObject({ ok: false });
```

- [ ] **Step 2: Run the focused tests and verify RED.**

Run: `pnpm --filter @mathviz/mathcore exec vitest run test/builtins.test.ts test/infer.test.ts test/evaluator.test.ts test/glsl.test.ts`

Expected: failures because `sign` is not registered and `real-only` is not a current space rule.

- [ ] **Step 3: Implement the minimum builtin path.** Add `real-only` to the builtin rule union and reject any argument whose inferred space is not `R¹`. In the evaluator, reject a nonzero imaginary component and return `cx(Math.sign(value.re), 0)` otherwise. Add the GLSL mapping and a helper that only evaluates the real component when the imaginary component is zero.

- [ ] **Step 4: Run focused tests and verify GREEN.**

Run: `pnpm --filter @mathviz/mathcore exec vitest run test/builtins.test.ts test/infer.test.ts test/evaluator.test.ts test/glsl.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Commit.**

```bash
git add packages/mathcore/src/builtins.ts packages/mathcore/src/infer.ts packages/mathcore/src/evaluator.ts packages/mathcore/src/glsl.ts packages/mathcore/test/builtins.test.ts packages/mathcore/test/infer.test.ts packages/mathcore/test/evaluator.test.ts packages/mathcore/test/glsl.test.ts
git commit -m "feat: add real sign builtin"
git push origin main
```

### Task 2: Add `FourierSeriesNode` to the canonical language

**Files:**
- Modify: `packages/mathcore/src/ast.ts`
- Modify: `packages/mathcore/src/builtins.ts`
- Modify: `packages/mathcore/src/parser.ts`
- Modify: `packages/mathcore/src/latex.ts`
- Modify: `packages/mathcore/src/format.ts`
- Modify: `packages/mathcore/src/index.ts`
- Test: `packages/mathcore/test/parser.test.ts`
- Test: `packages/mathcore/test/latex.test.ts`
- Test: `packages/mathcore/test/format.test.ts` (create)

**Interfaces:**
- Produce:

```ts
export interface FourierSeriesNode {
  readonly kind: 'fourier-series';
  readonly source: Expr;
  readonly sourceVariable: string;
  readonly period: Expr;
  readonly span: SourceSpan;
}
```

- Extend `Expr`, `childNodes`, `collectVariableNames`, text formatting, LaTeX printing, and the transform-name registry.
- The parser accepts exactly two arguments: a unary source call and a period expression.

- [ ] **Step 1: Write failing parser/round-trip tests.** Cover plain `FourierSeries(f(u), 2*pi)`, LaTeX `\operatorname{FourierSeries}(f(u),2\pi)`, printed AST containing the period, rejection of non-unary sources, rejection of missing period, and rejection when the source argument is not a single explicit variable.

```ts
const parsed = parseStatement('S(t) = FourierSeries(f(u), 2*pi)', options);
expect(parsed.value?.body).toMatchObject({
  kind: 'fourier-series',
  sourceVariable: 'u',
  period: { kind: 'binary', op: 'mul' },
});
expect(exprToLatex((parsed.value as FunctionDefinition).body)).toContain('FourierSeries');
```

- [ ] **Step 2: Run parser and LaTeX tests and verify RED.**

Run: `pnpm --filter @mathviz/mathcore exec vitest run test/parser.test.ts test/latex.test.ts test/format.test.ts`

Expected: failures because the current parser treats `FourierSeries` as an ordinary call or rejects the operation-specific shape.

- [ ] **Step 3: Implement the AST and parser branches.** Add the node, register `FourierSeries` as a known function, parse its two arguments, require the first argument to be a unary call with an explicit variable, and preserve the period expression in the node. Update LaTeX operator-name maps and printers to round-trip the same structure.

- [ ] **Step 4: Implement bound-variable traversal and formatting.** Visit the source under a set containing `sourceVariable`; visit the period under the outer binding set so an illegal source-variable dependency remains visible to the period-dependency validation in Task 3. Print `FourierSeries(source, period)` without dropping parentheses around an additive period.

- [ ] **Step 5: Run focused tests and verify GREEN.**

Run: `pnpm --filter @mathviz/mathcore exec vitest run test/parser.test.ts test/latex.test.ts test/format.test.ts`

Expected: all parser, LaTeX, free-variable, and format tests pass.

- [ ] **Step 6: Commit.**

```bash
git add packages/mathcore/src/ast.ts packages/mathcore/src/builtins.ts packages/mathcore/src/parser.ts packages/mathcore/src/latex.ts packages/mathcore/src/format.ts packages/mathcore/src/index.ts packages/mathcore/test/parser.test.ts packages/mathcore/test/latex.test.ts packages/mathcore/test/format.test.ts
git commit -m "feat: add Fourier series AST syntax"
git push origin main
```

### Task 3: Type, classify, and reject non-pointwise handling of series nodes

**Files:**
- Modify: `packages/mathcore/src/types.ts`
- Modify: `packages/mathcore/src/infer.ts`
- Modify: `packages/mathcore/src/evaluator.ts`
- Modify: `packages/mathcore/src/glsl.ts`
- Modify: `packages/mathcore/src/sympy.ts`
- Test: `packages/mathcore/test/infer.test.ts`
- Test: `packages/mathcore/test/workspace.test.ts`
- Test: `packages/mathcore/test/evaluator.test.ts`
- Test: `packages/mathcore/test/sympy.test.ts`
- Test: `packages/mathcore/test/glsl.test.ts`

**Interfaces:**
- Add `MathObjectKind = 'series-pair'`.
- `classifyDefinitionWith` returns:

```ts
{
  kind: 'series-pair',
  description: 'A real periodic signal and its numerical Fourier-series partial sum'
}
```

- `inferSpace(FourierSeriesNode)` returns `R¹` only for a real unary source and a real scalar period.
- Add a validation helper that rejects period free names matching `sourceVariable` or any outer function parameter with `invalid-parameter`; workspace parameter names and builtin constants remain valid.
- Evaluating a series node through the ordinary scalar evaluator, GLSL lowering, or SymPy lowering returns explicit `unsupported` issues explaining that it requires the numerical series backend.

- [ ] **Step 1: Write failing type/classification/backend tests.** Test valid `S(t)=FourierSeries(f(u),2*pi)` as `R → R` and `series-pair`; reject `f: R→C`, `P=t`, and `P=u`. Test the three backend adapters return unsupported instead of silently treating the node as a pointwise value.

- [ ] **Step 2: Run focused tests and verify RED.**

Run: `pnpm --filter @mathviz/mathcore exec vitest run test/infer.test.ts test/workspace.test.ts test/evaluator.test.ts test/sympy.test.ts test/glsl.test.ts`

Expected: failures because the new node is not currently handled by inference, classification, or exhaustive backend switches.

- [ ] **Step 3: Implement inference and classification.** Mirror the existing Fourier/DFT source-call validation, add period-space validation, check period dependencies against definition parameters/source variable, and classify valid definitions as `series-pair`.

- [ ] **Step 4: Implement explicit backend refusals.** Add exhaustive cases to evaluator, GLSL, and SymPy with diagnostics that distinguish a finite numerical Fourier-series estimate from a pointwise shader or symbolic operation.

- [ ] **Step 5: Run focused tests and verify GREEN.**

Run: `pnpm --filter @mathviz/mathcore exec vitest run test/infer.test.ts test/workspace.test.ts test/evaluator.test.ts test/sympy.test.ts test/glsl.test.ts`

Expected: all focused tests pass with no generic fall-through behavior.

- [ ] **Step 6: Commit.**

```bash
git add packages/mathcore/src/types.ts packages/mathcore/src/infer.ts packages/mathcore/src/evaluator.ts packages/mathcore/src/glsl.ts packages/mathcore/src/sympy.ts packages/mathcore/test/infer.test.ts packages/mathcore/test/workspace.test.ts packages/mathcore/test/evaluator.test.ts packages/mathcore/test/sympy.test.ts packages/mathcore/test/glsl.test.ts
git commit -m "feat: type Fourier series expressions"
git push origin main
```

### Task 4: Implement the numerical Fourier-series kernel

**Files:**
- Create: `packages/mathcore/src/fourierSeries.ts`
- Modify: `packages/mathcore/src/index.ts`
- Test: `packages/mathcore/test/fourierSeries.test.ts` (create)

**Interfaces:**

```ts
export interface FourierSeriesEstimateOptions {
  readonly order: number;
  readonly integrationSampleCount: number;
  readonly tolerance?: number;
}

export interface FourierSeriesEstimate {
  readonly period: number | null;
  readonly order: number;
  readonly requestedIntegrationSampleCount: number;
  readonly baseIntegrationIntervals: number;
  readonly refinedIntegrationIntervals: number;
  readonly constantCoefficient: number | null;
  readonly cosineCoefficients: readonly number[];
  readonly sineCoefficients: readonly number[];
  readonly coefficientDisagreement: number;
  readonly convergence: 'converged' | 'unresolved';
  readonly diagnostics: readonly string[];
  readonly unresolvedSamples: number;
}

export function estimateFourierSeries(
  transform: FourierSeriesNode,
  environment: EvaluationEnvironment,
  options: FourierSeriesEstimateOptions,
): FourierSeriesEstimate;

export function evaluateFourierSeriesAt(
  estimate: FourierSeriesEstimate,
  time: number,
): number | null;
```

- [ ] **Step 1: Write failing numerical tests.** Cover a constant source (`a₀` only), `cos(u)` (`a₁` only), `sign(sin(u))` odd sine coefficients, `Q_eff = max(Q,4N)`, centered period, scale-aware convergence, and `evaluateFourierSeriesAt`.

```ts
const estimate = estimateFourierSeries(seriesNode, workspaceEnvironment(workspace), {
  order: 5,
  integrationSampleCount: 4,
});
expect(estimate.baseIntegrationIntervals).toBe(20);
expect(estimate.refinedIntegrationIntervals).toBe(40);
expect(estimate.sineCoefficients[0]).toBeCloseTo(4 / Math.PI, 3);
```

- [ ] **Step 2: Write failing unresolved tests.** Cover invalid order/count, non-positive/non-finite period, a source domain error on the base grid, and a source domain error only on the refined grid. Assert `constantCoefficient === null`, empty coefficient arrays, `convergence === 'unresolved'`, finite diagnostics, and no usable partial sum.

- [ ] **Step 3: Run the new core test file and verify RED.**

Run: `pnpm --filter @mathviz/mathcore exec vitest run test/fourierSeries.test.ts`

Expected: module/function import failures because the numerical kernel does not exist.

- [ ] **Step 4: Implement period and option validation.** Evaluate `transform.period` in the supplied environment, require a finite positive real scalar, require a positive integer order, and compute `base = max(requested, 4 * order)` and `refined = 2 * base`.

- [ ] **Step 5: Implement one-grid coefficient sampling.** For each grid point `u_j = -P/2 + jP/Q`, evaluate the source with the node's bound variable set to `cx(u_j,0)`. Accumulate trapezoid-weighted `a₀`, `aₙ`, and `bₙ`; count unresolved/non-finite samples and return an unresolved estimate immediately if any grid point cannot produce a finite real source value.

- [ ] **Step 6: Implement refinement and partial-sum evaluation.** Compute base and refined coefficients, return the refined coefficient set, calculate the maximum absolute coefficient disagreement, compare it against `tolerance * max(1, largest refined coefficient magnitude)`, and evaluate the trigonometric partial sum only for finite time and a completed estimate.

- [ ] **Step 7: Run numerical tests and verify GREEN.**

Run: `pnpm --filter @mathviz/mathcore exec vitest run test/fourierSeries.test.ts`

Expected: all coefficient, refinement, unresolved, and partial-sum tests pass.

- [ ] **Step 8: Commit.**

```bash
git add packages/mathcore/src/fourierSeries.ts packages/mathcore/src/index.ts packages/mathcore/test/fourierSeries.test.ts
git commit -m "feat: add numerical Fourier series estimator"
git push origin main
```

### Task 5: Add shared series settings, classification selection, and persistence

**Files:**
- Modify: `packages/app/src/state/workspaceStore.ts`
- Modify: `packages/app/src/state/persistence.ts`
- Modify: `packages/app/src/state/StoreProvider.tsx`
- Modify: `packages/app/src/subsystems.ts`
- Modify: `packages/app/src/expression/ExpressionRow.tsx`
- Test: `packages/app/test/workspaceStore.test.ts`
- Test: `packages/app/test/persistence.test.ts`
- Test: `packages/app/test/subsystems.test.ts`

**Interfaces:**

```ts
export interface FourierSeriesSettings {
  readonly order: number;
  readonly integrationSampleCount: number;
}

export const FOURIER_SERIES_SAMPLE_COUNTS = [32, 64, 128, 256, 512] as const;
export const DEFAULT_FOURIER_SERIES_SETTINGS = { order: 16, integrationSampleCount: 64 };
export function isFourierSeriesOrder(value: number): boolean;
export function isFourierSeriesSampleCount(value: number): boolean;

export interface SeriesViewport {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}
```

Add `seriesSettings: FourierSeriesSettings` and `seriesViewport: SeriesViewport | null`
to `WorkspaceState`, constructor defaults, `restore`, setters, reset behavior, and
the persisted workspace shape. Persisted series values must be optional for old records
and validated before use.

- [ ] **Step 1: Write failing state/persistence tests.** Assert defaults, rejection of invalid order/count, round-trip of settings, null viewport restoration, valid viewport restoration, and dropping malformed persisted values. Add a `series-pair` classification test to workspace analysis.

- [ ] **Step 2: Run focused app tests and verify RED.**

Run: `pnpm --filter @mathviz/app exec vitest run test/workspaceStore.test.ts test/persistence.test.ts test/subsystems.test.ts`

Expected: failures because the state shape and classification do not contain series fields or kinds.

- [ ] **Step 3: Implement state and persistence.** Add validated setters `setFourierSeriesSettings`, `setSeriesViewport`, and `resetSeriesViewport`; save/load them through `StoreProvider` and `persistence.ts` without bumping the storage key because all additions are optional and backward-compatible.

- [ ] **Step 4: Implement series selection.** Extend `selectActiveExpression`, focused-source pairing, `selectSourceExpression`, and the transforms drawable kinds so a focused series definition wins, its focused source selects its own pair, and a multi-series workspace never falls back to the first series when focus identifies another one. Leave view-kind routing to Task 7 so this task remains testable without an unregistered renderer.

- [ ] **Step 5: Implement classification metadata.** Add `series-pair` to the object-kind labels and transforms `drawableKinds`; leave the capability itself planned until Task 9. Keep the existing Cartesian fallback until Task 7 wires the dedicated `series-domain` renderer.

- [ ] **Step 6: Run focused tests and verify GREEN.**

Run: `pnpm --filter @mathviz/app exec vitest run test/workspaceStore.test.ts test/persistence.test.ts test/subsystems.test.ts`

Expected: state, persistence, focus, and classification tests pass; series definitions may still use the ordinary Cartesian fallback until Task 7 wires the dedicated renderer.

- [ ] **Step 7: Commit.**

```bash
git add packages/app/src/state/workspaceStore.ts packages/app/src/state/persistence.ts packages/app/src/state/StoreProvider.tsx packages/app/src/subsystems.ts packages/app/src/expression/ExpressionRow.tsx packages/app/test/workspaceStore.test.ts packages/app/test/persistence.test.ts packages/app/test/subsystems.test.ts
git commit -m "feat: add shared Fourier series state"
git push origin main
```

### Task 6: Add application-level series estimation and caching

**Files:**
- Create: `packages/app/src/views/seriesEvaluation.ts`
- Test: `packages/app/test/seriesEvaluation.test.ts` (create)

**Interfaces:**

```ts
export function selectFourierSeries(active: ActiveExpression | null): FourierSeriesNode | null;

export function estimateActiveFourierSeries(
  active: ActiveExpression | null,
  workspace: Workspace,
  parameterValues: ReadonlyMap<string, number>,
  settings: FourierSeriesSettings,
): FourierSeriesEstimate | null;

export function initialSeriesViewport(
  period: number,
  measuredY: { readonly min: number; readonly max: number },
): SeriesViewport;

export function fitSeriesViewport(
  current: SeriesViewport,
  estimate: FourierSeriesEstimate,
  sourceRange: { readonly min: number; readonly max: number },
): SeriesViewport | null;
```

- [ ] **Step 1: Write failing evaluation tests.** Test active series selection, cache identity for unchanged workspace/parameters/settings, cache invalidation on order and parameter changes, initial centered-period frame, and explicit Fit frame validity.

- [ ] **Step 2: Run the focused test and verify RED.**

Run: `pnpm --filter @mathviz/app exec vitest run test/seriesEvaluation.test.ts`

Expected: import/function failures because the application adapter does not exist.

- [ ] **Step 3: Implement series selection and environment creation.** Mirror `frequencyEvaluation.ts`: require a `series-pair`, pass workspace function definitions and live real parameter values to the core environment, and return null for non-series active entries.

- [ ] **Step 4: Implement cache keys.** Include active entry identity, parameter values, order, and requested integration count; do not include pointer/viewport state. Return the same estimate object for identical keys so the view and readout share one mathematical result.

- [ ] **Step 5: Implement frame helpers.** Derive `[-P/2,P/2]` when `seriesViewport` is null and produce a finite y-range from source/partial measurements. Fit must preserve valid increasing bounds and never silently overwrite the current frame during parameter/order changes.

- [ ] **Step 6: Run focused tests and verify GREEN.**

Run: `pnpm --filter @mathviz/app exec vitest run test/seriesEvaluation.test.ts`

Expected: all selection, caching, and frame helper tests pass.

- [ ] **Step 7: Commit.**

```bash
git add packages/app/src/views/seriesEvaluation.ts packages/app/test/seriesEvaluation.test.ts
git commit -m "feat: cache Fourier series estimates"
git push origin main
```

### Task 7: Render the linked `series-domain` view

**Files:**
- Create: `packages/app/src/views/SeriesDomainView.tsx`
- Modify: `packages/app/src/views/ViewCanvas.tsx`
- Modify: `packages/app/src/state/viewKinds.ts`
- Modify: `packages/app/src/state/workspaceStore.ts`
- Modify: `packages/app/src/state/persistence.ts`
- Modify: `packages/app/src/subsystems.ts`
- Test: `packages/app/test/seriesDomainView.test.tsx` (create)

**Interfaces:**
- `SeriesDomainView` implements `ViewRendererProps` and consumes `estimateActiveFourierSeries`, `sourceExpression`, `seriesSettings`, `seriesViewport`, and `setHover/setSelection`.
- Pointer x coordinates map to `t` in the active series frame and call `store.setHover(cx(t, 0))`; pointer leave calls `store.clearCursor()`.

- [ ] **Step 1: Write failing view tests.** Render a real series workspace and assert the dedicated view exists, the source and partial-sum canvas is present, order/integration controls are visible, diagnostics state the period and requested/effective quadrature counts, and changing order calls shared state without changing the frame. Render an unresolved source and assert no partial-sum curve path is claimed and the diagnostic is visible.

```ts
expect(screen.getByRole('img', { name: /Fourier series partial sums/i })).toBeTruthy();
expect(screen.getByLabelText('Fourier series order')).toBeTruthy();
expect(screen.getByText(/Q_eff/i)).toBeTruthy();
```

- [ ] **Step 2: Run the focused view test and verify RED.**

Run: `pnpm --filter @mathviz/app exec vitest run test/seriesDomainView.test.tsx`

Expected: failures because `series-domain` has no renderer or view component.

- [ ] **Step 3: Wire the exhaustive view registry.** Add `series-domain` to `ViewKind`, the persistence migration allowlist, the title `Fourier series partial sums`, the renderer record, and transforms view inference. Make it available only after the renderer exists, and do not offer a mode selector for this view.

- [ ] **Step 4: Implement sampling and strokes.** Use the current frame for both curves, evaluate the source through the existing point evaluator, evaluate the partial sum through the cached estimate, and reset a stroke segment on any undefined/non-finite sample. Draw source and partial sum with distinct existing canvas colors.

- [ ] **Step 5: Implement controls and diagnostics.** Add validated order and requested integration-count controls, show `P`, `N`, requested `Q`, effective `Q_eff`, refined `2Q_eff`, coefficient disagreement, and convergence state. Use “sampling-sensitive” or “unresolved” rather than “exact”, “certified”, or “Gibbs detected”. Add an explicit Fit button and keep the frame persistent across estimate changes.

- [ ] **Step 6: Implement pointer linking.** Convert pointer positions to `cx(t,0)` and use the existing shared hover/selection methods. Do not write to `frequencyHover` or `frequencySelection`.

- [ ] **Step 7: Run focused tests and verify GREEN.**

Run: `pnpm --filter @mathviz/app exec vitest run test/seriesDomainView.test.tsx test/seriesEvaluation.test.ts`

Expected: the view renders, controls update shared state, unresolved estimates remain honest, and the persistent frame does not auto-fit.

- [ ] **Step 8: Commit.**

```bash
git add packages/app/src/views/SeriesDomainView.tsx packages/app/src/views/ViewCanvas.tsx packages/app/src/state/viewKinds.ts packages/app/src/state/workspaceStore.ts packages/app/src/state/persistence.ts packages/app/src/subsystems.ts packages/app/test/seriesDomainView.test.tsx
git commit -m "feat: render Fourier series partial sums"
git push origin main
```

### Task 8: Add linked readout and expression input affordances

**Files:**
- Modify: `packages/app/src/readout/ReadoutBar.tsx`
- Modify: `packages/app/src/expression/keypad/transforms.ts`
- Test: `packages/app/test/readout.test.tsx`
- Test: `packages/app/test/keypad.test.tsx`

**Interfaces:**
- Add a series readout branch before the ordinary point branch:

```tsx
<Cell label="t" value={<NumberText ... />} />
<Cell label="f(t)" value={...} />
<Cell label="S_N(t)" value={...} />
```

- It must use the same `estimateActiveFourierSeries` object as the view and the source evaluator used for the source curve.
- Replace the planned Fourier-series keypad entry with a live `FourierSeries` operation key; add a live `sign` function key with the canonical MathLive form.

- [ ] **Step 1: Write failing readout/keypad tests.** Hold a point on the series view and assert the readout contains `t`, source value, and `S_N(t)`; alter order and assert the partial-sum readout changes. Assert the keypad inserts the live operator and no longer lists Fourier series as planned.

- [ ] **Step 2: Run focused tests and verify RED.**

Run: `pnpm --filter @mathviz/app exec vitest run test/readout.test.tsx test/keypad.test.tsx`

Expected: no series-specific readout cells and the operation remains listed as planned.

- [ ] **Step 3: Implement the shared-estimate readout branch.** Use the active series pair for the estimate, use `state.hover ?? state.selection` for `t`, evaluate the source with `store.sourceExpression()`, and show unresolved text rather than a fabricated number when either value is unavailable.

- [ ] **Step 4: Implement keypad affordances.** Add keys matching the parser's exact spellings and argument slots, for example:

```ts
key('Σ', '\\operatorname{FourierSeries}\\left(#0,#1\\right)', 'A numerical Fourier-series partial sum')
functionKey('sign', 'The real sign function')
```

Keep inverse Fourier, Laplace, impulse, and unit-step entries planned.

- [ ] **Step 5: Run focused tests and verify GREEN.**

Run: `pnpm --filter @mathviz/app exec vitest run test/readout.test.tsx test/keypad.test.tsx`

Expected: linked readout and live keypad tests pass.

- [ ] **Step 6: Commit.**

```bash
git add packages/app/src/readout/ReadoutBar.tsx packages/app/src/expression/keypad/transforms.ts packages/app/test/readout.test.tsx packages/app/test/keypad.test.tsx
git commit -m "feat: link Fourier series readout"
git push origin main
```

### Task 9: Register the capability and close the verification gate

**Files:**
- Modify: `packages/app/src/subsystems.ts`
- Modify: `packages/mathcore/src/conventions.ts` if the Fourier-series normalization needs a centralized convention entry
- Modify: `packages/mathcore/src/index.ts` module map comments if the new export was added without documentation
- Test: `packages/app/test/subsystems.test.ts`
- Test: `packages/mathcore/test/conventions.test.ts` if a convention entry was added

- [ ] **Step 1: Write the failing capability test.** Assert that the transforms registry names numerical Fourier series/partial sums as implemented only after the view, core, readout, and tests exist, and that the summary states finite numerical coefficients and partial-sum diagnostics rather than exact reconstruction.

- [ ] **Step 2: Run the focused test and verify RED.**

Run: `pnpm --filter @mathviz/app exec vitest run test/subsystems.test.ts`

Expected: the existing registry still reports Fourier series and Gibbs as planned.

- [ ] **Step 3: Change the registry honestly.** Replace the planned entry with separate implemented wording for “Numerical Fourier series partial sums” and keep any unsupported symbolic/inverse behavior out of the implemented claim. Do not mark Gibbs as an automatic theorem detector.

- [ ] **Step 4: Run focused tests and verify GREEN.**

Run: `pnpm --filter @mathviz/app exec vitest run test/subsystems.test.ts`

Expected: capability count and wording tests pass.

- [ ] **Step 5: Run the complete repository gate.**

Run: `pnpm exec prettier --check .; git diff --check; pnpm verify`

Expected: Prettier, diff check, lint, typecheck, 569-or-more mathcore tests, app tests including all new series tests, tooling tests, and both builds pass. Existing React `act(...)` warnings may remain only where they already existed; no new warnings should be introduced by series tests.

- [ ] **Step 6: Review the final diff against the spec.** Confirm no README/GIF changes, no mock coefficients, no hidden viewport fit, no unsupported backend fall-through, no frequency cursor usage, and no exact/Gibbs certification language.

- [ ] **Step 7: Commit and push the capability registration and any convention comments.**

```bash
git add packages/app/src/subsystems.ts packages/mathcore/src/conventions.ts packages/mathcore/src/index.ts packages/app/test/subsystems.test.ts packages/mathcore/test/conventions.test.ts
git commit -m "feat: register numerical Fourier series capability"
git push origin main
```

## Final self-review checklist

- [ ] Every spec section maps to at least one task: syntax/AST (Task 2), `sign` (Task 1), typing and backend refusals (Task 3), numerical contract and `Q_eff` (Task 4), state/persistence and selection (Task 5), caching/frame helpers (Task 6), rendering and controls (Task 7), readout/keypad (Task 8), capability and verification (Task 9).
- [ ] The plan uses one name consistently: `FourierSeriesNode`, `fourier-series`, `series-pair`, `series-domain`, `FourierSeriesSettings`, and `SeriesViewport`.
- [ ] No task treats coefficient disagreement as a proof, source sampling as exact integration, or visible overshoot as an automatically certified Gibbs theorem.
- [ ] Invalid periods and period dependencies are rejected before numerical sampling; unresolved numerical results cannot draw a fabricated curve.
- [ ] The outer real evaluation point and inner real integration variable remain distinct in syntax, AST binding, numerical evaluation, and readout.
- [ ] The existing `frequencyHover`/`frequencySelection` path remains untouched by series pointer interaction.
- [ ] The plan leaves inverse transforms, complex coefficients, arbitrary phase intervals, Laplace, and README demos out of this slice.
