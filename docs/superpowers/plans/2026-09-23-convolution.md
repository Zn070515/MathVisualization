# Convolution and sampled Fourier-product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an expression-first, finite-window numerical convolution with an honest periodic sampled DFT-product comparison.

**Architecture:** Add a bound `ConvolutionNode` to mathcore, keep all numerical work in a pure mathcore estimator, and expose it through a cached app evaluation adapter and an explicit convolution view. The discrete relation uses the existing time-integral-scaled DFT and applies the required `exp(i·ω·t_min)` origin phase; it is not presented as an unqualified continuous convolution theorem.

**Tech Stack:** TypeScript, Vitest, React 19, Vite, MathLive, `@mathviz/mathcore`, existing Complex/Result/DFT conventions.

**Spec:** `docs/superpowers/specs/2026-09-23-convolution-design.md`

## Global Constraints

- The result is always a finite-window numerical estimate; it is never labelled symbolic or exact.
- The quadrature is composite trapezoid, and the refined result is the returned value.
- Undefined or non-finite source samples produce `unresolved`, not a silently broken curve.
- Periodic sampled convolution must state circular wrap-around and finite-window assumptions.
- Nonzero `t_min` requires the origin phase `exp(i·ω_k·t_min)` in the DFT-product comparison.
- Do not overload `*` or enable the planned infix star key; use `Convolution(f(t), g(t))`.
- Do not modify README or GIF assets in this feature round.
- Every task ends with its focused test command and a small commit; push `main` after the final task.

---

### Task 1: Add the canonical convolution expression

**Files:**
- Modify: `packages/mathcore/src/ast.ts`
- Modify: `packages/mathcore/src/parser.ts`
- Modify: `packages/mathcore/src/latex.ts`
- Modify: `packages/mathcore/src/format.ts`
- Modify: `packages/mathcore/src/types.ts`
- Modify: `packages/mathcore/src/infer.ts`
- Modify: `packages/mathcore/src/builtins.ts`
- Modify: `packages/mathcore/src/evaluator.ts`
- Modify: `packages/mathcore/src/glsl.ts`
- Modify: `packages/mathcore/src/sympy.ts`
- Create: `packages/mathcore/test/convolution.test.ts`

**Interfaces:**
- Produce `ConvolutionNode`:

```ts
export interface ConvolutionNode {
  readonly kind: 'convolution';
  readonly left: Expr;
  readonly right: Expr;
  /** Real integration variable bound by this node. */
  readonly sourceVariable: string;
  readonly span: SourceSpan;
}
```

- `parseExpression('Convolution(f(t), g(t))', options)` returns that node.
- `collectVariableNames(node)` returns no free source variable for `t`.
- `classifyDefinitionWith` returns `kind: 'convolution-pair'` for a valid
  one-real-variable definition whose body is a convolution.

The new test file starts with these concrete helpers, so later snippets refer
only to names defined in this task:

```ts
function inputs(...sources: string[]): WorkspaceInput[] {
  return sources.map((source, index) => ({ id: `line-${index}`, source }));
}

function convolutionExpression(source = 'Convolution(f(t), g(t))'): ConvolutionNode {
  const parsed = parseExpression(source, {
    knownFunctions: new Set(['Convolution', 'f', 'g']),
    knownValues: new Set(['t']),
  });
  if (!parsed.ok || parsed.value.kind !== 'convolution') throw new Error('expected convolution');
  return parsed.value;
}

function convolutionEntry(workspace: ReturnType<typeof buildWorkspace>): ConvolutionNode {
  const entry = workspace.entries[2];
  const body = entry?.statement?.kind === 'function-definition' ? entry.statement.body : null;
  if (body?.kind !== 'convolution') throw new Error('expected convolution definition');
  return body;
}

const shaderOptions = {
  parameters: [],
  variables: new Map([['t', { kind: 'real', axis: 0 } as const]]),
};
```

- [ ] **Step 1: Write failing syntax and binding tests.**

