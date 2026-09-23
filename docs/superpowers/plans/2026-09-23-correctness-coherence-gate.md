# Correctness and Coherence Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the reviewed mathematical misrepresentations and restore one coherent source of truth across mapped grids, Fourier readouts, contours, symbolic derivatives, linked views and reset controls.

**Architecture:** Preserve the existing expression-first evaluator and view taxonomy. Fix discontinuities and numerical contracts at the math/view boundaries, move mathematical direction state into `WorkspaceState`, and share Fourier estimates through a derived cache keyed by the active transform and numerical settings. Every user-visible assertion must retain its uncertainty or unresolved status.

**Tech Stack:** TypeScript, React, Vitest, Vite, SymPy adapter, Canvas 2D/WebGL views, hand-written external store.

**Spec:** The accepted correctness/coherence review in the conversation; no README changes.

## Global Constraints

- Do not modify README or deployment documentation.
- Do not hide unresolved, undefined, unsupported or non-holomorphic mathematical states.
- Preserve the canonical AST/evaluator as the source of numerical truth.
- Every behavior change gets a failing regression test before implementation.
- Run `pnpm verify` before completion and push the completed round to `main`.

---

### Task 1: Preserve undefined gaps in mapped grids

**Files:**

- Modify: `packages/app/src/views/MappedGridView.tsx`
- Test: `packages/app/test/mappedGridView.test.ts` or a pure helper test beside the view

**Interfaces:**

- Produce a mapped-polyline segmentation helper that converts sampled `Complex | null` values into contiguous finite segments.

- [x] Write a failing test proving an undefined sample splits one mapped line into two segments and never joins the samples on either side.
- [x] Run the focused test and verify it fails because the segmentation helper is absent or the current line is continuous.
- [x] Implement the minimal segment representation and make the renderer stroke each segment independently.
- [x] Add the segmentation regression through the mapped-grid renderer boundary.
- [x] Run the focused test and the existing mapped-grid/typecheck tests.

### Task 2: Snap frequency readout to the rendered frequency grid

**Files:**

- Modify: `packages/app/src/views/FrequencyDomainView.tsx`
- Modify: `packages/app/src/readout/ReadoutBar.tsx`
- Modify or create: `packages/app/src/views/frequencyEvaluation.ts`
- Test: `packages/app/test/frequencyEvaluation.test.ts` and readout regression coverage

**Interfaces:**

- Expose one helper that maps arbitrary pointer frequency to the actual nearest rendered frequency sample.
- Readout must display the snapped frequency used to obtain `F(ω)`.

- [x] Write a failing test for pointer frequency `0.037` on a `0.1` grid, expecting displayed/evaluated frequency `0`.
- [x] Run the focused test and verify the current code retains `0.037` while reading the `0` sample.
- [x] Implement snapping at the frequency-view/readout boundary and route both label and value through the snapped number.
- [x] Run frequency and readout tests.

### Task 3: Return the refined contour integral result

**Files:**

- Modify: `packages/mathcore/src/contour.ts`
- Test: `packages/mathcore/test/contour.test.ts`

**Interfaces:**

- `ContourIntegralEstimate.value`, trajectory and path metadata must correspond to the fine quadrature; `estimatedError` remains the fine/coarse refinement difference.

- [x] Add a test whose evaluator makes coarse and fine quadratures distinguishable and asserts the returned value is fine.
- [x] Run it red against the current coarse return value.
- [x] Return the fine estimate and keep the error estimate tied to the two refinement levels.
- [x] Run all contour tests.

### Task 4: Make symbolic parameters available and guard complex analyticity

**Files:**

- Modify: `packages/app/src/symbolic/SymbolicPanel.tsx`
- Modify: `packages/mathcore/src/sympy.ts` or add a symbolic semantic helper
- Test: relevant symbolic panel/core tests

**Interfaces:**

- Symbolic differentiation receives function variables plus workspace parameter names as symbolic constants.
- Complex derivatives for expressions containing `conj`, `re`, `im`, `abs` or `arg` must not be labelled certified exact complex derivatives.

- [x] Add regression tests for workspace parameters and a non-holomorphic `conj(z)` request.
- [x] Run focused tests red before implementation.
- [x] Include `ActiveExpression.parameterNames` without substituting slider values.
- [x] Return/display an explicit non-holomorphic guard for unsupported complex derivative semantics.
- [x] Run symbolic, app and typecheck tests.

### Task 5: Respect focused transform pairs

