# Convolution and sampled Fourier-product design

**Status:** proposed design

**Scope:** the first expression-first convolution vertical slice for the
Transforms subsystem. This design deliberately stops short of symbolic
convolution, Laplace transforms, inverse transforms, and claims about infinite
support.

## Objective

Add a real workspace expression for convolution so that a student can write

```text
f(t)=exp(-t^2)
g(t)=exp(-2*t^2)
h(t)=Convolution(f(t), g(t))
```

and see the two source signals and the numerically estimated convolution in a
linked time-domain view. The same sampled grid may also show the discrete
Fourier product relation, but the interface must distinguish that finite,
periodic sampled statement from the continuous Fourier convolution theorem.

## Mathematical contract

### Expression and binding

The canonical syntax is:

```text
Convolution(f(t), g(t))
```

The two arguments must be unary calls whose arguments are the same real
variable. That variable is bound by the convolution node, just as the source
variable is bound by the existing Fourier and DFT nodes. The variable of the
containing definition is the output variable; for example, `h(t)` is the
variable at which the convolution is sampled and `t` inside the two source
calls is the integration variable recorded by the node. The implementation
must make this binding explicit in the AST and in free-variable traversal; it
must not model convolution as an application of an ordinary user function.

The node represents a map from one real variable to a real or complex value:

\[
(f*g)(x) = \int_{\tau_{\min}}^{\tau_{\max}}
f(\tau)g(x-\tau)\,d\tau.
\]

The integration interval and output sampling interval are numerical settings,
not hidden syntax. The first implementation uses the shared transform time
window for both and states that choice in the result diagnostics.

### Numerical status

The result is always a finite-window numerical estimate. It must never be
labelled symbolic or exact, and it must not imply that the integral over the
whole real line has been certified. The result carries:

- output sample times and complex values;
- the integration and output windows;
- output sample count plus explicit primary and refined integration sample counts;
- an estimated refinement error, or `Infinity` when no finite comparison is
  available;
- a stability status (`stable`, `sampling-sensitive`, or `unresolved`);
- diagnostics naming finite-window truncation and any undefined/non-finite
  source evaluation.

The quadrature is the composite trapezoid rule. The refined result is the
returned value; the primary/refined difference is the refinement indicator.
This follows the contour and DFT contracts: a coarse value is never returned
while its refinement difference is presented as the error of the answer.

If either source is undefined or non-finite at any quadrature sample, the
estimate is unresolved rather than silently dropping that sample. The UI must
show the diagnostic and must not draw the invalid curve as continuous.

### Sampled Fourier-product relation

The first relation view is intentionally discrete. On the shared DFT grid,
define the periodic sampled convolution by

\[
c_n = \Delta t\sum_{m=0}^{N-1} f_m g_{(n-m)\bmod N}.
\]

With this repository's time-integral-scaled DFT convention, its DFT obeys

\[
\operatorname{DFT}(c)_k
= e^{i\omega_k t_{\min}}
\operatorname{DFT}(f)_k\operatorname{DFT}(g)_k
\]

up to floating-point error. The phase factor is required because each DFT
value uses the actual sample coordinate `t_min + n·Δt`; it becomes one only
when the sample origin is zero. The UI must call this **periodic sampled
convolution** or **DFT product check**, show the origin phase when it is not
trivial, and compare against the phase-corrected product. It must not call this
the continuous convolution theorem, and it must state that circular wrap-around
and the finite sample window are part of the calculation.

The continuous numerical convolution and this sampled relation are separate
estimates. Their differences are diagnostic evidence, not a theorem verdict.
The sampled identity check uses a scale-aware floating-point tolerance on the
same fixed grid. Sampling stability is reported separately from that identity;
finite-window quadrature error must not be used to excuse a discrepancy in the
discrete identity. If the required samples cannot be computed, the identity is
inconclusive.

## Architecture

### Mathcore

Add a `ConvolutionNode` to the canonical AST and update every exhaustive
consumer:

- text and LaTeX parsing and printing;
- child traversal and bound-variable collection;
- type inference and workspace classification;
- numerical evaluator rejection with an explicit “numerical estimator” issue;
- SymPy and GLSL lowering rejection with explicit unsupported diagnostics;
- public exports and conventions/tests.