```ts
it('parses convolution as a bound AST node', () => {
  const parsed = parseExpression('Convolution(f(t), g(t))', {
    knownFunctions: new Set(['Convolution', 'f', 'g']),
    knownValues: new Set(['t']),
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.kind).toBe('convolution');
  expect(collectVariableNames(parsed.value)).toEqual([]);
});

it('rejects non-unary or mixed-variable sources', () => {
  expect(parseExpression('Convolution(f(t, t), g(t))', {
    knownFunctions: new Set(['Convolution', 'f', 'g']),
    knownValues: new Set(['t']),
  }).ok).toBe(false);
  expect(parseExpression('Convolution(f(t), g(u))', {
    knownFunctions: new Set(['Convolution', 'f', 'g']),
    knownValues: new Set(['t', 'u']),
  }).ok).toBe(false);
});
```

- [ ] **Step 2: Run the focused test to confirm RED.**

Run: `pnpm --filter @mathviz/mathcore test -- convolution.test.ts`

Expected: FAIL because `ConvolutionNode` and the parser operation do not exist.

- [ ] **Step 3: Implement the AST and parser surface.**

Add `ConvolutionNode` to `Expr`, `ExprKind`, `childNodes`, and bound-variable
collection. Register `Convolution` as a recognized operation beside `Fourier`
and `DFT`. Parse exactly two unary calls and require the same real variable in
both calls; construct the node with that variable as `sourceVariable`.

Add the matching text and LaTeX printers:

```ts
case 'convolution':
  return `Convolution(${print(expr.left, 0)}, ${print(expr.right, 0)})`;
```

and `\operatorname{Convolution}\left(...\right)` for LaTeX.

- [ ] **Step 4: Run syntax tests to confirm GREEN.**

Run: `pnpm --filter @mathviz/mathcore test -- convolution.test.ts`

Expected: parsing, binding, text formatting, and LaTeX round-trip tests pass.

- [ ] **Step 5: Write failing inference/backend tests.**

```ts
it('classifies a real convolution definition', () => {
  const workspace = buildWorkspace(inputs(
    'f(t)=exp(-t^2)',
    'g(t)=exp(-2*t^2)',
    'h(t)=Convolution(f(t), g(t))',
  ));
  expect(workspace.entries[2]?.type?.classification.kind).toBe('convolution-pair');
  expect(workspace.entries[2]?.type?.signature).toEqual({
    domain: { kind: 'R', dim: 1 },
    codomain: { kind: 'C', dim: 1 },
  });
});

it('rejects convolution in pointwise, symbolic, and shader backends', () => {
  const expression = convolutionExpression();
  expect(evaluateScalar(expression).ok).toBe(false);
  expect(lowerToSympy(expression, []).ok).toBe(false);
  expect(lowerToDomainColoringProgram(expression, shaderOptions).ok).toBe(false);
});
```

- [ ] **Step 6: Run the new inference tests to confirm RED.**

Run: `pnpm --filter @mathviz/mathcore test -- convolution.test.ts`

Expected: FAIL because the classification and exhaustive backend cases are not
implemented.

- [ ] **Step 7: Implement inference and explicit unsupported diagnostics.**

Add `'convolution-pair'` to `MathObjectKind`. In `inferSpace`, require two
unary real-input function calls, infer each result space, and return the
product codomain (`R → R` when both are real, otherwise `R → C`). In
`classifyDefinitionWith`, describe the body as a finite-window numerical
convolution. Add explicit unsupported cases to evaluator, SymPy, and GLSL;
none may lower the node as multiplication or a formal symbolic integral.

- [ ] **Step 8: Run mathcore tests and commit the syntax layer.**

Run: `pnpm --filter @mathviz/mathcore test -- convolution.test.ts`

Expected: PASS.

Commit:

```bash
git add packages/mathcore/src packages/mathcore/test/convolution.test.ts
git commit -m "feat: add convolution expression node"
```

---

### Task 2: Implement finite-window convolution and the phase-corrected sampled relation

