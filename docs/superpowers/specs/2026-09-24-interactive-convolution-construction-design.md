# Interactive Convolution Construction Design

**Status:** proposed design

**Related design:** `docs/superpowers/specs/2026-09-23-convolution-design.md`

**Scope:** the next Transforms vertical slice: make the numerical construction
of a finite-window convolution visible while preserving the existing
expression-first, shared-state and numerical-uncertainty contracts.

This design does not add a new AST node, a symbolic convolution backend, or a
new subsystem. It extends the existing convolution estimator and
`ConvolutionView`.

## Objective

For an expression such as

```text
f(t)=exp(-t^2)
g(t)=exp(-2*t^2)
h(t)=Convolution(f(t),g(t))
```

and a selected output coordinate $t=T$, show the actual finite-window
construction:

\[
f(\tau),\qquad g(T-\tau),\qquad
q_T(\tau)=f(\tau)g(T-\tau),
\]

followed by the accumulated integral

\[
A_T(\tau)=\int_{a}^{\tau}q_T(u)\,du,
\qquad
(f*g)(T)\approx A_T(b),
\]

where $[a,b]$ is the explicitly displayed finite integration window.

The feature must make the sequence

```text
sample → shift → multiply → accumulate
```

visible. It must not imply that a finite numerical window proves the
whole-real-line convolution.

## Product decisions

### One shared output coordinate

The construction coordinate $T$ is not a new local mathematical state.
It is the existing linked workspace coordinate:

```text
T = hover ?? selection
```

Moving the pointer over the existing convolution output plot changes $T$.
Holding a point keeps $T$ selected across linked views. The construction
panel reads this same value, so the source curves, output curve, readout and
construction cannot disagree about which convolution slice is being shown.

If there is no hover or selection, the construction panel shows an explicit
prompt to select or move over an output coordinate. It does not silently pick
zero or the centre of the window.

### Finite-window numerical meaning

The integration variable is sampled on the shared convolution integration
window:

\[
\tau_j=a+j\Delta\tau,
\qquad
\Delta\tau=\frac{b-a}{M-1}.
\]

At every sample the evaluator computes the two actual arguments separately:

```text
left  = f(τj)
right = g(T - τj)
product = left * right
```

The shifted curve is therefore not a translated copy of a previously sampled
array. It is evaluated at $T-τ_j$, including parameter values and
complex-valued source results.

The returned construction samples use the refined $2M$ grid. The primary
and refined counts are both reported, following the existing convolution
estimate contract. The refined product and accumulated integral are the
displayed numerical answer; the primary/refined comparison is only a
refinement indicator.

### Accumulation rule

For consecutive resolved samples, the accumulated values use composite
trapezoid increments:

\[
A_{j+1}=A_j+\frac{\Delta\tau}{2}
\left(q_T(\tau_j)+q_T(\tau_{j+1})\right).
\]

For a fully resolved window, the first accumulated value is zero at
\(\tau_0=a\). If a product sample is unresolved, the accumulated value at
that index and every later index is `null`: the prefix integral from \(a\) is
no longer known. The source and product curves still expose their resolved
segments for inspection, but no post-gap accumulator is restarted at zero or
presented as the total convolution.

The construction estimate exposes the final accumulated value for the fully
resolved window and a refinement indicator. It does not add a second
quadrature convention: the same complex arithmetic, finite-window language,
and numerical status vocabulary as `estimateConvolution()` are used.

## Data contract

The mathcore estimator should expose a pure result shaped like the following
contract. Exact field names may follow repository naming conventions, but the
meaning of each field is fixed here:

```ts
interface ConvolutionConstructionEstimate {
  readonly outputTime: number;
  readonly integrationWindow: ConvolutionWindow;
  readonly tau: readonly number[];
  readonly leftValues: readonly (Complex | null)[];
  readonly shiftedRightValues: readonly (Complex | null)[];
  readonly productValues: readonly (Complex | null)[];
  readonly accumulatedValues: readonly (Complex | null)[];
  readonly segments: readonly {
    /** Inclusive indices into all four sample arrays. */
    readonly startIndex: number;
    readonly endIndex: number;
  }[];
  readonly primaryIntegrationSampleCount: number;
  readonly refinedIntegrationSampleCount: number;
  readonly estimatedError: number;
  readonly stability: ConvolutionStability;
  readonly diagnostics: readonly string[];
}
```

`null` is a deliberate unresolved sample, not a zero value. `segments` gives
the renderer an unambiguous way to break the source and product curves at an
invalid sample; `startIndex` and `endIndex` are inclusive indices into `tau`
and the four parallel sample arrays. The accumulation array is additionally
null after the first unresolved prefix, so it cannot be mistaken for a
restarted integral.
The estimator may return an unresolved status while still returning resolved
segments for educational inspection. It must never interpolate across a
missing value or turn it into a continuous curve.

The `estimatedError` compares corresponding primary and refined accumulated
results at the same output time. It is `Infinity` when either refinement
cannot be compared honestly. This is a discretisation indicator, not a bound
for truncation outside $[a,b]$.

## UI design

### Existing output plot

The existing convolution plot remains the primary plot and continues to show:

```text
f(t) · g(t) · (f*g)(t)
```

Its pointer interaction remains the source of the shared $T$ coordinate.
The existing finite-window and refined-integration diagnostics remain visible.

