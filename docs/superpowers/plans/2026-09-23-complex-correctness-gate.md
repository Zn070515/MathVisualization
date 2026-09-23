# Complex Correctness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make complex singularity, winding, residue-theorem, and contour-interval claims conservative and evidence-backed.

**Architecture:** Keep numerical quadrature and AST evaluation separate. Add adaptive winding diagnostics and a status-bearing singularity search result; carry residue uncertainty beside each residue value; require the search status and combined error budget before the UI states a theorem-level conclusion. Represent an optional path interval on function definitions using `gamma(t; [from, to]) = ...`, while preserving `[0, 2π]` as the compatibility default.

**Tech Stack:** TypeScript, Vitest, React, Testing Library, pnpm workspace.

**Spec:** The user's Complex Correctness Gate review in the conversation, plus `GOAL.md` sections 7.14–7.17.

## Global Constraints

- Never infer analyticity from an empty pole list.
- Never round an unstable winding number into an integer.
- Every residue comparison must include contour and residue numerical uncertainty.
- Existing `gamma(t)=...` documents remain valid and use `[0, 2π]`.
- Unsupported backends remain explicit; no symbolic or GLSL implementation is added for contour nodes.

---

### Task 1: Adaptive winding and status-bearing singularity search

**Files:**

- Modify: `packages/mathcore/src/zerosAndPoles.ts`
- Modify: `packages/mathcore/src/contour.ts`
- Test: `packages/mathcore/test/zerosAndPoles.test.ts`
- Test: `packages/mathcore/test/contourSyntax.test.ts`

**Interfaces:**

- `windingNumber(...)` continues to return `Winding`, adding convergence/sample diagnostics while preserving `count: number | null`.
- Add `analyzeZerosAndPoles(...)` returning `{ points, complete, unresolved, truncated }`; keep `findZerosAndPoles(...)` as the detected-points compatibility wrapper.
- `windingAround(...)` returns `null` when any sampled phase step exceeds the safe threshold instead of accepting an aliased integer.

- [ ] **Step 1: Write failing tests**

```ts
it('refuses a phase-aliasing sample count and converges to z^300 order', () => {
  const winding = windingNumber(functionOf('z^300'), cx(0, 0), 1);
  expect(winding.count).toBe(300);
  expect(winding.converged).toBe(true);
  expect(winding.samples).toBeGreaterThan(256);
});

it('marks an undefined candidate as unresolved instead of proving no singularity', () => {
  const search = analyzeZerosAndPoles(functionOf('exp(1/z)'), REGION);
  expect(search.points.filter((point) => point.kind === 'pole')).toHaveLength(0);
  expect(search.complete).toBe(false);
  expect(search.unresolved.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail for the old fixed-sample and array-only behavior**

Run: `pnpm --filter @mathviz/mathcore test -- zerosAndPoles.test.ts contourSyntax.test.ts`

Expected: FAIL because `z^300` is aliased by the old fixed sample count and the search has no completeness status.

- [ ] **Step 3: Implement the adaptive measurement loop**

For each doubling `N, 2N, 4N, ...`, measure the raw turn and maximum adjacent phase step. Accept an integer only when the raw value is within `INTEGER_TOLERANCE`, the maximum phase step is below a safe threshold, and two consecutive resolutions return the same integer. Return `count: null` at the maximum resolution when those conditions are not met.

- [ ] **Step 4: Implement search metadata without changing the detected-points wrapper**

Track unresolved candidates, candidate truncation, and found-point truncation in `analyzeZerosAndPoles`. A null winding or an undefined grid candidate must enter `unresolved`; only classified zero/pole points enter `points`. Make `findZerosAndPoles` return `search.points` so the complex-plane renderer keeps its existing rendering contract.

- [ ] **Step 5: Add phase-step validation to `windingAround` and verify the focused tests pass**

Run: `pnpm --filter @mathviz/mathcore test -- zerosAndPoles.test.ts contourSyntax.test.ts`

Expected: PASS, including the existing ordinary winding tests.

### Task 2: Residue estimates and combined theorem uncertainty

**Files:**

- Modify: `packages/mathcore/src/contour.ts`
- Modify: `packages/mathcore/src/evaluator.ts`
- Modify: `packages/mathcore/test/contour.test.ts`
- Modify: `packages/mathcore/test/contourSyntax.test.ts`

**Interfaces:**

- Add `ResidueEstimate { value: Complex; estimatedError: number; radius: number }`.
- Change `residueAt(...)` to return `ResidueEstimate | null`.
- Extend `EnclosedPole.residue` to `ResidueEstimate | null`.
- Extend `ContourDetails` with `residueEstimatedError` and singularity-search status.

- [ ] **Step 1: Write failing tests for residue metadata and the combined error budget**

```ts
it('returns residue value, radius, and numerical uncertainty', () => {
  const estimate = residueAt(reciprocal, cx(0, 0), 1);
  expect(estimate).not.toBeNull();
  expect(estimate?.value).toEqual(
    expect.objectContaining({ re: expect.any(Number), im: expect.any(Number) }),
  );
  expect(estimate?.estimatedError).toBeGreaterThan(0);
  expect(estimate?.radius).toBeGreaterThan(0);
});

