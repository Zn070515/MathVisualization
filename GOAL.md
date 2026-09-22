# GOAL.md

# Project Goal

## 1. Project Overview

This project is a modern, expression-first mathematical exploration environment focused on three equally important areas:

1. **Complex Analysis**
2. **Integral Transforms**
3. **Multivariable Calculus**

The project is not intended to be a general-purpose replacement for Desmos, GeoGebra, Mathematica, MATLAB, or a full computer algebra system.

Its purpose is to provide a unified, interactive environment in which mathematical expressions, symbolic analysis, numerical evaluation, geometric interpretation, and visualization are tightly connected.

The core product idea is:

> **Expression first, visualization second, mathematical understanding throughout.**

Users should begin by writing mathematics, not by selecting a tool, entering a professional workflow, or navigating a large command hierarchy.

The system should understand the mathematical object represented by an expression, infer the relevant domain/codomain and capabilities, and then expose suitable analysis and visualization tools contextually.

The intended experience should feel closer to **Desmos in interaction philosophy** than to a traditional professional mathematics package, while providing much deeper support for complex analysis, integral transforms, and multivariable calculus.

---

# 2. Top-Level Product Structure

The project is divided into **three first-class subsystems**.

None of the three is considered secondary.

The root homepage serves as a lightweight entry and routing page.

Suggested route structure:

```text
/
├── /complex
├── /transforms
└── /calculus
```

Equivalent final route names are acceptable if they remain concise and semantically clear.

Recommended canonical URLs:

- `/complex` — Complex Analysis
- `/transforms` — Integral Transforms
- `/calculus` — Multivariable Calculus

The homepage MUST NOT become a large dashboard.

Its main responsibilities are:

- communicate the product identity,
- explain the three mathematical areas briefly,
- route the user into one of the three subsystems,
- provide access to documentation/help/examples if needed.

The homepage should remain visually lightweight.

---

# 3. Account and User System Boundary

## 3.1 Current Requirement

**No account system is required at the current stage.**

Do not implement:

- registration,
- login,
- OAuth,
- user profiles,
- cloud accounts,
- permissions,
- roles,
- organization management,
- subscription logic,
- personal dashboards.

The mathematical experience must work without authentication.

## 3.2 Local Persistence

Local persistence is allowed and desirable where useful.

Examples:

- local workspace state,
- recent expressions,
- local preferences,
- recent documents,
- view layout,
- graph settings.

Suitable mechanisms may include:

- LocalStorage,
- IndexedDB,
- downloadable project files.

The project should not require a backend merely to remember local mathematical work.

## 3.3 Future Compatibility

The architecture should not deliberately prevent a future account/sync system, but no current implementation should be designed around one.

Authentication is explicitly **out of scope** until separately requested.

---

# 4. Core Product Philosophy

## 4.1 Expression-First

The expression is the primary interaction unit.

Examples:

```text
f(z) = sin(z)/(z^2 + 1)
```

```text
gamma(t) = 2e^(it)
```

```text
F(w) = Fourier(f(t))
```

```text
F(s) = Laplace(f(t))
```

```text
f(x,y) = x^2 - y^2
```

```text
F(x,y) = (-y, x)
```

The user should not need to first select:

```text
Complex Analysis
→ Contour Integral Tool
→ Create Function
→ Add Path
→ Evaluate
```

The preferred interaction is:

```text
f(z) = ...
gamma(t) = ...
∮_gamma f(z) dz
```

The software should interpret the mathematics and expose relevant actions.

---

## 4.2 Mathematical Objects Determine Available Tools

The system should infer object types such as:

```text
R -> R
R^2 -> R
R^2 -> R^2
R^3 -> R
R^3 -> R^3
C -> C
R -> C
ParametricCurve
ParametricSurface
ScalarField
VectorField
ComplexPath
TransformPair
```

Examples:

```text
f(z) = z^2
```

should be understood as approximately:

```text
C -> C
ComplexFunction
```

and make relevant capabilities available:

- domain coloring,
- z-plane / w-plane mapping,
- magnitude,
- phase,
- analyticity,
- zeros,
- poles,
- contour operations.

By contrast:

```text
f(x,y) = x^2 + y^2
```

should expose:

- surface,
- contour,
- heatmap,
- gradient,
- directional derivative,
- tangent plane,
- double integral.

The UI should reveal capabilities contextually rather than through a large permanent toolbar.

---

# 5. Global UI Principles

## 5.1 Default Layout

