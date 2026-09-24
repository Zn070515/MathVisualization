# Interactive Convolution Construction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Add a real-user interactive construction view that exposes finite-window convolution as shift → multiply → accumulate while preserving shared selection and numerical uncertainty semantics.

**Architecture:** Add a pure mathcore estimator for one output time T, returning refined τ samples, source/shifted-source/product values, accumulated values, segments, and refinement diagnostics. Add a workspace-keyed app evaluation wrapper, then render the result in a toggleable construction panel inside the existing \`ConvolutionView\`; T remains the existing \`hover ?? selection\` state.

**Tech Stack:** TypeScript, React 19, Vitest, HTML Canvas 2D, \`@mathviz/mathcore\` complex arithmetic and \`Result\` contracts.

**Spec:** \`docs/superpowers/specs/2026-09-24-interactive-convolution-construction-design.md\`

## Global Constraints

- The canonical expression and AST do not change.
- The construction is a finite-window numerical estimate; it must not claim a whole-real-line convolution.
- The refined 2M grid is the displayed numerical answer; primary/refined disagreement is only a refinement indicator.
- \`null\` is unresolved, never zero; no rendered path may cross an unresolved sample.
- Accumulation becomes \`null\` at the first unresolved prefix and remains \`null\`; it must never restart after a gap.
- T is the existing shared workspace coordinate \`hover ?? selection\`; no duplicate local mathematical coordinate is allowed.
- Pointer handlers update workspace state only; numerical evaluation stays in memoized selectors/evaluators.
- Complex products are computed before \`FieldMode\` projection.
- No mock data, hardcoded curves, demo-only rendering path, README edit, or GIF edit.
- Work directly on \`main\`; each completed task is committed and pushed.

---

### Task 1: Add the pure construction estimator

**Files:**

- Modify: \`packages/mathcore/src/convolution.ts\`
- Modify: \`packages/mathcore/test/convolution.test.ts\`
- Verify: \`packages/mathcore/src/index.ts\` already re-exports \`convolution.ts\`; no export change is needed unless the implementation introduces a separate file.

**Interfaces:**

- Consumes: existing \`ConvolutionNode\`, \`EvaluationEnvironment\`, \`ConvolutionWindow\`, \`ConvolutionStability\`, \`Complex\`, and \`Result\`.
- Produces:

```ts
export interface ConvolutionConstructionOptions {
  readonly integrationWindow: ConvolutionWindow;
  readonly integrationSampleCount: number;
  readonly tolerance?: number;
}

export interface ConvolutionConstructionEstimate {
  readonly outputTime: number;
  readonly integrationWindow: ConvolutionWindow;
  readonly tau: readonly number[];
  readonly leftValues: readonly (Complex | null)[];
  readonly shiftedRightValues: readonly (Complex | null)[];
  readonly productValues: readonly (Complex | null)[];
  readonly accumulatedValues: readonly (Complex | null)[];
  readonly segments: readonly {
    readonly startIndex: number;
    readonly endIndex: number;
  }[];
  readonly primaryIntegrationSampleCount: number;
  readonly refinedIntegrationSampleCount: number;
  readonly estimatedError: number;
  readonly stability: ConvolutionStability;
  readonly diagnostics: readonly string[];
}

export function estimateConvolutionConstruction(
  node: ConvolutionNode,
  environment: EvaluationEnvironment,
  outputTime: number,
  options: ConvolutionConstructionOptions,
): ConvolutionConstructionEstimate;
```

- Evaluation rule: at every τ sample evaluate the left source at τ and the right source at outputTime minus τ; multiply the resulting complex values before storing or projecting anything.
- Refinement rule: evaluate primary M and refined 2M grids over the same endpoints; return refined arrays and compare final accumulated values when both full grids resolve.
- Segment rule: valid consecutive product values form inclusive startIndex/endIndex segments. An invalid source sample stores null; no segment crosses it.
- Accumulation rule: for a fully resolved refined grid, set the first value to \`cx(0, 0)\` and use composite trapezoid increments. Once an unresolved product sample appears, set that index and all later accumulation values to null.

- [ ] **Step 1: Write the failing tests for the public contract.**

Add a helper that builds the existing three-line workspace and calls the new estimator. Add these tests to \`describe('interactive convolution construction')\`:

```ts
it('evaluates the shifted source at T minus tau before multiplying', () => {
  const estimate = constructionFor(['f(t)=1', 'g(t)=t', 'h(t)=Convolution(f(t), g(t))'], 1, {
    integrationWindow: { min: 0, max: 2 },
    integrationSampleCount: 5,
  });

  expect(estimate.stability).toBe('stable');
  expect(estimate.tau).toHaveLength(10);
  expect(estimate.tau[0]).toBe(0);
  expect(estimate.tau.at(-1)).toBe(2);
  expect(estimate.shiftedRightValues[0]?.re).toBe(1);
  expect(estimate.shiftedRightValues.at(-1)?.re).toBe(-1);
  expect(estimate.productValues[0]?.re).toBe(1);
  expect(estimate.productValues.at(-1)?.re).toBe(-1);
});