it('compares both independently estimated errors', () => {
  const details = analyse('exp(i*t)', '1/z');
  expect(details.residueEstimatedError).toBeGreaterThan(0);
  expect(details.integral.estimatedError + details.residueEstimatedError).toBeGreaterThanOrEqual(
    cabs(csub(details.integral.value, details.residueSum)),
  );
});
```

- [ ] **Step 2: Run the focused tests and verify the old `Complex | null` API fails**

Run: `pnpm --filter @mathviz/mathcore test -- contour.test.ts contourSyntax.test.ts`

Expected: FAIL at the new metadata access and existing direct residue-value assertions.

- [ ] **Step 3: Propagate quadrature error through each radius measurement**

Divide the contour error by `2π` when converting an integral to a residue, retain the selected radius, and include the disagreement between accepted radii in `estimatedError`. Sum absolute `|winding| * residue.estimatedError` contributions into `ContourDetails.residueEstimatedError`.

- [ ] **Step 4: Thread search status and residue estimates through evaluator analysis**

Use `analyzeZerosAndPoles`, preserve `residueSum` as a complex value for arithmetic/display, and add the finite combined uncertainty used by the UI. A missing residue must remain a theorem-check blocker rather than contributing a silent zero.

- [ ] **Step 5: Update direct residue tests and verify the focused tests pass**

Run: `pnpm --filter @mathviz/mathcore test -- contour.test.ts contourSyntax.test.ts`

Expected: PASS with the existing numerical tolerances and the new metadata assertions.

### Task 3: Conservative residue-theorem UI and essential-singularity regression

**Files:**

- Modify: `packages/app/src/expression/ValueLine.tsx`
- Modify: `packages/app/test/valueLine.test.tsx`
- Modify: `packages/mathcore/test/contourSyntax.test.ts`

**Interfaces:**

- Empty detected-pole results render an inconclusive message, never Cauchy's theorem.
- The theorem comparison is shown only when the singularity search is complete, every enclosed residue is measured, and the path is closed.
- The comparison uses `integral.estimatedError + residueEstimatedError`.

- [ ] **Step 1: Write failing regression tests**

```ts
it('does not call an essential singularity pole-free analytic', () => {
  const container = renderPanel(seeded('e^{it}', 'e^{1/z}'));
  expect(container.textContent).toContain('No poles were detected inside the contour.');
  expect(container.textContent).toContain('inconclusive');
  expect(container.textContent).not.toContain('Cauchy’s theorem says the integral is zero');
});