The default desktop layout should be conceptually simple:

```text
┌────────────────────┬──────────────────────────────────────┐
│                    │                                      │
│    Expressions     │               Canvas                 │
│                    │                                      │
└────────────────────┴──────────────────────────────────────┘
```

A third inspector panel may exist, but it should be hidden by default and opened only when necessary.

The project should avoid looking like a professional engineering package.

Avoid default layouts dominated by:

- dense ribbon toolbars,
- large command menus,
- permanent property panels,
- object trees,
- mode selectors,
- large numbers of visible controls.

---

## 5.2 Progressive Disclosure

Simple mathematical tasks should look simple.

Advanced functionality should remain available without being visible all the time.

For example:

```text
f(z) = sin(z)/(z^2+1)
```

may display compact contextual actions such as:

```text
[C -> C]  [Visualize]  [Analyze]
```

The deeper capabilities appear only when requested.

---

## 5.3 Linked Views

A mathematical object may have multiple simultaneous representations.

For example, a complex function may be shown through:

- domain coloring,
- z-plane,
- w-plane,
- mapped grid,
- magnitude surface,
- phase,
- real part,
- imaginary part.

All views should share one mathematical state.

If the user selects or hovers over:

```text
z0 = 0.8 + 1.2i
```

every active view should update consistently.

Shared cursor / shared selection / shared parameter state is a core product requirement.

---

## 5.4 Views Are Composable

The canvas should support:

- a single view,
- split views,
- multiple linked panes,
- switching views,
- rearranging views where reasonable.

The initial state should remain simple.

The user may progressively build layouts such as:

```text
┌────────────────────┬────────────────────┐
│ Domain Coloring    │ z-plane            │
├────────────────────┼────────────────────┤
│ Magnitude Surface  │ w-plane            │
└────────────────────┴────────────────────┘
```

Multi-view capability must not force the default UI into a permanent dashboard.

---

## 5.5 Mathematical Notation Over Software Commands

Whenever practical, operations should be expressible as mathematics.

Preferred:

```text
∮_gamma f(z) dz
```

rather than:

```text
ContourIntegral(function=f, path=gamma)
```

Preferred:

```text
L{f(t)}
```

or an equivalent readable transform notation rather than a workflow dialog.

Textual functions may still be supported for keyboard efficiency and parsing.

The visible UI should favor conventional mathematical notation.

---

# 6. Shared Mathematical Core

The three subsystems must share a common mathematical foundation.

They must not become three unrelated applications.

Conceptually:

```text
Expression
    ↓
Parser
    ↓
AST
    ↓
Type Inference
    ↓
Mathematical Object
    ├── Numerical Evaluation
    ├── Symbolic Analysis
    └── Visualization
```

---

## 6.1 Single Mathematical AST

There should be one canonical internal mathematical representation.

Do not independently implement incompatible expression semantics for:

- frontend plotting,
- symbolic backend,
- GPU rendering,
- numerical evaluation.

For example:

```text
f(z) = sin(z)/(z^2+1)
```

should produce one AST that can be translated into:

- a fast numerical evaluator,
- a symbolic representation for CAS operations,
- GPU shader-compatible evaluation where appropriate.

The AST and mathematical type system are core architecture components.

---

## 6.2 Shared Parameters

Parameters should work consistently across all subsystems.

Example:

```text
a = 2
```

may create a slider.

If:

```text
f(z) = z^a
```

or:

```text
f(t) = exp(-a t)
```

or:

```text
f(x,y) = x^2 + a y^2
```

depends on `a`, all related visualizations should react live.

---

## 6.3 Symbolic vs Numerical Responsibilities

The project should distinguish:

### Symbolic Mathematics

Examples:

- derivatives,
- symbolic integrals,
- residues,
- Taylor/Laurent expansions,
- Fourier transforms where symbolic forms exist,
- Laplace transforms,
- inverse transforms,
- simplification,
- singularity analysis.

### Numerical Mathematics

Examples:

- graph sampling,
- numerical integration,
- contour sampling,
- FFT,
- numerical transform evaluation,
- vector fields,
- surface sampling,
- streamlines,
- interactive animation.

A CAS library such as SymPy should be used where appropriate.

The project must not attempt to reimplement a general-purpose CAS from scratch.

---

# 7. Subsystem I — Complex Analysis

Complex Analysis is a complete first-class subsystem.

The subsystem should support both foundational complex-number concepts and advanced course-level complex analysis.

---

## 7.1 Complex Numbers