it('returns the refined accumulation and agrees with finite-window convolution', () => {
  const construction = constructionFor(['f(t)=1', 'g(t)=1', 'h(t)=Convolution(f(t), g(t))'], 0.5, {
    integrationWindow: { min: 0, max: 2 },
    integrationSampleCount: 5,
  });
  const convolution = estimateFor(['f(t)=1', 'g(t)=1', 'h(t)=Convolution(f(t), g(t))'], {
    integrationWindow: { min: 0, max: 2 },
    outputWindow: { min: 0.5, max: 0.501 },
    outputSampleCount: 2,
    integrationSampleCount: 5,
  });

  expect(construction.primaryIntegrationSampleCount).toBe(5);
  expect(construction.refinedIntegrationSampleCount).toBe(10);
  expect(construction.accumulatedValues.at(-1)?.re).toBeCloseTo(2);
  expect(construction.accumulatedValues.at(-1)?.re).toBeCloseTo(convolution.values[0]?.re ?? NaN);
  expect(Number.isFinite(construction.estimatedError)).toBe(true);
});

it('breaks paths and never restarts accumulation after an undefined sample', () => {
  const estimate = constructionFor(['f(t)=1/t', 'g(t)=1', 'h(t)=Convolution(f(t), g(t))'], 0, {
    integrationWindow: { min: 0, max: 1 },
    integrationSampleCount: 5,
  });

  expect(estimate.stability).toBe('unresolved');
  expect(estimate.segments[0]?.startIndex).toBe(1);
  expect(estimate.productValues[0]).toBeNull();
  expect(estimate.accumulatedValues.slice(0, -1).every((value) => value === null)).toBe(true);
});

it('multiplies complex values before projection', () => {
  const estimate = constructionFor(
    ['f(t)=exp(i*t)', 'g(t)=exp(i*t)', 'h(t)=Convolution(f(t), g(t))'],
    0,
    { integrationWindow: { min: 0, max: 1 }, integrationSampleCount: 5 },
  );

  expect(estimate.productValues[0]?.re).toBeCloseTo(1);
  expect(estimate.productValues[0]?.im).toBeCloseTo(0);
});
```

- [ ] **Step 2: Run the focused test file and verify the failure is caused by the missing estimator.**

Run:

```bash
pnpm --filter @mathviz/mathcore test -- convolution.test.ts
```

Expected: existing convolution tests pass while the new construction tests fail because \`estimateConvolutionConstruction\` is not defined/exported. Fix only test setup if the failure is a syntax or helper error.

- [ ] **Step 3: Implement validation, sampling, and accumulation.**

In \`packages/mathcore/src/convolution.ts\`:

1. Validate finite outputTime, a finite increasing integration window, a valid primary sample count, \`integrationSampleCount * 2 <= CONVOLUTION_MAX_SAMPLE_COUNT\`, and a finite non-negative tolerance.
2. Build the refined τ grid with the existing \`grid()\` helper and evaluate source values with the existing \`evaluateSource()\` helper.
3. Keep the four value arrays parallel to \`tau\`; use null for failed evaluations.
4. Track valid product segments with inclusive indices.
5. Set the accumulation to zero only at refined index zero when the first sample is resolved. On the first unresolved product sample, set that index and all later accumulation values to null.
6. Compute the primary result separately and compare final primary/refined accumulators only when both full grids resolve. Return Infinity and unresolved otherwise.
7. Reuse existing finite-window and refinement diagnostic language; include the failed source argument and τ when available.

- [ ] **Step 4: Run focused tests and mathcore typecheck.**

```bash
pnpm --filter @mathviz/mathcore test -- convolution.test.ts
pnpm --filter @mathviz/mathcore typecheck
```

Expected: all convolution tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit and push the mathcore task.**

```bash
git add packages/mathcore/src/convolution.ts packages/mathcore/test/convolution.test.ts
git commit -m "feat: expose interactive convolution construction"
git push origin main
```

### Task 2: Add cached app evaluation and projection helpers

**Files:**

- Modify: \`packages/app/src/views/convolutionEvaluation.ts\`
- Modify: \`packages/app/test/convolutionEvaluation.test.ts\`

**Interfaces:**

- Consumes: \`estimateConvolutionConstruction\`, \`ActiveExpression\`, \`Workspace\`, \`SamplingSettings\`, shared parameter values, and \`FieldMode\`.
- Produces:

```ts
export function estimateActiveConvolutionConstruction(
  active: ActiveExpression | null,
  workspace: Workspace,
  parameterValues: ReadonlyMap<string, number>,
  outputTime: number | null,
  settings: ConvolutionSettings,
): ConvolutionConstructionEstimate | null;