it('names the combined contour and residue uncertainty', () => {
  const container = renderPanel(seeded('e^{it}', '\\frac{1}{z}'));
  expect(container.textContent).toContain('combined error estimate');
});
```

- [ ] **Step 2: Run the app tests and verify the old false theorem assertion fails the essential-singularity test**

Run: `pnpm --filter @mathviz/app test -- valueLine.test.tsx`

Expected: FAIL because the current empty-pole branch says Cauchy’s theorem proves zero.

- [ ] **Step 3: Implement conservative branches in `ResidueCheck`**

Render the exact inconclusive copy for zero detected poles. Add separate blockers for incomplete singularity analysis and unmeasured residues. Render the theorem comparison only after those guards, and compare with the combined error budget.

- [ ] **Step 4: Verify the app regression and existing value-line behavior**

Run: `pnpm --filter @mathviz/app test -- valueLine.test.tsx`

Expected: PASS after updating the old outside-pole expectation to the new inconclusive wording.

### Task 4: First-class path parameter intervals

**Files:**

- Modify: `packages/mathcore/src/lexer.ts`
- Modify: `packages/mathcore/src/ast.ts`
- Modify: `packages/mathcore/src/parser.ts`
- Modify: `packages/mathcore/src/latex.ts`
- Modify: `packages/mathcore/src/format.ts`
- Modify: `packages/mathcore/src/evaluator.ts`
- Modify: `packages/mathcore/src/workspace.ts`
- Modify: `packages/mathcore/test/parser.test.ts`
- Modify: `packages/mathcore/test/latex.test.ts`
- Modify: `packages/mathcore/test/contourSyntax.test.ts`
- Modify: `packages/app/src/expression/ValueLine.tsx`
- Modify: `packages/app/test/valueLine.test.tsx`

**Interfaces:**

- Add `PathInterval` to function definitions: the bound parameter name plus `from` and `to` expression nodes.
- Accept plain and LaTeX headers in the form `gamma(t; [0, 1]) = ...`; old headers omit the interval and resolve to the convention default.
- Evaluate interval bounds in the workspace environment, pass them to `contourIntegral`, and expose the actual interval through `ContourIntegralResult.from/to`.
- Replace the fixed UI label with a formatter that prints `[0, 2π]` for the default and numeric bounds such as `[0, 1]` for custom paths.

- [ ] **Step 1: Write failing parser, round-trip, evaluator, and UI tests**

```ts
it('parses and round-trips a path interval', () => {
  const statement = parseOrThrow('gamma(t; [0, 1]) = t + i*t^2');
  if (statement.kind !== 'function-definition') throw new Error('expected a definition');
  expect(statement.interval?.from.kind).toBe('number');
  expect(statementToText(statement)).toContain('[0, 1]');
});

it('integrates a custom path interval instead of silently using 2π', () => {
  const details = analyse('t + i*t^2', '1', '0', '1');
  expect(details.integral.from).toBe(0);
  expect(details.integral.to).toBe(1);
});
```

- [ ] **Step 2: Run the focused parser and contour tests and verify they fail because the header grammar and evaluator discard intervals**

Run: `pnpm --filter @mathviz/mathcore test -- parser.test.ts latex.test.ts contourSyntax.test.ts`

Expected: FAIL on the new interval syntax and actual `to` value.

- [ ] **Step 3: Add interval tokens, AST data, and plain/LaTeX header parsing**

Parse a single-parameter interval after a semicolon and inside square brackets. Keep the existing multi-parameter function grammar unchanged, reject malformed or reversed interval declarations with the existing parse/error result conventions, and include the interval in both text printers and plain-to-LaTeX conversion.

- [ ] **Step 4: Carry and evaluate interval bounds in workspace/evaluator**

Copy the interval into `UserFunctionDefinition`, evaluate bounds from the outer environment, require finite real values, and pass `from`/`to` to both contour detail evaluation and ordinary contour evaluation. Preserve `[0, 2π]` when no interval is declared.

- [ ] **Step 5: Render the actual interval and verify focused tests pass**

Run: `pnpm --filter @mathviz/mathcore test -- parser.test.ts latex.test.ts contourSyntax.test.ts && pnpm --filter @mathviz/app test -- valueLine.test.tsx`

Expected: PASS for default and custom intervals, including the existing `t ∈ [0, 2π]` compatibility test.

### Task 5: Full verification and documentation consistency

**Files:**

- Modify: `docs/CONVENTIONS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `README.md` only if its contour claims are now inaccurate

- [ ] **Step 1: Replace fixed-sample and fixed-interval claims in documentation**

Document adaptive winding, status-bearing singularity search, residue uncertainty, the inconclusive theorem state, and `gamma(t; [a, b])` path syntax. Keep the default convention `[0, 2π]` explicit.

- [ ] **Step 2: Run lint, typecheck, all tests, and build**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

Expected: all commands exit successfully with no new warnings.

- [ ] **Step 3: Inspect the final diff for scope and truthfulness**

Verify that no branch says “Cauchy’s theorem says zero” for an empty, uncertified pole search; no unstable winding is rounded; every residue has an error estimate; custom path intervals reach the quadrature; and existing user changes were not overwritten.
