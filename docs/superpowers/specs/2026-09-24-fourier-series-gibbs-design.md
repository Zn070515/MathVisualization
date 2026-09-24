# Fourier Series and Gibbs Phenomenon

## Status

Proposed design for the next Transforms vertical slice. This document deliberately
limits the first implementation to real periodic signals, numerical trigonometric
Fourier series, and an honest partial-sum visualization.

## Motivation

The Transforms subsystem now has a finite-window continuous Fourier transform, DFT,
FFT, sampling/aliasing diagnostics, and interactive convolution. The next missing
concept is periodic reconstruction: a signal is represented by finitely many Fourier
coefficients, and increasing the partial-sum order makes the approximation visible.

This feature should make the Gibbs phenomenon observable without claiming an exact
symbolic series or a convergence theorem that the numerical estimator has not proved.
It should reuse the project's expression-first rule: the series must be an AST
expression that drives the numerical core and the view, not a view-only toggle.

## User-facing syntax and semantics

The first supported form is:

```text
f(u) = sign(sin(u))
S(t) = FourierSeries(f(u), 2π)
```

`FourierSeries(source-call, period)` is an expression. The source variable `u` is
bound by the node; `t` is the variable of the containing function definition. The
period expression must evaluate to one finite positive real number in the current
workspace. It may use constants and workspace parameters, but may not depend on the
source integration variable `u` or the outer evaluation variable `t`; the period is a
property of the series, not a value that changes at every evaluation point. The source
must be a unary real-valued function call. The result is a real function of the outer
variable.

The explicit source variable keeps the two roles distinct:

- `u` is the integration variable used to obtain coefficients;
- `t` is the point at which the partial sum is evaluated.

The parser and LaTeX adapter must accept the same canonical operation under their
normal surface spellings. The operation is not a builtin pointwise function and must
not be lowered as if it could be evaluated by the ordinary GPU shader.

### Discontinuous source support

To make a reproducible Gibbs example possible without mock data or hidden fixture
state, add a real-only `sign(x)` builtin with the explicit convention:

```text
sign(x) = -1 for x < 0
           0 for x = 0
          +1 for x > 0
```

Non-real input is a domain error, not an implicit use of the real part. The builtin
must be registered consistently with the parser, inference, evaluator, and GPU
lowering; no component may special-case its spelling.

## Mathematical contract

For period `P`, the first slice uses the centered base interval

```text
u ∈ [-P/2, P/2]
ω₀ = 2π/P
```

For a real source `f`, the numerical core estimates the real trigonometric
coefficients:

```text
a₀ = (2/P) ∫ f(u) du
aₙ = (2/P) ∫ f(u) cos(nω₀u) du
bₙ = (2/P) ∫ f(u) sin(nω₀u) du
```

and evaluates the order-`N` partial sum:

```text
Sₙ(t) = a₀/2 + Σ[k=1..N] (aₖ cos(kω₀t) + bₖ sin(kω₀t))
```

The integrals use composite trapezoid quadrature. A requested base grid with `Q`
intervals is compared with a refined grid with `2Q` intervals. The numerical core
must use an effective base count

```text
Q_eff = max(Q, 4N)
```

so the highest requested harmonic is not under-resolved by the coefficient grid. The
result must report both the requested count and the effective base/refined counts; the
`4N` floor is an anti-aliasing safeguard, not a convergence proof. The returned
estimate must contain both the coefficients used for the displayed partial sum and an
explicit coefficient disagreement metric. That metric is a refinement indicator, not
a rigorous error bound and not a proof of convergence. Its stability test uses the
same scale-aware tolerance convention as the existing numerical transform estimates:
`disagreement <= tolerance × max(1, largest refined coefficient magnitude)`.

The view must state the finite period, the order, the base/refined quadrature counts,
and whether the refinement was numerically stable. If the source is undefined or
non-finite on either grid, the estimate is unresolved and no partial sum is drawn.

For a discontinuity, the UI may show the visible overshoot as part of the partial-sum
plot, but it must not claim that an automatic Gibbs detector has certified the region.
It must not claim that the overshoot disappears as `N` increases, nor claim pointwise
convergence at the jump. At a sampled jump, `sign(0)=0` is the displayed source
convention; the Fourier series' midpoint behavior must not be inferred from one source
sample alone.

## Core architecture

### AST and typing

Add a `FourierSeriesNode` with:

- `source: Expr`, normally a unary call such as `f(u)`;
- `sourceVariable: string`, bound by the node;
- `period: Expr`;
- `span: SourceSpan`.

Extend all exhaustive AST consumers. Inference must verify:

1. the source is a unary call;
2. the call's final argument is exactly the node's bound source variable;
3. the source function is real-to-real;
4. the period is real and scalar.

The node's expression space is real scalar. Variable collection must treat the source
variable as bound and still collect free workspace parameters from both the source and
period. Function classification must distinguish a series pair from an ordinary real
function so focus selection does not accidentally choose the first series in a
multi-expression workspace.

### Numerical kernel

Create a core module dedicated to Fourier-series estimation. Its public result should
separate:

- the evaluated period;
- requested order `N`;
- base and refined integration interval counts;
- the coefficients used for the returned partial sum;
- coefficient refinement disagreement;
- convergence status (`converged` or `unresolved`);
- diagnostics and unresolved sample count.