**Files:**
- Create: `packages/mathcore/src/convolution.ts`
- Modify: `packages/mathcore/src/index.ts`
- Modify: `packages/mathcore/test/convolution.test.ts`

**Interfaces:**

```ts
export interface ConvolutionWindow {
  readonly min: number;
  readonly max: number;
}

export type ConvolutionStability = 'stable' | 'sampling-sensitive' | 'unresolved';

export interface ConvolutionEstimateOptions {
  readonly integrationWindow: ConvolutionWindow;
  readonly outputWindow: ConvolutionWindow;
  readonly outputSampleCount: number;
  readonly integrationSampleCount: number;
  readonly tolerance?: number;
}

export interface ConvolutionEstimate {
  readonly sampleTimes: readonly number[];
  readonly leftValues: readonly Complex[];
  readonly rightValues: readonly Complex[];
  readonly values: readonly Complex[];
  readonly integrationWindow: ConvolutionWindow;
  readonly outputWindow: ConvolutionWindow;
  readonly outputSampleCount: number;
  readonly integrationSampleCount: number;
  readonly estimatedError: number;
  readonly stability: ConvolutionStability;
  readonly diagnostics: readonly string[];
}

export function estimateConvolution(
  node: ConvolutionNode,
  environment: EvaluationEnvironment,
  options: ConvolutionEstimateOptions,
): ConvolutionEstimate;

export function periodicSampledConvolution(
  left: readonly Complex[],
  right: readonly Complex[],
  sampleInterval: number,
): Result<readonly Complex[], MathIssue>;

export function phaseCorrectedDftProduct(
  left: DftEstimate,
  right: DftEstimate,
): Result<readonly Complex[], MathIssue>;
```

The numerical test helpers are also local and concrete:

```ts
function estimateFor(
  sources: readonly string[],
  options: ConvolutionEstimateOptions,
): ConvolutionEstimate {
  const workspace = buildWorkspace(inputs(...sources));
  return estimateConvolution(
    convolutionEntry(workspace),
    workspaceEnvironment(workspace),
    options,
  );
}

function dftEstimateFor(bodySource: string, timeWindow: DftTimeWindow): DftEstimate {
  const workspace = buildWorkspace(inputs(`f(t)=${bodySource}`, 'D(ω)=DFT(f(t))'));
  const entry = workspace.entries[1];
  const body = entry?.statement?.kind === 'function-definition' ? entry.statement.body : null;
  if (body?.kind !== 'dft-transform') throw new Error('expected DFT definition');
  return estimateDft(body, workspaceEnvironment(workspace), {
    timeWindow,
    sampleCount: 16,
  });
}
```

- [ ] **Step 1: Write failing quadrature and normalization tests.**

```ts
it('estimates constant finite-window convolution', () => {
  const workspace = buildWorkspace(inputs(
    'f(t)=1',
    'g(t)=1',
    'h(t)=Convolution(f(t), g(t))',
  ));
  const estimate = estimateConvolution(convolutionEntry(workspace), workspaceEnvironment(workspace), {
    integrationWindow: { min: 0, max: 2 },
    outputWindow: { min: -1, max: 1 },
    outputSampleCount: 8,
    integrationSampleCount: 8,
  });
  expect(estimate.stability).toBe('stable');
  expect(estimate.values.every((value) => value.re === 2 && value.im === 0)).toBe(true);
});

it('returns the refined value and finite refinement error', () => {
  const estimate = estimateFor(
    ['f(t)=exp(-t^2)', 'g(t)=exp(-2*t^2)', 'h(t)=Convolution(f(t),g(t))'],
    {
      integrationWindow: { min: -4, max: 4 },
      outputWindow: { min: -2, max: 2 },
      outputSampleCount: 8,
      integrationSampleCount: 16,
    },
  );
  expect(estimate.estimatedError).toBeGreaterThanOrEqual(0);
  expect(estimate.diagnostics.join(' ')).toMatch(/finite-window/i);
});

it('uses the sample-origin phase in the periodic DFT product', () => {
  const left = dftEstimateFor('cos(t)', { min: 0.25, max: 8.25 });
  const right = dftEstimateFor('sin(t)', { min: 0.25, max: 8.25 });
  const product = phaseCorrectedDftProduct(left, right);
  expect(product.ok).toBe(true);
  if (!product.ok) return;
  expect(product.value[1]?.re).toBeFinite();
});
```