**Files:**

- Modify: `packages/app/src/state/workspaceStore.ts`
- Test: `packages/app/test/workspaceStore.test.ts`

**Interfaces:**

- Active expression selection chooses a focused transform pair, then a pair associated with a focused source, then the first pair.

- [x] Add a failing multi-pair focus test.
- [x] Run it red.
- [x] Implement focused-pair selection without breaking focused non-pair expressions.
- [x] Run workspace tests.

### Task 6: Move directional vector into linked workspace state

**Files:**

- Modify: `packages/app/src/state/workspaceStore.ts`
- Modify: `packages/app/src/views/GradientView.tsx`
- Modify: persistence only if the direction is intentionally persisted
- Test: `packages/app/test/workspaceStore.test.ts` and directional view state tests

**Interfaces:**

- Store a unit direction in `WorkspaceState`; GradientView reads and updates it so multiple gradient views share `u`.

- [x] Add a failing store test proving a direction update is visible to every linked view.
- [x] Run it red.
- [x] Add `direction` plus `setDirection` action and replace component-local angle state.
- [x] Ensure handle geometry and derivative calculation consume the shared vector.
- [x] Run workspace, app and persistence tests.

### Task 7: Surface singularity-search uncertainty

**Files:**

- Modify: `packages/app/src/views/ComplexPlaneView.tsx`
- Modify if needed: `packages/mathcore/src/zerosAndPoles.ts` public result types
- Test: `packages/app/test/complexPlaneView.test.tsx` or pure result formatting test

**Interfaces:**

- ComplexPlane consumes the full `SingularitySearchResult` and renders incomplete/unresolved/truncated state.

- [x] Add the full analysis result to the ComplexPlane rendering boundary.
- [x] Replace the compatibility wrapper call with the full analysis result and render a warning/status line.
- [x] Run complex view/typecheck coverage.

### Task 8: Make reset and frequency default mode consistent

**Files:**

- Modify: `packages/app/src/state/workspaceStore.ts`
- Modify: `packages/app/src/views/ViewCanvas.tsx`
- Modify: `packages/app/src/state/viewKinds.ts`
- Test: workspace/view-kind tests

**Interfaces:**

- `resetViewport` or a global reset resets 2D viewport, 3D camera and frequency viewport.
- `defaultModeForView(kind, signature)` returns magnitude for frequency-domain.

- [x] Add failing tests for full reset and manually added frequency view mode.
- [x] Run red.
- [x] Implement the view-aware default and complete reset action.
- [x] Run relevant app tests.

### Task 9: Share Fourier estimates between view and readout

**Files:**

- Modify: `packages/app/src/state/workspaceStore.ts` or a dedicated Fourier derived cache module
- Modify: `packages/app/src/views/FrequencyDomainView.tsx`
- Modify: `packages/app/src/readout/ReadoutBar.tsx`
- Test: `packages/app/test/frequencyEvaluation.test.ts`

**Interfaces:**

- One derived estimate keyed by active expression, parameters, window and numerical settings feeds both renderer and readout.

- [x] Add a regression test proving repeated view/readout access reuses one estimate.
- [x] Run it red before implementation.
- [x] Implement a memoized derived estimate with invalidation on expression/parameter/settings changes, not pointer hover.
- [x] Run frequency, readout and performance-oriented tests.

### Task 10: Make contour levels explicit while retaining auxiliary ticks

**Files:**

- Modify: `packages/app/src/views/ContourView.tsx`
- Modify: `packages/app/src/state/workspaceStore.ts` if level belongs in linked state
- Test: contour view/pure level selection tests

**Interfaces:**

- A selected level `c` is stable across parameter and viewport changes; auto-generated ticks remain visibly auxiliary.

- [x] Add a store regression showing an explicit level remains `c=1` when the sampled range changes.
- [x] Run it red before implementation.
- [x] Add explicit linked level state/control and label the automatic levels as auxiliary.
- [x] Run contour and app tests.

### Task 11: Full regression verification

- [x] Run `pnpm verify`.
- [x] Confirm README is unchanged with `git diff --name-only -- README.md`.
- [x] Confirm `git diff --check` is clean.
- [x] Review all user-visible mathematical messages for unresolved/approximate wording.

### Task 12: Commit and push

- [ ] Commit the complete gate with a focused message.
- [ ] Push `main` directly to `origin`.
- [ ] Report the commit and CI status; do not claim GitHub CI green before it runs.