export function projectConstructionValue(
  value: Complex | null,
  mode: Exclude<FieldMode, 'complex'>,
): number | null;
```

- Cache key must include active expression id, parameter values, outputTime, integration window, integration sample count, and tolerance. A null output time returns null without evaluating.
- Use \`workspaceEnvironment(workspace, parameterValues)\` and the selected convolution node; do not duplicate source parsing.

- [ ] **Step 1: Write failing app evaluation tests.**

Add tests to \`packages/app/test/convolutionEvaluation.test.ts\` for:

1. A focused convolution with outputTime 1 returns shifted values at T minus τ.
2. Calling the selector twice with the same workspace, outputTime, parameters, and settings returns the same cached object.
3. A null outputTime or null active expression returns null.
4. \`projectConstructionValue({ re: 3, im: 4 }, 'magnitude')\` returns 5 and a null input returns null.

- [ ] **Step 2: Run the evaluation tests and verify the new tests fail for the missing selector/helper.**

```bash
pnpm --filter @mathviz/app test -- convolutionEvaluation.test.ts
```

Expected: existing tests pass and the new tests fail because the two exports do not exist.

- [ ] **Step 3: Implement the selector, cache key, and projection helper.**

Use a separate \`constructionCache: WeakMap<Workspace, Map<string, ConvolutionConstructionEstimate | null>>\`. Key every numerical dependency, including outputTime and integration settings. Call the mathcore estimator once per unique key.

- [ ] **Step 4: Run app tests and typecheck.**

```bash
pnpm --filter @mathviz/app test -- convolutionEvaluation.test.ts
pnpm --filter @mathviz/app typecheck
```

- [ ] **Step 5: Commit and push the app evaluation task.**

```bash
git add packages/app/src/views/convolutionEvaluation.ts packages/app/test/convolutionEvaluation.test.ts
git commit -m "feat: cache convolution construction estimates"
git push origin main
```

### Task 3: Render the construction panel and close the capability contract

**Files:**

- Modify: \`packages/app/src/views/ConvolutionView.tsx\`
- Modify: \`packages/app/src/styles/app.css\`
- Modify: \`packages/app/src/subsystems.ts\`
- Modify: \`packages/app/test/convolutionView.test.tsx\`
- Modify: \`packages/app/test/subsystems.test.ts\`

**Interfaces:**

- Consumes: \`estimateActiveConvolutionConstruction\`, \`projectConstructionValue\`, existing \`state.hover ?? state.selection\`, \`FieldMode\`, and the existing output plot.
- Produces: a keyboard-accessible \`show convolution construction\` checkbox and a construction canvas with finite-window diagnostics.

- [ ] **Step 1: Write failing view and registry tests.**

Extend \`convolutionView.test.tsx\` with these behaviors:

```tsx
it('shows the construction toggle without changing shared selection', () => {
  const store = nonzeroOriginConvolutionStore();
  const before = store.getState().selection;
  render(<ConvolutionView {...propsForConvolutionStore(store)} />);

  const toggle = screen.getByRole('checkbox', { name: /show convolution construction/i });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(toggle).toBeChecked();
  expect(store.getState().selection).toBe(before);
});