Support:

- algebraic form,
- polar form,
- exponential form,
- real part,
- imaginary part,
- magnitude,
- argument,
- conjugate,
- arithmetic,
- powers,
- roots,
- exponential,
- logarithm,
- trigonometric functions,
- hyperbolic functions.

Complex values should be naturally represented in the complex plane.

---

## 7.2 Complex Functions

Support:

```text
f : C -> C
```

with arbitrary supported expressions such as:

```text
f(z) = z^2
f(z) = exp(z)
f(z) = sin(z)/(z^2+1)
f(z) = (z-1)/(z+1)
```

The subsystem should support both evaluation and visualization.

---

## 7.3 Domain Coloring

Domain coloring is a core native visualization.

It should not be treated as an external plugin or experimental feature.

It should support meaningful mappings of:

- argument to hue,
- magnitude to brightness/value,
- optional modulus bands,
- optional phase contours,
- zeros/poles emphasis.

Users should be able to inspect the precise complex value under the cursor.

---

## 7.4 z-Plane / w-Plane Mapping

For:

```text
w = f(z)
```

support linked input/output planes.

Users should be able to visualize transformations of:

- points,
- lines,
- circles,
- grids,
- paths,
- regions,
- polygons where appropriate.

Changes in the z-plane should update the w-plane interactively.

---

## 7.5 Mapped Grids and Conformal Mapping

Support visualization of standard mappings such as:

```text
z^2
exp(z)
1/z
sin(z)
z + 1/z
(az+b)/(cz+d)
```

Users should be able to inspect local angular behavior and geometric deformation.

The system should support educational exploration of conformal mappings rather than merely plotting output coordinates.

---

## 7.6 Magnitude, Phase, Real, Imaginary Views

For a complex function, support:

```text
|f(z)|
arg(f(z))
Re(f(z))
Im(f(z))
```

Visualization modes may include:

- heatmaps,
- contours,
- 3D surfaces,
- linked cursor readouts.

---

## 7.7 Complex Differentiability

Support the course-level meaning of complex differentiability.

The system must not silently substitute a different derivative convention in a way that creates pedagogical confusion.

Support exploration of:

```text
f'(z)
```

through:

- symbolic derivative where valid,
- directional approach,
- difference quotient,
- local behavior.

---

## 7.8 Cauchy-Riemann Analysis

For:

```text
f(z) = u(x,y) + i v(x,y)
```

derive or expose:

```text
u_x
u_y
v_x
v_y
```

and analyze:

```text
u_x = v_y
u_y = -v_x
```

The subsystem should support visualizing Cauchy-Riemann residuals such as:

```text
u_x - v_y
u_y + v_x
```

as spatial fields.

The goal is to show where conditions hold or fail, not only return a Boolean conclusion.

---

## 7.9 Analyticity

Support:

- differentiability at a point,
- analyticity in a region,
- relation to Cauchy-Riemann equations,
- singularity exclusions,
- visualization of valid/invalid regions where practical.

---

## 7.10 Zeros and Singularities

Support detection and representation of:

- zeros,
- poles,
- pole order,
- removable singularities,
- essential singularities,
- branch points where detectable,
- branch cuts where relevant.

Special points should be directly visible in the complex plane.

Selecting a special point should reveal relevant mathematical information.

---

## 7.11 Residues

Support:

```text
Res(f, z0)
```

including:

- symbolic calculation when possible,
- relation to Laurent coefficients,
- connection with contour integration,
- display on the complex plane.

---

## 7.12 Taylor Series

Support:

- expansion around arbitrary center,
- finite partial sums,
- convergence radius,
- linked visualization,
- adjustable truncation order.

Users should be able to compare:

```text
f(z)
```

and:

```text
S_N(z)
```

interactively.

---

## 7.13 Laurent Series

Laurent series are a core requirement.

Support:

- expansion center,
- principal part,
- positive and negative powers,
- distinct convergence annuli,
- visual indication of convergence regions.

The UI should make it clear that different Laurent expansions may exist in different annular regions.

---

## 7.14 Complex Paths

Paths should be first-class mathematical expressions.

Examples:

```text
gamma(t) = 2e^(it)
```

```text
gamma(t) = 1 + t + i t^2
```

Support:

- parameter interval,
- orientation,
- path visualization,
- point movement along the path.

---

## 7.15 Contour Integrals

Support:

```text
∫_gamma f(z) dz
```

and closed contour integrals.

Visualize:

- the contour,
- orientation,
- singularities inside/outside,
- integrand along the path,
- accumulated integral.

The accumulated integral may itself be shown as a trajectory in the complex plane.

---

## 7.16 Cauchy Integral Theorem and Formula

The system should support visualization and exploration of:

- contour deformation where appropriate,
- Cauchy integral theorem,
- Cauchy integral formula,
- dependence on enclosed singularities.

These should be connected to actual mathematical objects and visualizations, not presented as disconnected theory pages.

---

## 7.17 Residue Theorem

For closed contours, support comparison between:

```text
∮ f(z) dz
```

and:

```text
2πi Σ Res(f, zk)
```

The system should visually identify enclosed poles and their residues.

This connection between geometry, symbolic analysis, and integral result is a core educational feature.

---

## 7.18 Branches and Branch Cuts

Support important multi-valued functions such as:

```text
log(z)
z^a
sqrt(z)
```

with appropriate handling or visualization of:

- branches,
- principal values,
- branch points,
- branch cuts.

The system should make discontinuities and branch choices visible wherever practical.

---

# 8. Subsystem II — Integral Transforms

Integral Transforms is a complete first-class subsystem.

It is not merely a collection of symbolic transform commands.

The subsystem should connect:

```text
time / spatial domain
↔
transform domain
```

through interactive linked views.

---

## 8.1 Fourier Series

Support:

- periodic functions,
- sine/cosine form,
- complex exponential form,
- Fourier coefficients,
- partial sums,
- adjustable number of terms,
- original-vs-approximation comparison.

---

## 8.2 Gibbs Phenomenon

Gibbs phenomenon should be explicitly explorable.

Support:

- discontinuous functions,
- increasing series order,
- local zoom,
- overshoot visualization.

The goal is conceptual understanding rather than only coefficient calculation.

---

## 8.3 Fourier Transform

Support:

```text
F(ω) = ℱ{f(t)}
```

with linked views for:

- time domain,
- frequency domain,
- magnitude,
- phase,
- real part,
- imaginary part.

The user should be able to edit the original expression and immediately inspect the resulting transform behavior.

---

## 8.4 Fourier Transform Properties

Support interactive exploration of major properties including:

- linearity,
- time shift,
- frequency shift,
- scaling,
- modulation,
- differentiation,
- integration where applicable,
- duality where supported,
- Parseval/Plancherel relationships.

These should be demonstrated through linked expressions and visualizations.

---

## 8.5 Inverse Fourier Transform

Support:

```text
f(t) = ℱ^-1{F(ω)}
```

and linked reconstruction where possible.

---

## 8.6 Discrete Fourier Transform

Support DFT concepts sufficiently to connect continuous Fourier theory to sampled signals.

Potential capabilities:

- sample points,
- discrete spectrum,
- frequency bins,
- amplitude/phase,
- reconstruction.

---

## 8.7 FFT

FFT may be used as an implementation mechanism and may also be exposed educationally where useful.

The product should distinguish:

- mathematical Fourier transform,
- DFT,
- FFT algorithm.

They should not be conflated.

---

## 8.8 Sampling

Support exploration of:

- sampling interval,
- sampling frequency,
- discrete samples,
- aliasing,
- frequency representation.

Sampling should connect naturally to Fourier analysis.

---

## 8.9 Convolution

Convolution is a core native interactive feature.

For:

```text
(f * g)(t)
```

visualize:

- `f(τ)`,
- shifted/reflected `g(t-τ)`,
- pointwise product,
- accumulated area/integral,
- resulting convolution.

The user should be able to drag or animate `t`.

---

## 8.10 Laplace Transform

Support:

```text
F(s) = L{f(t)}
```

with:

```text
s = σ + iω
```

as an explicit geometric variable.

The subsystem should connect:

```text
e^(-σt)
```

and:

```text
e^(-iωt)
```

to the transform kernel.

---

## 8.11 s-Plane

The s-plane is a core visualization.

Support:

- complex values of `s`,
- poles,
- zeros,
- region of convergence,
- linked values of `F(s)`.

---

## 8.12 Region of Convergence

ROC is a first-class concept.

Support:

- symbolic conditions where available,
- visual shading in the s-plane,
- relationship between ROC and poles,
- comparison between transforms with the same algebraic expression but different ROC when pedagogically relevant.

---

## 8.13 Inverse Laplace Transform

Support:

```text
f(t) = L^-1{F(s)}
```

with symbolic and numerical visualization where possible.

---