- [ ] **Step 2: Run the focused test to confirm RED.**

Run: `pnpm --filter @mathviz/mathcore test -- convolution.test.ts`

Expected: FAIL because no estimator or sampled relation exists.

- [ ] **Step 3: Implement validation and source sampling.**

Validate finite increasing windows, positive integer sample counts, and a
reasonable upper bound before allocating arrays. For each output time `x`,
evaluate the left source at `τ` and the right source at `x - τ` through the
existing `EvaluationEnvironment`; preserve parameters from the environment.
Evaluate source values on the output grid for `leftValues` and `rightValues`.
Return `unresolved` with `Infinity` error and a diagnostic naming the failed
source/sample when evaluation is undefined or non-finite.

- [ ] **Step 4: Implement composite trapezoid refinement.**

Use `n` and `2n` integration samples for every output time. The trapezoid
weight is `1/2` at both endpoints and `1` elsewhere, multiplied by
`(max - min)/(n - 1)`. Return the refined array, and compute the maximum
absolute complex difference between refined and primary output values. Mark
`stable` when the relative difference is within the supplied/default tolerance;
otherwise mark `sampling-sensitive`.

- [ ] **Step 5: Implement periodic sampled convolution and origin phase.**

For equal-length vectors, compute:

```ts
c[n] = sampleInterval * sum(left[m] * right[(n - m + N) % N]);
```

Build the comparison product from matching DFT bins as:

```ts
phaseCorrected = exp(i * bin.angularFrequency * left.timeWindow.min)
  * left.values[k]
  * right.values[k];
```

Reject mismatched grids, origins, sample counts, or non-finite inputs with a
typed `MathIssue`; do not quietly align unrelated DFT estimates.

- [ ] **Step 6: Run mathcore tests and commit the numerical core.**

Run: `pnpm --filter @mathviz/mathcore test -- convolution.test.ts`

Expected: PASS, including the nonzero-origin relation test.

Commit:

```bash
git add packages/mathcore/src/convolution.ts packages/mathcore/src/index.ts packages/mathcore/test/convolution.test.ts
git commit -m "feat: add finite-window convolution estimator"
```

---

### Task 3: Add convolution selection, settings, and shared estimate caching

**Files:**
- Modify: `packages/app/src/state/workspaceStore.ts`
- Modify: `packages/app/src/state/viewKinds.ts`
- Create: `packages/app/src/views/convolutionEvaluation.ts`
- Create: `packages/app/test/convolutionEvaluation.test.ts`

**Interfaces:**

```ts
export interface ConvolutionSettings {
  readonly integrationWindow: { readonly min: number; readonly max: number };
  readonly outputWindow: { readonly min: number; readonly max: number };
  readonly outputSampleCount: number;
  readonly integrationSampleCount: number;
}

export const DEFAULT_CONVOLUTION_SETTINGS: ConvolutionSettings = {
  integrationWindow: { min: -8, max: 8 },
  outputWindow: { min: -8, max: 8 },
  outputSampleCount: 128,
  integrationSampleCount: 128,
};

export function selectConvolution(active: ActiveExpression | null): ConvolutionNode | null;
export function estimateActiveConvolution(
  active: ActiveExpression | null,
  workspace: Workspace,
  parameterValues: ReadonlyMap<string, number>,
  settings?: ConvolutionSettings,
): ConvolutionEstimate | null;
```

The app tests define `convolutionStore()` as:

```ts
function convolutionStore(): WorkspaceStore {
  const store = makeStoreFromLatex(
    [
      'f(t)=\\exp(-t^2)',
      'g(t)=\\exp(-2t^2)',
      'h(t)=\\operatorname{Convolution}(f(t),g(t))',
    ],
    'transforms',
  );
  store.focusLine(store.getState().lines[2]?.id as string);
  return store;
}
```

- [ ] **Step 1: Write failing selection and cache tests.**

```ts
it('selects the focused convolution definition', () => {
  const store = makeStoreFromLatex([
    'f(t)=exp(-t^2)',
    'g(t)=exp(-2*t^2)',
    'h(t)=Convolution(f(t),g(t))',
  ], 'transforms');
  store.focusLine(store.getState().lines[2]?.id as string);
  expect(selectConvolution(store.activeExpression())).not.toBeNull();
});

it('shares a cached estimate until parameters or settings change', () => {
  const store = convolutionStore();
  const state = store.getState();
  const first = estimateActiveConvolution(store.activeExpression(), state.workspace, state.parameterValues);
  const repeated = estimateActiveConvolution(store.activeExpression(), state.workspace, state.parameterValues);
  expect(repeated).toBe(first);
});
```

- [ ] **Step 2: Run the app test to confirm RED.**

Run: `pnpm --filter @mathviz/app test -- convolutionEvaluation.test.ts`

Expected: FAIL because the convolution selection adapter and settings do not exist.

- [ ] **Step 3: Add persisted convolution settings and classification support.**

Add the settings beside `SamplingSettings`, validate restored values, and include
them in the store's persistence key. Add `'convolution-pair'` to the transforms
subsystem drawable kinds. Update active-expression selection so a focused
convolution pair wins, and so the first convolution pair is only a fallback
when no focused drawable object identifies another object. Do not let a
convolution definition be sent to the ordinary Cartesian renderer.

- [ ] **Step 4: Implement `convolutionEvaluation.ts` with a `WeakMap` cache.**

Cache by workspace, active entry id, sorted parameter values, and all
convolution settings. Use `workspaceEnvironment(workspace, parameterValues)`
and `estimateConvolution`; do not perform arithmetic in the Zustand/store
layer. Add projection helpers using the existing `FieldMode` conventions so a
complex convolution can be viewed as real, imaginary, magnitude, or phase.

- [ ] **Step 5: Run app tests and commit state/evaluation support.**

Run: `pnpm --filter @mathviz/app test -- convolutionEvaluation.test.ts`

Expected: PASS, with repeated reads returning the same estimate object and
settings/parameter changes invalidating the cache.

Commit:

```bash
git add packages/app/src/state packages/app/src/views/convolutionEvaluation.ts packages/app/test/convolutionEvaluation.test.ts
git commit -m "feat: add convolution workspace evaluation"
```

---

### Task 4: Add the linked convolution view and expression keypad

**Files:**
- Create: `packages/app/src/views/ConvolutionView.tsx`
- Modify: `packages/app/src/views/ViewCanvas.tsx`
- Modify: `packages/app/src/state/workspaceStore.ts`
- Modify: `packages/app/src/state/viewKinds.ts`
- Modify: `packages/app/src/expression/keypad/transforms.ts`
- Modify: `packages/app/src/subsystems.ts`
- Modify: `packages/app/test/viewKinds.test.ts`
- Modify: `packages/app/test/keypad.test.tsx`
- Modify: `packages/app/test/subsystems.test.ts`

**Interfaces:**

- Add `ViewKind = 'convolution'`.
- Add `VIEW_KIND_STATUS.convolution = 'available'`.
- Add `VIEW_RENDERERS.convolution = ConvolutionView` and title `Convolution`.
- `preferredViewKinds(signature, 'convolution-pair')` returns `['convolution']`.
- `defaultViewKinds(signature, 'convolution-pair')` opens one convolution view.

- [ ] **Step 1: Write failing taxonomy and keypad tests.**