it('renders a selected construction with the shared T readout', () => {
  const store = nonzeroOriginConvolutionStore();
  store.setSelection(cx(1, 0));
  render(<ConvolutionView {...propsForConvolutionStore(store)} />);
  fireEvent.click(screen.getByRole('checkbox', { name: /show convolution construction/i }));

  expect(screen.getByText(/T =/i)).toBeTruthy();
  expect(screen.getByText(/accumulated integral/i)).toBeTruthy();
});
```

Update \`packages/app/test/subsystems.test.ts\` so \`Interactive convolution construction\` is expected to be \`implemented\`.

- [ ] **Step 2: Run focused app tests and verify the new tests fail because the control/panel is absent.**

```bash
pnpm --filter @mathviz/app test -- convolutionView.test.tsx subsystems.test.ts
```

- [ ] **Step 3: Add the visual toggle and linked construction data flow.**

In \`ConvolutionView.tsx\`:

1. Add \`useState(false)\` for the visual toggle only.
2. Compute \`outputTime = state.hover?.re ?? state.selection?.re ?? null\`.
3. Memoize \`estimateActiveConvolutionConstruction\` with active expression, workspace, parameter values, outputTime, and numerical settings.
4. Keep mathematical evaluation out of pointer handlers.
5. Render a real label and \`aria-label="show convolution construction"\`.
6. When enabled and no outputTime exists, render a status prompt rather than defaulting to zero.
7. When data exists, render a second canvas below the output canvas. Draw source, shifted source, product, and accumulated bands over the same τ range. Use \`projectConstructionValue\`, break paths at null, and label measured vertical ranges.
8. Show T, τ window, refined sample count, finite-window qualifier, stability, refinement error, and unresolved diagnostics.

Add only the CSS needed for the construction panel, canvas height, checkbox control, and diagnostic text.

- [ ] **Step 4: Update the capability registry.**

Change only the existing registry entry:

```ts
{
  name: 'Interactive convolution construction',
  summary: 'Shows f(τ), g(T−τ), their product, and the accumulated finite-window integral as the linked output coordinate T moves.',
  status: 'implemented',
}
```

Keep Numerical convolution and Sampled convolution and DFT product separate and implemented.

- [ ] **Step 5: Run focused app tests, lint, and typecheck.**

```bash
pnpm --filter @mathviz/app test -- convolutionView.test.tsx subsystems.test.ts
pnpm --filter @mathviz/app typecheck
pnpm lint
```

- [ ] **Step 6: Commit and push the UI task.**

```bash
git add packages/app/src/views/ConvolutionView.tsx packages/app/src/styles/app.css packages/app/src/subsystems.ts packages/app/test/convolutionView.test.tsx packages/app/test/subsystems.test.ts
git commit -m "feat: render interactive convolution construction"
git push origin main
```

### Task 4: Full acceptance verification

**Files:**

- No source changes expected. If verification exposes a defect, add a targeted regression test and fix it in the owning task before continuing.

- [ ] **Step 1: Run the complete repository verification contract.**

```bash
pnpm verify
```

Expected: lint, typecheck, all mathcore/app tests, tooling tests, and production build pass.

- [ ] **Step 2: Confirm repository hygiene.**

```bash
git diff --check
git status --short
git log -5 --oneline
```

Expected: no uncommitted changes, no README/GIF modifications, and the three implementation commits are present on origin/main.

- [ ] **Step 3: Push any verification-only fix and report the final commit.**

Only if Task 4 exposed and fixed a real defect:

```bash
git add packages/mathcore/src/convolution.ts packages/mathcore/test/convolution.test.ts packages/app/src/views/convolutionEvaluation.ts packages/app/test/convolutionEvaluation.test.ts packages/app/src/views/ConvolutionView.tsx packages/app/src/styles/app.css packages/app/src/subsystems.ts packages/app/test/convolutionView.test.tsx packages/app/test/subsystems.test.ts
git commit -m "fix: harden convolution construction verification"
git push origin main
```