## 8.14 Pole-Zero Visualization

Support pole-zero diagrams in the transform domain.

This should integrate with:

- Laplace transforms,
- inverse transforms,
- system behavior where relevant.

The subsystem should remain mathematically focused and not expand into a full control-system design suite unless separately requested.

---

## 8.15 Transform Pairs and Properties

The system may provide canonical examples and transform pairs, but it should not become a static transform table.

Examples should remain editable and interactive.

---

## 8.16 Optional Future Extensions

Architectural room may be left for:

- Z-transform,
- discrete-time Fourier transform,
- wavelets,
- Mellin transform,
- other integral transforms.

These are not current mandatory goals unless promoted into scope later.

---

# 9. Subsystem III — Multivariable Calculus

Multivariable Calculus is a complete first-class subsystem.

It must not receive reduced functionality merely because the original motivation of the project came from complex analysis and integral transforms.

The quality bar for this subsystem is the same as for the other two.

The subsystem should cover the mathematical and geometric core of university-level multivariable calculus and vector calculus in `R^2` and `R^3`.

It should preserve the same expression-first interaction philosophy.

---

## 9.1 Scalar Functions in R^2

Support:

```text
f(x,y)
```

with:

- evaluation,
- 2D heatmap,
- contour plot,
- 3D surface,
- slices,
- level sets.

---

## 9.2 Limits and Continuity

Support multivariable exploration of:

- limits,
- path dependence,
- continuity,
- local behavior.

Where useful, users should be able to compare approach paths.

The subsystem should prioritize visual intuition without replacing rigorous mathematical definitions.

---

## 9.3 Partial Derivatives

Support:

```text
∂f/∂x
∂f/∂y
```

and higher-order/mixed partial derivatives.

Partial derivatives should be connectable to surface geometry.

---

## 9.4 Directional Derivatives

Support:

```text
D_u f
```

with interactive direction vectors.

The canvas should show the selected direction and resulting local rate of change.

---

## 9.5 Gradient

Support:

```text
∇f
```

with:

- gradient vectors,
- relationship to level sets,
- steepest-ascent interpretation,
- linked surface/contour views.

---

## 9.6 Tangent Planes and Linear Approximation

Support:

- tangent plane,
- local linear approximation,
- selected point,
- local error visualization where practical.

---

## 9.7 Extrema and Critical Points

Support exploration of:

- critical points,
- local maxima,
- local minima,
- saddle points,
- Hessian-based analysis where appropriate.

The goal is both symbolic and geometric understanding.

---

## 9.8 Double Integrals

Support:

```text
∬_D f(x,y) dA
```

with:

- rectangular regions,
- general regions where feasible,
- visual region selection,
- surface-volume interpretation,
- iterated integral representation.

---

## 9.9 Coordinate Transformations

Support important coordinate systems:

- Cartesian,
- polar,
- cylindrical,
- spherical.

Support visualization of coordinate transformations and Jacobians.

---

## 9.10 Jacobian

Support:

- Jacobian matrix,
- determinant,
- local area/volume scaling,
- coordinate transformations.

The determinant should be geometrically interpretable, not only symbolic.

---

## 9.11 Triple Integrals

Support:

```text
∭_V f(x,y,z) dV
```

with:

- region visualization,
- slicing,
- coordinate-system transformations where practical.

---

## 9.12 Parametric Curves

Support:

```text
r(t)
```

in both `R^2` and `R^3`.

Provide:

- tangent vector,
- velocity,
- acceleration,
- curvature where appropriate,
- path animation.

---

## 9.13 Parametric Surfaces

Support:

```text
r(u,v)
```

with:

- surface rendering,
- tangent vectors,
- tangent plane,
- normal vector,
- parameter grid.

---

## 9.14 Scalar Fields in R^3

Support:

```text
f(x,y,z)
```

through:

- slices,
- iso-surfaces,
- sampled values,
- gradient where appropriate.

---

## 9.15 Vector Fields in R^2

Support:

```text
F(x,y)
```

with:

- vector arrows,
- streamlines,
- magnitude,
- divergence,
- curl/vorticity interpretation where applicable.

---

## 9.16 Vector Fields in R^3

Support:

```text
F(x,y,z)
```

with:

- vector sampling,
- slices,
- streamlines where computationally reasonable,
- divergence,
- curl.

---

## 9.17 Line Integrals

Support:

```text
∫_C f ds
```

and:

```text
∫_C F · dr
```

with path visualization and accumulated integral.

