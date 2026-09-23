# Sampling, DFT, and Aliasing Design

## Status

Approved direction; implementation pending spec review.

## Goal

Add the first complete sampled-signal vertical slice to the transforms subsystem:

\[
\text{sampled signal}
\rightarrow
\text{DFT bins}
\rightarrow
\text{Nyquist band}
\rightarrow
\text{sampling-sensitive aliasing diagnostic}.
\]

The feature must distinguish a discrete Fourier transform from the existing
finite-window numerical continuous Fourier transform. It must show the samples,
the discrete frequency bins, their shared cursor/readout, and the numerical
evidence used for a sampling-stability message.

## Scope

### Included

- A dedicated `dft-transform` AST node for `DFT(f(t))`.
- Plain-text and LaTeX parsing, canonical printing, type inference, and
  expression classification for DFT pairs.
- A pure mathcore direct DFT estimator with an explicit sampling convention.
- Shared workspace sampling settings: time window and sample count.
- A DFT frequency-domain view with stem/point rendering.
- Sample markers in the linked time-domain Cartesian view.
- DFT-aware frequency cursor and readout.
- Refinement-based `stable`, `sampling-sensitive`, and `unresolved` diagnostics.
- Regression tests for parser, inference, numerical bins, Nyquist folding, and
  the linked UI data flow where practical.

### Not included

- FFT implementation or performance claims.
- Inverse DFT or reconstruction.
- Window functions, zero padding, or generic `Sample(...)` syntax.
- Fourier series, Gibbs phenomenon, convolution, or Laplace transforms.
- A claim that sampling sensitivity alone proves aliasing in the underlying
  continuous signal.

## Mathematical contract

### AST and binding

`DFT(f(t))` is represented by:

```ts
{
  kind: 'dft-transform',
  source: f(t),
  sourceVariable: 't'
}
```

`sourceVariable` is bound by the transform node. The frequency variable belongs
to the containing one-argument function definition, for example:

```text
D(ω)=DFT(f(t))
```

The source must resolve to a unary real-valued function. The DFT result is a
complex-valued one-variable transform pair.

### Sampling grid

The shared sampling settings are:

```ts
interface SamplingSettings {
  readonly timeWindow: { readonly min: number; readonly max: number };
  readonly sampleCount: number;
}
```

The default is `[-8, 8]` with `N = 64`. The sample interval is defined by:

\[
\Delta t=\frac{t_{\max}-t_{\min}}{N},
\qquad
t_n=t_{\min}+n\Delta t,
\qquad
n=0,\ldots,N-1.
\]

The interval is half-open. The endpoint `t_max` is not sampled a second time;
this keeps a periodic sampling grid from duplicating its first sample.

### DFT normalization and frequency bins

The estimator returns the time-integral-scaled forward DFT:

\[
D[k]=\Delta t\sum_{n=0}^{N-1}f(t_n)e^{-i\omega_k t_n}.
\]

For an even `N`, bins use signed indices in the principal band:

\[
k_{\mathrm{signed}}=
\begin{cases}
k,&0\le k\le N/2,\\
k-N,&N/2<k<N,
\end{cases}
\]

and

\[
\omega_k=\frac{2\pi k_{\mathrm{signed}}}{N\Delta t}.
\]

The implementation validates that the time window is finite and increasing and
that `N` is a power of two in the estimator range `2, 4, ..., 512`. The first
UI exposes the safer interactive sample counts `16, 32, 64, 128, 256, 512`;
the smaller estimator values are reserved for deterministic mathematical
reference tests and do not appear as user controls. The estimator also rejects
a request whose `2N` refinement would exceed the implementation's documented
safety cap. This keeps direct `O(N^2)` work bounded and makes the refinement
relation unambiguous.

The refined-resolution safety cap is `2N <= 1024`. The allowed UI values
therefore have `N <= 512`; direct evaluation remains bounded even when the
workspace is edited repeatedly.

The derived sampling frequency is reported in cycles per unit,
`samplingFrequency = 1 / Δt`. The Nyquist value is reported in angular
frequency, `nyquistAngularFrequency = π / Δt`; the two units are deliberately
kept separate in the API and UI.

For even `N`, the `k = N/2` bin is the single positive Nyquist representative.
There is no second negative-Nyquist bin. The UI therefore treats the boundary
as identified even though it prints the canonical positive value `+π/Δt`.

Because the exponent uses the actual sample time `t_n`, a nonzero `t_min`
contributes the corresponding phase factor. This is intentional: the returned
complex value is the time-integral-scaled spectrum in the workspace's time
coordinate, not a phase-reset sequence that silently replaces `t_n` with `nΔt`.

The DFT convention, units, normalization, signed-bin rule, and Nyquist boundary
rule must be registered in `packages/mathcore/src/conventions.ts` alongside the
existing continuous Fourier convention. The estimator and UI consume that
shared convention rather than defining independent constants.

The estimator is intentionally direct `O(N^2)` work. It is called a DFT in the
UI and diagnostics; it is not called an FFT.

### Refinement and sampling status

The estimator computes the requested resolution `N` and a refined resolution
`2N` over the same half-open time window. To compare like with like, a primary
bin with signed index `m` is compared with the refined bin whose signed index is
`2m` (equivalently, refined array index `(2m mod 2N)`). This compares exactly
the same angular frequency because both grids cover the same total window.