### Construction toggle

The legend gains a real interactive control:

```text
show convolution construction
```

It defaults to off so the existing output view stays readable. Toggling it
does not change workspace mathematics, selection, caching keys, or numerical
settings; it only controls whether the linked construction panel is rendered.

### Construction panel

When enabled and $T$ exists, the view adds a second canvas below the output
plot with one shared horizontal axis labelled $τ$:

1. An integrand band draws $f(τ)$, $g(T-τ)$, and
   $q_T(τ)=f(τ)g(T-τ)$, with a legend identifying each curve.
2. An accumulation band draws $A_T(τ)$ using the same $τ$ samples.
3. The panel states `T = ...`, `τ ∈ [a,b]`, the refined sample count, and
   the finite-window qualifier.

The two bands may use separate measured vertical ranges because the product
and accumulated integral have different scales. Each range is labelled as a
measured display range; no range is presented as a mathematical bound.

The construction panel is read-only in the first slice. Selecting or moving
over the existing output plot is sufficient to drag $T$, and avoids adding
another pointer interaction whose coordinate could diverge from the shared
workspace selection.

### Projection and complex values

The existing convolution `FieldMode` controls the displayed projection:

```text
real       → Re
imaginary  → Im
magnitude  → |·|
phase      → arg, with zero-magnitude samples omitted
```

The product and accumulation are computed as complex values first, then
projected for drawing. This preserves the same mathematical object across
the output and construction representations. The legend must not call a
projected curve an exact real convolution when the underlying values are
complex.

## Error and boundary handling

- A non-finite or undefined value in either $f(τ)$ or $g(T-τ)$
  produces a `null` sample and a diagnostic naming the argument that failed.
- All rendered paths break at `null`; no line crosses an unresolved sample.
- If a gap exists, the accumulation path also breaks. The UI says that the
  full-window accumulation is unresolved instead of displaying the last
  segment's value as the convolution result.
- If $T$ is finite but outside the output window, the construction may still
  be evaluated because $T$ is a linked coordinate from another view. The
  panel states the selected $T$ explicitly and keeps the integration window
  unchanged.
- An empty or invalid time window is rejected before evaluation and produces
  the existing unresolved diagnostic path.
- A sampling-sensitive result remains visible, but its status and refinement
  indicator stay next to the numbers.
- No symbolic closed form, support inference, extrapolation, or whole-line
  convergence claim is added.

## Architecture and file responsibilities

### Mathcore

Modify `packages/mathcore/src/convolution.ts` to add the pure construction
estimate and its validation/helpers. Reuse `ConvolutionNode`,
`EvaluationEnvironment`, complex arithmetic, `Result`, and existing numerical
status types. Add focused tests in
`packages/mathcore/test/convolution.test.ts`.

### App evaluation

Modify `packages/app/src/views/convolutionEvaluation.ts` to select the active
convolution, build the evaluator environment, cache construction estimates by
workspace, active expression, parameter values, output time, and numerical
settings, and expose projection helpers. Cursor-only updates must reuse an
identical estimate when $T$ has not changed.

### App view

Modify `packages/app/src/views/ConvolutionView.tsx` to own only the visual
toggle, consume the shared $T$, draw the construction canvases, and display
diagnostics. Keep mathematical evaluation out of pointer handlers.

Add only the CSS needed for the second panel and controls. Do not create demo
state, hardcoded curves, or a separate recording path.

### Capability registry

After the feature and tests pass, change only the capability entry for
`Interactive convolution construction` from `planned` to `implemented`.
Numerical convolution and sampled DFT product remain separately described.

## Verification plan

### Mathcore tests

1. For constant or Gaussian sources, verify the shifted right values use
   $T-τ$, not $T+τ$ or a translated sample index.
2. Verify the final accumulated value agrees with the existing finite-window
   convolution estimate within the refinement indicator.
3. Verify primary/refined sample counts and the refined grid are returned.
4. Verify a singular source produces `null`/broken segments and an unresolved
   status without bridging the gap.
5. Verify complex multiplication occurs before real/magnitude projection.
6. Verify invalid $T$, window, and sample-count inputs return explicit
   diagnostics without NaN paths.

### App tests

1. Verify the construction toggle is keyboard accessible and does not alter
   shared workspace selection.
2. Verify changing the linked $T$ changes the construction data and the
   displayed `T` readout.
3. Verify the construction panel uses the cached estimate and does not run
   numerical integration inside pointer handlers.
4. Verify unresolved samples render a diagnostic and do not produce a
   continuous canvas path across the gap.
5. Verify capability registry reports numerical convolution, sampled DFT
   product, and interactive construction as separate capabilities with the
   correct statuses.

### Acceptance criteria

The feature is ready only when the full workspace tests, lint, typecheck,
build, and tooling contracts pass. A user can enter the three expressions in
this document, move across the output curve, and observe the same $T$
driving the shifted signal, product, and accumulation. Every displayed
number remains labelled as a finite-window numerical result with its
refinement status.

## Explicit non-goals

- No changes to the canonical AST or parser.
- No symbolic convolution or CAS claim.
- No automatic support detection or whole-line extension.
- No continuous convolution theorem verdict.
- No Laplace transform or inverse transform work.
- No README or GIF changes in this feature round.