---

## 9.18 Conservative Fields and Potentials

Support:

- conservative field analysis,
- potential functions,
- path independence,
- relationship between gradient fields and line integrals.

---

## 9.19 Surface Integrals

Support scalar and flux surface integrals.

Examples:

```text
∬_S f dS
```

```text
∬_S F · n dS
```

with visual surface orientation and normal vectors.

---

## 9.20 Divergence

Support:

```text
∇ · F
```

with:

- symbolic expression,
- scalar-field visualization,
- intuitive source/sink interpretation.

---

## 9.21 Curl

Support:

```text
∇ × F
```

with:

- symbolic expression,
- vector visualization,
- local rotation interpretation.

---

## 9.22 Green's Theorem

Support linked visualization of:

- planar region,
- boundary orientation,
- line integral,
- area integral.

Users should be able to see the relationship between both sides of the theorem.

---

## 9.23 Divergence Theorem

Support linked visualization of:

- volume,
- closed surface,
- vector field,
- divergence in the volume,
- flux through the boundary.

---

## 9.24 Stokes' Theorem

Support linked visualization of:

- surface,
- boundary curve,
- normal orientation,
- curl field,
- circulation.

---

# 10. Cross-Subsystem Mathematical Connections

The project should emphasize connections between the three subsystems.

These connections are a major reason to keep them inside one project.

Examples:

## 10.1 Complex Analysis and R^2

Use:

```text
C ≅ R^2
```

to connect:

```text
f(z) = u(x,y) + i v(x,y)
```

with:

- scalar fields,
- vector fields,
- Jacobians,
- Cauchy-Riemann equations.

---

## 10.2 Fourier Transform and Complex Numbers

Make the role of:

```text
e^(-iωt)
```

visible geometrically.

---

## 10.3 Laplace Transform and Complex Plane

Make:

```text
s = σ + iω
```

explicitly connect:

- complex analysis,
- transform-domain behavior,
- poles,
- ROC.

---

## 10.4 Contour Integration and Vector Calculus

Where pedagogically appropriate, expose relationships between:

- complex line integrals,
- planar vector fields,
- Green-type interpretations.

---

## 10.5 Jacobians and Complex Differentiability

The project should be structurally capable of showing how a complex derivative relates to a special real `2 x 2` Jacobian structure.

---

# 11. Rendering and Visualization Requirements

## 11.1 2D

2D rendering should support:

- axes,
- curves,
- points,
- regions,
- heatmaps,
- contours,
- vector fields,
- complex planes,
- labels,
- interactive selection.

---

## 11.2 Complex GPU Rendering

Domain coloring and other dense complex-field rendering should be GPU-friendly.

WebGL and/or WebGPU are appropriate.

The final product must not depend on NVIDIA CUDA.

The user's development machine may be powerful, but the web application should target ordinary student devices.

---

## 11.3 3D

3D rendering should support:

- surfaces,
- parametric surfaces,
- magnitude surfaces,
- scalar-field iso-surfaces,
- vector-field representations,
- slicing,
- camera interaction.

Three.js or another suitable browser-native 3D stack may be used.

---

## 11.4 Performance Principle

The product should favor:

- responsive interaction,
- progressive refinement,
- GPU acceleration where useful,
- adaptive sampling,
- reasonable device compatibility.

Do not optimize only for the development machine.

---

# 12. Symbolic Mathematics Requirements

A symbolic engine such as SymPy should be used for operations including:

- simplification,
- derivatives,
- symbolic integrals,
- series,
- residues,
- transforms,
- inverse transforms,
- equation solving where required by a feature.

The symbolic engine is a backend mathematical capability.

It should not dictate the UI.

Users should interact with mathematics rather than with raw CAS syntax.

---

# 13. Numerical Mathematics Requirements

Numerical components should support, where required:

- adaptive integration,
- numerical differentiation,
- FFT,
- interpolation,
- root finding,
- contour sampling,
- field sampling,
- streamline integration,
- surface generation.

Numerical methods should expose accuracy/error information where it materially affects interpretation.

The UI should distinguish:

```text
exact symbolic result
```

from:

```text
numerical approximation
```

when the difference matters.

---

# 14. Error Handling and Mathematical Validity

Mathematical errors must be presented as mathematical information, not generic software failures.

Examples:

- undefined point,
- singularity,
- divergent integral,
- invalid domain,
- branch ambiguity,
- transform does not converge under current assumptions,
- numerical method failed to converge,
- unsupported symbolic expression.