The returned `estimatedError` is the largest finite complex difference over
those common bins. It is a *refinement difference*, not a certified bound on the
unknown error of the DFT relative to an exact continuous transform. The UI must
label it as a refinement/stability quantity and must not present it as a proof
of exactness. A scale-normalized refinement ratio is also computed for the
status decision:

```text
stable             relative refinement difference <= tolerance
sampling-sensitive relative refinement difference > tolerance
unresolved         non-finite samples or no comparable finite bins
```

The default tolerance is a documented numerical constant in mathcore. The UI
must describe `sampling-sensitive` as evidence that the sampled representation
is not stable under refinement; it may be caused by aliasing, unresolved
high-frequency content, discontinuity, or finite-window effects. It must not
claim that aliasing has been formally proven for an arbitrary expression.

The DFT representation itself always has a principal Nyquist band:

\[
|\omega|\le \frac{\pi}{\Delta t}.
\]

Content represented outside that band is folded into the principal bins by the
discrete sampling convention. The UI may state this convention and show the
observed peak bin, but it must not infer an original continuous frequency that
the expression has not independently exposed. `stable` means only stable under
the implemented `N → 2N` refinement; it does not certify that the original
continuous signal contains no aliased component.

## Data flow

```text
DFT(f(t)) AST
      │
      ├── workspace inference/classification
      │
      ├── shared SamplingSettings
      │       │
      │       └── estimateDft(N) and estimateDft(2N)
      │                    │
      │                    ├── Cartesian sample markers
      │                    ├── DFT stems and bins
      │                    └── readout / stability diagnostics
      │
      └── focused transform-pair selection
```

The mathcore estimator is pure and knows nothing about React, storage, or
canvas. The app owns the cache keyed by workspace, active entry, parameters,
and sampling settings. The Cartesian view and DFT view consume the same cached
estimate rather than independently sampling the source.

## View and interaction model

### View kind

Add a separate `dft-domain` view kind. The existing `frequency-domain` view
continues to mean the continuous Fourier estimate. This prevents the renderer,
legend, and numerical wording from silently changing mathematical meaning.

The default views for a DFT pair are:

```text
cartesian-2d
dft-domain
```

The DFT view uses the existing shared frequency viewport and explicit `Fit`
action. It must not auto-rescale the y-axis as sample count or parameters
change.

### Time-domain samples

When the active expression is a DFT pair, the Cartesian view draws the source
curve as before and overlays finite sample markers at `t_n`. Non-finite source
values produce no marker and do not connect across a discontinuity.

### DFT spectrum

The DFT view renders each bin as a stem terminating at the projected value. It
supports the existing projections:

```text
magnitude | phase | real | imaginary
```

The x-coordinate is the actual `ω_k` returned by the estimator. Hover and
selection snap to an existing bin, never to an interpolated value.

### Shared readout

For a DFT pair, the frequency readout includes:

```text
k, signed k, ω_k, D[k], |D[k]|, Δt, Nyquist, stability
```

The continuous Fourier readout remains unchanged. Focused transform-pair
selection is authoritative when several Fourier or DFT pairs coexist.

### Sampling controls

The first UI exposes the sample count and displays the derived values:

```text
N, Δt, sampling frequency, Nyquist angular frequency
```

The time window remains a shared explicit setting with the documented default;
it is not silently changed when `N` changes. Changing `N` therefore changes
`Δt` and the Nyquist limit in a visible, reproducible way.

## Compatibility and unsupported backends

The new AST node must be handled explicitly by every exhaustive mathcore
consumer:

- numeric point evaluation rejects it as a non-pointwise transform;
- symbolic lowering rejects it with a numerical-DFT explanation;
- GLSL lowering rejects it with a frequency-domain explanation;
- formatting and LaTeX printing preserve the DFT notation;
- variable collection treats the source variable as bound.

Existing continuous Fourier behavior must remain unchanged.

## Test gates

### Mathcore

- Plain and LaTeX parsing produces `dft-transform` and binds the source
  variable.
- Canonical plain/LaTeX printing round-trips the node.
- Inference accepts a real source and rejects complex/vector sources.
- A constant signal has the expected DC value under `Δt` scaling.
- An on-grid sinusoid peaks at its signed frequency bin.
- `sampleInterval`, bin spacing, sampling frequency, and Nyquist are exact for
  a known window and `N`.
- A frequency above Nyquist folds to the expected principal bin. The regression
  uses a time-aligned real sinusoid whose coarse-grid samples are identical to
  a lower-frequency sinusoid, then verifies that doubling `N` changes the
  resolved principal-band representation.
- Refinement reports stable and sampling-sensitive cases distinctly.
- Non-finite samples produce `unresolved` rather than a fabricated spectrum.

### App/state

- Sampling settings have deterministic defaults and persistence/migration-safe
  loading.
- DFT pairs select `cartesian-2d` plus `dft-domain` by default.
- DFT view and Cartesian markers consume the same estimate.
- DFT cursor/readout uses an actual bin and does not pair a cursor frequency with
  a different bin value.
- Multiple transform pairs obey focused-expression selection.

### Regression boundary

The feature is complete only when the existing continuous Fourier tests still
pass and the DFT tests prove that no continuous Fourier estimate is being
silently relabelled as a DFT.