Add a standalone convolution estimator in `mathcore`, with small pure helpers
for validation, trapezoidal integration, refinement comparison, and the
periodic sampled convolution. It must accept an evaluation environment and
settings rather than reading app state. The estimator should reuse the
repository's complex arithmetic, result/error types, tolerances, and DFT
normalisation instead of creating a second convention.

### App state and selection

Add a convolution classification and a view kind without changing the meaning
of existing `transform-pair` expressions. Active-expression selection must be
focus-first: a focused convolution definition wins, otherwise the first valid
convolution definition is used. Sampling settings remain shared state so the
source sample markers, DFT views, and product check cannot disagree.

### Convolution view

Add a linked time-domain view with:

- the two source curves;
- the estimated convolution curve;
- a legend identifying finite-window numerical convolution;
- a readout for the output coordinate and value;
- window, sample count, stability, and refinement error diagnostics;
- a clear unresolved state instead of a misleading empty plot.

When the required DFT expressions or shared source functions are available,
the view may show the periodic sampled DFT-product check as a secondary panel.
That panel must identify the sampled/circular convention and expose the
comparison error. It must not silently substitute a product result for the
continuous convolution curve.

The view should share the existing evaluator/estimate cache with readouts and
linked DFT views. Pointer movement must select or read existing samples; it
must not trigger a full convolution recomputation for every pointer event.

The existing transforms keypad entry must produce the canonical explicit
function form. The planned infix star key is not enabled for this feature,
because `*` already means pointwise multiplication and silently overloading it
would create an ambiguous expression language.

## Error and boundary handling

- Reject non-unary or non-real source variables during inference.
- Reject invalid or non-increasing windows and sample counts before evaluating.
- Treat undefined and non-finite source samples as unresolved.
- Preserve source order in the AST, but test and expose commutativity only as a
  numerical comparison; do not simplify `Convolution(f,g)` symbolically.
- Use the final refined estimate as the displayed numerical answer.
- Use `Infinity`/`unresolved` when refinement cannot produce a finite error.
- State finite-window and circular-wrap assumptions next to the corresponding
  numbers, not only in a hidden tooltip.
- Keep the implementation real-user reproducible: no demo-only data,
  hardcoded curves, or special rendering path.

## Verification plan

### Mathcore tests

1. Parse and print canonical text and LaTeX forms, including bound-variable
   traversal and malformed arity/variable diagnostics.
2. Infer `h(t)=Convolution(f(t),g(t))` as a valid real-input transform object;
   reject complex or multi-variable source calls.
3. Verify numerical constant-source convolution over a finite interval,
   commutativity within the stated refinement tolerance, and unresolved output
   for a singular/non-finite source.
4. Verify that the refined estimate is returned and the refinement difference
   is reported as its error indicator.
5. Verify periodic sampled convolution against the existing direct DFT and FFT
   routes using the exact repository normalisation, including a nonzero
   `t_min` case that requires the origin phase factor.
6. Verify symbolic and GLSL backends reject the node explicitly rather than
   producing a formal or fake pointwise result.

### App tests

1. Add the classification, active-expression selection, view label, and keypad
   coverage.
2. Verify the view renders source and convolution data from the shared estimate
   and exposes unresolved diagnostics.
3. Verify readout/cache reuse and that pointer updates do not invoke a full
   recomputation.
4. Verify the sampled product panel uses the focused source/convolution pair
   and labels circular finite sampling.

### Acceptance criteria

The feature is ready only when the full workspace test suite, lint, typecheck,
build, and the existing demo/tooling contracts pass. A reviewer must be able
to reproduce the result from the three expressions above and see the same
finite-window qualifiers and error states without relying on README changes.

## Explicit non-goals

- symbolic closed-form convolution;
- automatic support detection or an assumption that signals vanish outside the
  selected window;
- continuous whole-line Fourier theorem certification;
- FFT-based convolution as a replacement for the direct numerical reference;
- Laplace transforms, inverse transforms, or convolution theorem proofs;
- README or GIF changes in this design round.