Prefer:

```text
The integral does not converge for Re(s) <= 1.
```

over:

```text
Evaluation Error 500
```

---

# 15. Educational Behavior

The application is a mathematical exploration tool, not merely a solver.

Whenever useful, the UI should support:

- showing intermediate mathematical structure,
- connecting formulas to geometry,
- comparing numerical and symbolic results,
- showing theorem conditions,
- visualizing convergence,
- exposing parameter effects.

The system should not hide important assumptions merely to return an answer.

---

# 16. Explainability

An optional `Explain` action may be available for mathematical results.

Examples:

```text
Residue
Taylor expansion
Cauchy-Riemann result
Fourier transform
Laplace ROC
Gradient
Divergence theorem
```

Explanations should be grounded in structured mathematical results generated by the system.

An LLM is not required for core correctness.

Core mathematics must not depend on an LLM guessing a result.

---

# 17. Examples and Presets

Each subsystem should eventually include curated examples.

Examples must remain editable.

## Complex Analysis Examples

Possible examples:

- `z^2`,
- `exp(z)`,
- `sin(z)`,
- `1/z`,
- Möbius transformations,
- Joukowski map,
- functions with poles,
- functions with essential singularities,
- logarithm and branch cuts.

## Integral Transform Examples

Possible examples:

- Gaussian,
- rectangular pulse,
- sinc,
- exponential decay,
- step function,
- impulse approximations,
- square wave,
- convolution pairs.

## Multivariable Calculus Examples

Possible examples:

- paraboloid,
- saddle surface,
- Gaussian surface,
- radial fields,
- rotational vector fields,
- conservative fields,
- standard Green/Gauss/Stokes examples.

Examples are educational starting points, not a substitute for free expression input.

---

# 18. Export and Sharing

Without an account system, useful local export capabilities are desirable.

Potential forms:

- project/workspace JSON,
- expression text,
- image export,
- SVG/PNG where appropriate,
- shareable encoded URL if practical,
- downloadable project file.

These should remain secondary to the mathematical experience.

---

# 19. Accessibility and Interaction

The application should support:

- keyboard-first expression editing,
- mouse interaction,
- trackpad interaction,
- touch interaction where practical,
- readable mathematical typography,
- sufficient contrast,
- scalable UI.

Important information must not be encoded exclusively by color where alternatives are practical.

This is particularly important for domain coloring and scalar-field heatmaps.

---

# 20. Desktop and Mobile

Desktop is the primary design target.

However, the expression-first architecture should remain mobile-compatible.

A possible mobile structure:

```text
Canvas
────────────
Expression Sheet
```

The application should avoid desktop-only interaction assumptions that would make mobile support impossible later.

---

# 21. Out of Scope

The project currently does NOT aim to become a full replacement for GeoGebra or Mathematica.

Unless later explicitly added, do not prioritize:

- Euclidean construction geometry,
- compass-and-straightedge workflows,
- geometry theorem proving,
- spreadsheets,
- statistics packages,
- probability workbenches,
- number theory workbenches,
- general-purpose linear algebra IDEs,
- arbitrary symbolic theorem proving,
- full differential-equation software,
- engineering simulation suites,
- CAD,
- circuit simulation,
- control-system design suites,
- account/social systems,
- cloud collaboration,
- marketplace/plugin ecosystems.

This does not prohibit small supporting capabilities where mathematically necessary.

---

# 22. Product Quality Bar

All three subsystems must meet the same quality standard.

The project must NOT evolve into:

```text
Complex Analysis — complete
Integral Transforms — complete
Multivariable Calculus — basic extras
```

The intended standard is:

```text
Complex Analysis         — first-class
Integral Transforms      — first-class
Multivariable Calculus   — first-class
```

Each subsystem should have:

- expression-first interaction,
- symbolic mathematics,
- numerical mathematics,
- linked visualization,
- meaningful interactivity,
- mathematically coherent object types,
- educational usefulness.

---

# 23. Architecture Quality Bar

The implementation should favor:

- modularity,
- testability,
- mathematical correctness,
- type safety,
- deterministic behavior,
- reusable shared mathematical objects,
- clear separation of symbolic/numerical/rendering layers.

Avoid building three disconnected feature collections.

The architecture should make it possible to add a mathematical concept once and reuse it across subsystems.

Example:

```text
ParametricCurve
```

should be reusable by:

- complex contour integration,
- multivariable line integrals,
- transform-domain visualizations where applicable.