Expose a pure evaluator for the returned partial sum at any finite real `t`, so the
view can sample the same mathematical estimate for plotting and readout. Do not put
React state or viewport concerns in this module.

### Backends

The numerical series node is not a pointwise GLSL expression and is not a symbolic
SymPy derivative/input. GLSL and SymPy lowering must reject it explicitly with the
same exhaustive-backend discipline used by Fourier, DFT, and convolution nodes.

## Application state and view

Add shared series settings rather than keeping order in a view-local React state:

```ts
interface FourierSeriesSettings {
  order: number;
  integrationSampleCount: number;
}
```

Use a bounded, documented set of integration counts and a positive order control.
The order is a mathematical approximation setting shared by all series
representations; the effective `Q_eff` floor above remains in the core even if a user
chooses an order larger than the requested integration count. A camera or viewport
remains view-local/persistent as appropriate.
Persist and restore these settings with the existing workspace state conventions.

Give the series representation its own persistent Cartesian frame, analogous to the
existing frequency and convolution frames. The stored value is nullable because the
first frame depends on the expression's evaluated period:

```ts
interface SeriesViewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}
```

`WorkspaceState.seriesViewport` is `SeriesViewport | null`. `null` means that no
explicit frame has been chosen yet; the view derives one centered period from the
current estimate. Once the user pans, zooms, or presses Fit, the derived frame is
stored and reused until Reset clears it back to `null`.

The initial series frame is centered on one period when the view is first inferred;
subsequent panning, zooming, and explicit Fit actions persist in `seriesViewport` and
must not alter the ordinary Cartesian or complex-plane frame.

Add a dedicated `series-domain` view kind. It is a Cartesian time-domain view with:

- the source signal and partial sum sampled over the current persistent time frame,
  whose initial frame is one centered period `[-P/2, P/2]`;
- the order-`N` partial sum over the same horizontal coordinates;
- a shared real-axis hover/selection readout represented by the existing point state
  `cx(t, 0)`, showing `t`, source value, and partial-sum value rather than using the
  separate frequency cursor;
- visible finite-window/refinement diagnostics;
- explicit order and requested integration-count controls, plus an explicit Fit action
  if the measured range leaves the persistent frame.

The view must not auto-rescale its vertical frame whenever `N` changes. A change in
the curve must remain attributable to the approximation order, with Fit as an
explicit user action. Undefined source samples split strokes rather than being
bridged.

When a series expression is focused, it should win active-series selection. A focused
source function should select its corresponding series pair before falling back to the
first series pair. This follows the existing Fourier/convolution focus rules.

## Error and diagnostic behavior

- Non-positive, non-finite, or unresolved period: no numerical estimate; show the
  reason in the view.
- Source domain error on either integration grid: return an unresolved estimate,
  preserve diagnostics, and do not draw a fabricated partial sum.
- Refinement disagreement above tolerance: draw the refined coefficients only if the
  refined grid completed, label the result sampling-sensitive, and expose the measured
  disagreement.
- No exact coefficient claim is shown, even for familiar examples such as a square
  wave.
- The feature does not infer discontinuity locations or certify Gibbs behavior. It
  visualizes the source and its partial sums; the educational interpretation remains
  explicitly numerical.

## Tests

### Mathcore

- parse and LaTeX round-trip `FourierSeries(f(u), 2π)`;
- collect the source variable as bound and preserve free period/source parameters;
- infer real-to-real output and reject complex source, non-unary source, invalid
  period type, and mismatched source variable;
- evaluate `sign` at negative, zero, positive, and non-real inputs;
- estimate known cases: constant source, `cos(u)`, and `sign(sin(u))` coefficient
  parity/decay within numerical tolerance;
- verify returned order, base/refined counts, coefficient disagreement, and partial
  sum evaluation;
- return unresolved diagnostics for a domain error on the base or refined grid;
- explicitly reject the node in GLSL and SymPy lowering.

### Application

- infer the series view from a focused series definition;
- focused series/source pairing wins over the first pair in a multi-series workspace;
- shared order/integration settings are persisted and restored;
- changing order updates the displayed estimate without changing the viewport;
- unresolved estimates show diagnostics and do not draw a partial sum;
- source undefined samples create stroke breaks;
- readout uses the same partial-sum estimate as the plotted curve.

The implementation must add tests before production code, observe the expected RED
failures, then run the full repository verification command before commit/push.

## Non-goals for this slice

- complex Fourier coefficients or complex-valued series views;
- arbitrary period intervals or phase shifts beyond the centered interval convention;
- symbolic coefficient derivation or a CAS table of exact series;
- automatic jump detection or a theorem-level Gibbs/convergence verdict;
- inverse Fourier series, Fourier transform inversion, Laplace transforms, or DFT
  equivalence checks;
- README GIF regeneration unless requested after the real feature is complete.

## Acceptance criteria

The feature is ready to register as implemented only when a user can enter the
expression pair above, see the source and numerical partial sum on the same time
axis, change `N`, observe the approximation change without silent viewport scaling,
and read diagnostics that distinguish finite numerical refinement evidence from exact
or certified mathematics. All listed core and application tests pass, and existing
lint, typecheck, build, and full test gates remain green.