```ts
it('opens a convolution definition on its dedicated view', () => {
  expect(preferredViewKinds(
    { domain: { kind: 'R', dim: 1 }, codomain: { kind: 'C', dim: 1 } },
    'convolution-pair',
  )).toEqual(['convolution']);
  expect(VIEW_KIND_STATUS.convolution).toBe('available');
});

it('offers explicit Convolution input rather than an ambiguous star', () => {
  renderWithKeypad(makeStore(['f(t)=t'], 'transforms'));
  expect(screen.getByRole('button', { name: 'Convolution' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: '∗' })).toBeNull();
});
```

- [ ] **Step 2: Run focused app tests to confirm RED.**

Run: `pnpm --filter @mathviz/app test -- viewKinds.test.ts keypad.test.tsx subsystems.test.ts`

Expected: FAIL because the view kind, renderer, capability, and live keypad
operation do not exist.

- [ ] **Step 3: Implement view dispatch and defaults.**

Add the exhaustive view kind entries, use `defaultModeForView` to choose
`real` for real output and `magnitude` for complex output, and add the
convolution renderer to `ViewCanvas`. Extend the store's default and addable
view logic without changing Fourier/DFT selection behavior.

- [ ] **Step 4: Implement the linked renderer from the cached estimate.**

`ConvolutionView` must draw the left source, right source, and refined
convolution on the same horizontal time axis. Use existing canvas/axis helpers;
do not create a separate evaluator. Use the shared `hover` value for the output
coordinate, snap the readout to the nearest returned sample, and use the cached
`leftValues`, `rightValues`, and `values` for all three curves. Pointer updates
may change hover/selection but must not call `estimateConvolution` again.

Display all of the following in the view or its accessible text:

```text
finite-window numerical convolution
integration window [a,b]
output window [c,d]
N output samples · M integration samples
refinement error …
stable / sampling-sensitive / unresolved
```

For unresolved estimates, render a diagnostic state instead of connecting
missing points. For complex results, reuse the existing mode selector and
project values consistently across all three curves.

- [ ] **Step 5: Replace the planned keypad entry and capability status.**

Add a live keypad wrapper for:

```text
\operatorname{Convolution}\left(#0,#1\right)
```

The insertion must preserve the two placeholders and parse to the canonical
node. Update the transforms capability registry from `planned` to
`implemented`, describing finite-window numerical convolution and the separate
periodic sampled DFT-product check. Do not modify README prose.

- [ ] **Step 6: Run app tests and commit the view.**

Run: `pnpm --filter @mathviz/app test -- viewKinds.test.ts keypad.test.tsx subsystems.test.ts convolutionEvaluation.test.ts`

Expected: PASS.

Commit:

```bash
git add packages/app/src packages/app/test
git commit -m "feat: add linked convolution view"
```

---

### Task 5: Add the sampled DFT-product diagnostic and integration coverage

**Files:**
- Modify: `packages/app/src/views/ConvolutionView.tsx`
- Modify: `packages/app/src/views/convolutionEvaluation.ts`
- Create: `packages/app/test/convolutionView.test.tsx`
- Modify: `packages/mathcore/test/convolution.test.ts`

**Interfaces:**

```ts
export interface DftProductCheck {
  readonly values: readonly Complex[];
  readonly maxAbsoluteDifference: number;
  readonly estimatedError: number;
  readonly status: 'consistent' | 'inconclusive' | 'inconsistent';
  readonly diagnostics: readonly string[];
}
```

```ts
export function estimateActiveDftProduct(
  active: ActiveExpression | null,
  workspace: Workspace,
  parameterValues: ReadonlyMap<string, number>,
  sampling: SamplingSettings,
): DftProductCheck | null;
```

The test file defines the nonzero-origin fixture and view props explicitly:

```ts
function nonzeroOriginConvolutionStore(): WorkspaceStore {
  const store = makeStoreFromLatex(
    [
      'f(t)=cos(t)',
      'g(t)=sin(t)',
      'h(t)=\\operatorname{Convolution}(f(t),g(t))',
    ],
    'transforms',
  );
  store.focusLine(store.getState().lines[2]?.id as string);
  return store;
}

function propsForConvolutionStore(store: WorkspaceStore): ViewRendererProps {
  const view = store.getState().views.find((candidate) => candidate.kind === 'convolution');
  if (view === undefined) throw new Error('expected a convolution view');
  return { store, view };
}
```

- [ ] **Step 1: Write failing relation and origin-label tests.**

```ts
it('compares periodic convolution with the phase-corrected DFT product', () => {
  const store = nonzeroOriginConvolutionStore();
  const check = estimateActiveDftProduct(
    store.activeExpression(),
    store.getState().workspace,
    store.getState().parameterValues,
    DEFAULT_DFT_SAMPLING,
  );
  if (check === null) throw new Error('expected a product check');
  expect(check.status).toBe('consistent');
  expect(check.diagnostics.join(' ')).toMatch(/origin phase|t_min/i);
});

it('labels the product as circular sampled data, not the continuous theorem', () => {
  const store = nonzeroOriginConvolutionStore();
  render(<ConvolutionView {...propsForConvolutionStore(store)} />);
  expect(screen.getByText(/periodic sampled convolution/i)).toBeInTheDocument();
  expect(screen.queryByText(/continuous convolution theorem/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused tests to confirm RED.**

Run: `pnpm --filter @mathviz/app test -- convolutionView.test.tsx`

Expected: FAIL because no product-check adapter or diagnostic panel exists.

- [ ] **Step 3: Implement the app-level product check.**

Use the selected source functions and shared sampling settings to obtain the
two DFT estimates. Build the periodic sampled convolution on the same samples,
then compare its DFT to the phase-corrected product from mathcore. Combine the
two source DFT refinement errors and the convolution/refinement indicator; if
any estimate is unresolved, return `inconclusive` rather than an error verdict.

- [ ] **Step 4: Render the diagnostic without replacing the time curve.**

Add a compact secondary block that names:

```text
DFT product check · periodic sampled convolution
origin phase: exp(i·ω·t_min)
max difference …
consistent / inconclusive / inconsistent
```

The main curve remains the direct finite-window numerical convolution. The
diagnostic must not claim the product relation certifies the continuous
whole-line integral.

- [ ] **Step 5: Run integration tests and commit.**

Run: `pnpm --filter @mathviz/mathcore test -- convolution.test.ts && pnpm --filter @mathviz/app test -- convolutionView.test.tsx convolutionEvaluation.test.ts`

Expected: PASS, including a nonzero-origin case and unresolved-state coverage.

Commit:

```bash
git add packages/mathcore/test/convolution.test.ts packages/app/src/views packages/app/test/convolutionView.test.tsx
git commit -m "feat: add convolution DFT product check"
```

---

### Task 6: Full verification and handoff

**Files:**
- Modify only files required by verification failures; do not modify `README.md`.

- [ ] **Step 1: Run focused package tests.**

Run: `pnpm --filter @mathviz/mathcore test && pnpm --filter @mathviz/app test`

Expected: all mathcore and app tests pass.

- [ ] **Step 2: Run formatting, lint, typecheck, and build.**

Run: `pnpm lint && pnpm typecheck && pnpm build`

Expected: no lint, TypeScript, or production-build errors.

- [ ] **Step 3: Run tooling and demo contracts without recording new GIFs.**

Run: `pnpm test:tooling && pnpm demo:test`

Expected: existing demo/GIF contracts remain green; no GIF files are changed.

- [ ] **Step 4: Inspect the final diff and status.**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~6..HEAD
```

Expected: only the convolution implementation, tests, and capability/view
metadata changed; README and demo assets remain untouched.

- [ ] **Step 5: Run the complete verification command.**

Run: `pnpm verify`

Expected: PASS.

- [ ] **Step 6: Push `main`.**

```bash
git push origin main
```

Report the final commit, test summary, and explicitly state that the README and
GIF assets were not modified.