---

# 24. Testing Requirements

Mathematical software requires stronger correctness testing than ordinary UI software.

Testing should include:

## Unit Tests

- parser,
- AST,
- type inference,
- complex arithmetic,
- numerical evaluation,
- symbolic adapters,
- transform conventions.

## Mathematical Reference Tests

Known identities should be tested.

Examples:

```text
d/dz exp(z) = exp(z)
```

```text
Res(1/z, 0) = 1
```

```text
Fourier(Gaussian) = Gaussian-type result
```

```text
Laplace(1) = 1/s with ROC Re(s) > 0
```

```text
div(curl(F)) = 0
```

where assumptions and numerical tolerances are appropriate.

## Numerical Tests

Test:

- convergence,
- tolerance,
- singularity handling,
- sampling stability.

## Visual Interaction Tests

Test linked views:

- shared cursor,
- parameter updates,
- selected points,
- path animation,
- transform synchronization.

---

# 25. Mathematical Convention Management

The project must explicitly define conventions where ambiguity exists.

Examples include:

- Fourier transform normalization,
- angular frequency `ω` vs frequency `f`,
- inverse Fourier convention,
- branch conventions for `log`,
- principal argument interval,
- orientation conventions,
- vector normal direction,
- Laplace transform assumptions.

Do not allow different modules to silently use different conventions.

These conventions should be centralized and documented.

---

# 26. Documentation Requirements

Documentation should include:

- product philosophy,
- mathematical conventions,
- supported expressions,
- supported mathematical objects,
- visualization semantics,
- numerical limitations,
- symbolic limitations,
- architecture notes.

The UI itself should remain discoverable enough that normal mathematical use does not require reading large manuals.

---

# 27. Recommended Technical Direction

This document defines product goals rather than forcing a specific stack, but the current preferred direction is:

## Frontend / Product

```text
TypeScript
```

for:

- UI,
- expression state,
- mathematical object state,
- numerical evaluation where appropriate,
- visualization orchestration,
- browser interaction.

## Symbolic Backend

```text
Python + SymPy
```

for:

- symbolic calculus,
- series,
- residues,
- transforms,
- symbolic analysis.

## Rendering

Browser-native technology:

- Canvas/SVG where suitable,
- WebGL/WebGPU for dense field rendering,
- Three.js or equivalent for 3D.

The product should not depend on CUDA.

---

# 28. Development Priorities

Development should prioritize foundations over isolated demo features.

Recommended order of architectural importance:

1. Expression model
2. Parser
3. Canonical AST
4. Mathematical type system
5. Numerical evaluator
6. Symbolic adapter
7. Shared parameter/state system
8. Visualization abstraction
9. Linked-view synchronization
10. Subsystem-specific capabilities

Do not build a collection of visually impressive but disconnected demos before the mathematical core is stable.

---

# 29. Feature Acceptance Principle

A new mathematical feature should preferably satisfy all four layers:

```text
Mathematical Object
        ↓
Executable Operation
        ↓
Visualization
        ↓
Educational Meaning
```

Example:

```text
Residue
```

should not mean only:

```text
CAS returns a number.
```

A complete feature should ideally connect:

- singularity,
- local Laurent structure,
- residue value,
- complex-plane marker,
- contour integral,
- residue theorem.

Similarly:

```text
Gradient
```

should not mean only:

```text
return symbolic vector.
```

It should connect:

- function,
- partial derivatives,
- gradient vector,
- level set,
- directional derivative,
- local geometry.

---

# 30. Final Product Definition

The project should ultimately be understood as:

> **A browser-based, expression-first mathematical exploration environment with three equally complete subsystems for Complex Analysis, Integral Transforms, and Multivariable Calculus, built around shared mathematical objects and linked visual representations.**

The product should combine:

```text
Desmos-like interaction simplicity
+
deep mathematical semantics
+
symbolic and numerical computation
+
modern 2D/3D/GPU visualization
+
course-level educational clarity
```

while deliberately avoiding the interaction complexity of traditional professional mathematics software.

The three top-level subsystems are equal in importance:

```text
/complex
/transforms
/calculus
```

The root homepage routes users into these systems.

No account system is currently required.

The central rule for future development is:

> **If a feature cannot naturally begin from a mathematical expression or mathematical object, reconsider its interaction design.**

And the central engineering rule is:

> **Do not create separate mathematical truths for separate renderers or subsystems. One mathematical core should drive symbolic analysis, numerical evaluation, and visualization.**
