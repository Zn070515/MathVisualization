# Mathematical conventions

Where mathematics admits more than one convention, this project picks one, defines
it in exactly one place, and tests it. The single place is
`packages/mathcore/src/conventions.ts`; every entry below is a rendering of that
table, and the test suite asserts against the same table. If this document and the
behaviour ever disagree, the behaviour is what the tests check and this document is
wrong.

The reason for the discipline is in `GOAL.md` section 25: different modules must
not silently choose different conventions. A project where `arg(-1)` is `π` in one
place and `-π` in another produces pictures that cannot be read against each other.

---

## Complex analysis

### Principal argument

```
Arg z ∈ (-π, π]
```

The negative real axis belongs to the **upper** edge of the branch cut, so
`Arg(-1) = π`, never `-π`. JavaScript's `atan2` returns `-π` for a negative zero
imaginary part, so that one case is remapped. The shader does the same.

*Consequence:* `principalArg(-4) = π` and `principalArg(-4 - 0i) = π`. The range is
half-open, which is what makes the argument single-valued everywhere except the cut.

### Complex logarithm

```
Log z = ln|z| + i·Arg z
```

The principal branch, with its cut along the negative real axis. `Log(-4) = ln 4 + πi`.

`Log(0)` is **undefined**, reported as a singularity. It is not `-∞` plus an
arbitrary phase, and the interface says so rather than printing a number.

### Complex power

```
z^w = exp(w · Log z)          for non-integer w
z^n = z·z·…·z                 exact repeated multiplication for integer n
```

Integer exponents take the exact path so that `z^2` is bit-for-bit `z*z`. Because
zero is an integer exponent, **`0^0 = 1`** by the same convention.

`0^w` for non-integer `w` is `0` when `Re w > 0`, and undefined otherwise. The
evaluator reports `0^(-1)` as a pole, naming the operation, rather than returning
`Infinity`.

### Square root

```
sqrt(z) = exp(Log z / 2)
```

The principal root: **`sqrt(-4) = 2i`**, never `-2i`. Computed with a stable
half-angle formula rather than through `exp` and `log`, so accuracy does not
degrade near the negative real axis — but the branch it computes is the same one.

### Which branch of a multi-valued function is drawn

Whatever is in this document. `log`, `sqrt` and the non-integer `z^a` are all
principal. Where a result depends on the branch, the symbolic engine says so:
`d/dz log(z)` returns `1/z` **and** the note that the principal branch is in use.

---

## Integral transforms

These are recorded now and not yet implemented. They are here because a convention
chosen later, after code exists, is a convention that has already drifted.

### Fourier transform

```
F(ω) = ∫ f(t) e^(-iωt) dt          over (-∞, +∞)
f(t) = (1/2π) ∫ F(ω) e^(iωt) dω
```

Angular frequency `ω`, not ordinary frequency `f`. The **non-unitary**
normalisation, with the whole `1/(2π)` on the inverse transform rather than split
across both directions. Choosing angular frequency makes `ω` the natural variable
for the `s = σ + iω` connection to the Laplace transform.

### Laplace transform

```
F(s) = ∫ f(t) e^(-st) dt           over (0⁻, +∞)
```

The one-sided transform, with the lower limit taken as `0⁻` so that a jump at the
origin is included. The **region of convergence is part of the answer**, reported
as a half-plane `Re(s) > σ₀`, and reported separately from the algebraic
expression: the same `F(s)` belongs to different `f(t)` under different regions,
and a product that shows only the expression is hiding the interesting half.

### DFT and FFT

Not yet implemented. When they are, they will be presented as three distinct
things — the mathematical Fourier transform, the discrete transform, and the
algorithm that computes it — because `GOAL.md` section 8.7 asks for exactly that
distinction.

---

## Geometry and orientation

### Contour orientation

Positive orientation is **counter-clockwise**. This fixes the sign of every
contour integral and therefore the sign of `2πi Σ Res(f, zₖ)`.

### Contour integral

```
∮_γ f(z) dz = ∫ f(γ(t))·γ′(t) dt     over t ∈ [0, 2π]
```

The parameter runs over `[0, 2π]` for **every** contour, so the sign of the answer is
fixed by one stated convention rather than by how each path happens to be written:
`γ(t) = r·e^(it)` walks a circle once in the positive direction, and a segment is
written `γ(t) = a + (b − a)·t/(2π)` to walk once as well. Writing the path the other
way round reverses the sign, and that is the whole of what orientation means here.

The rule is the **composite trapezoid**. It is spectrally accurate on a closed contour
— refining the grid stops helping once the integrand is resolved, because the integrand
is periodic in the parameter — and second order on an open one. So every result reports
whether the path actually closed and by how much it missed; `∮` over an open path is a
claim the picture cannot make good on.

`γ′` is a **Richardson-extrapolated** central difference. A plain one at the step this
uses leaves about `6×10⁻⁸` of relative error, which would not meet the `10⁻⁹` the
reference identities are stated to; extrapolating cancels the step-squared term and
brings it to about `4×10⁻¹²`. That sets a floor, so every result carries an error
estimate that is never allowed below it.

And the integral is a **quadrature**: a pole the grid steps over is invisible to it.
Whether a pole is *enclosed* is therefore settled by the winding number and not by
this — the two are used together and never one in place of the other.

## Recorded for features not yet built

### Surface normal

**Outward** for a closed surface. This fixes the sign of flux and of both sides of
the divergence theorem.

---

## Visualization

### Domain colouring

```
hue        ← (Arg w + π) / 2π
brightness ← one cycle per octave of |w|, lowest at |w| = 2^k
```

The argument becomes hue over a full turn; the modulus drives brightness on a
logarithmic scale, completing one cycle per octave so that a wide range of
magnitudes is legible at once. Both the octave boundaries and the mid-octave peak
are visible.

Three cases are handled before the hue is computed, because colour would otherwise
lie about them:

| Value | Drawn as |
|---|---|
| `w = 0` (a zero of the function) | black |
| `|w| = ∞` (a pole) | white |
| `w` undefined (`NaN`) | flat grey — distinct from black |

The hue offset means the positive real axis is cyan, the negative real axis is red,
the positive imaginary axis is blue and the negative imaginary axis is green. That
is a choice, not an inevitability; it is asserted in
`packages/mathcore/test/coloring.test.ts` so it cannot change unnoticed.

### Scalar field ramp

The **viridis** palette, chosen because its lightness increases monotonically
along the ramp. That is an accessibility property, not a taste: where a scalar
field is shown, the value is readable from luminance alone, so nothing is carried
by hue by itself (`GOAL.md` section 19).

Each mode normalises differently, and the shader reproduces each exactly:

| Mode | Mapping |
|---|---|
| magnitude | `log(1 + |w|)` against the sampled maximum — logarithmic so a few large values do not flatten everything else |
| phase | `(Arg w + π) / 2π`, ignoring the range, since the argument's range is known |
| real, imaginary | linear over the sampled range |

`log(1 + x)` rather than `log1p`, because GLSL has no `log1p`; the CPU reference
uses the same form so that the two agree.

In every mode, an undefined value is grey and an infinite one is white, so a
singularity never looks like a large finite number.

### The three-dimensional view

```
right-handed      +x right, +y up, +z toward the viewer
looking down -z   the camera's own forward direction
column-major      element (row, column) sits at index column * 4 + row
clip space        x, y, z ∈ [-1, 1], with -1 at the near plane
```

Four things a scene can be silently wrong about, so they are fixed in one place
(`app/src/render/matrix.ts`) and each is asserted against a value worked out by
hand rather than against whatever the implementation produces. A sign error in any
of them yields a picture that still looks like a picture — mirrored, inside out, or
behind the camera — and none of them announces itself.

The surface's own conventions:

- **A height is the real part of the value.** Correct for a scalar field
  `R² → R`, which is the only thing a surface is. Which expressions *are* surfaces
  is decided by the type system a level up, rather than guessed at here.
- **A singularity is a hole.** A sample where the function has no value is marked
  undefined, and every cell of the mesh touching it is dropped, so `1/(x² + y²)`
  has a hole at the origin rather than a surface that passes smoothly over a point
  where the function is not defined. A hole is the truth.
- **Normals point outward**, by central differences over the sampled grid,
  continuing the `surfaceNormal` convention above.
- **Back faces are drawn, with the normal flipped.** A surface can legitimately be
  looked at from underneath, and hiding the underside would be the picture refusing
  to show what is there.
- **The colour is the heatmap's ramp.** One `SCALAR_RAMP`, generated into both
  shaders, so a surface of `f` and a heatmap of `f` cannot come out different
  colours on the same value.

---

## Numerical behaviour

### Tolerances

Defined once, in `NUMERICS` (`conventions.ts`):

| Constant | Value | Used for |
|---|---|---|
| `absoluteTolerance` | `1e-12` | comparing values of order 1 |
| `relativeTolerance` | `1e-9` | comparing large magnitudes |
| `methodTolerance` | `1e-6` | numerically estimated derivatives and integrals |
| `finiteDifferenceStep` | `1e-6` | the step in those estimates |

A test that compares against a reference states which tolerance it uses, so that
"approximately equal" means one thing everywhere.

### Exact versed approximate

The product distinguishes them and the interface shows which is which:

- A **symbolic** result carries `exact: true` and is displayed with an `exact`
  marker. It came from the engine, so it is not an approximation of anything.
- A **numerical** readout is a double-precision evaluation and is presented as a
  number, not as an exact answer.

The distinction is only possible because numeric literals survive parsing as exact
rationals (`rational.ts`), and because the symbolic lowering folds literal
arithmetic exactly rather than letting Python's float division destroy it.

### How a number is written

```
plain digits    in [1e-4, 1e6)
m × 10^e        outside that window
at most 6 significant digits
```

One policy for every surface that shows a number: the readout, axis labels, view
ranges, legends and parameter sliders. No view formats its own numbers — this
policy previously existed in four places at once, and the copies disagreed about
both the threshold (`1000` versus `100`) and the digits (`2` versus `1`), so the
same magnitude could be written two ways in two panes.

A magnitude is **stated** rather than spelled out once spelling it out stops
helping:

```
2000        →  2000
200000000   →  2×10⁸
0.0000234   →  2.34×10⁻⁵
```

Note that this is not "exponential for small, decimal for large". `200000000` is
not hard to compute with; it is hard to *read*, and `2×10⁸` states the same
magnitude in three characters.

The core returns this **structurally** — `{ kind: 'scientific', mantissa: 2,
exponent: 8 }` — rather than as a string, because the exponent is set in smaller
type and a string cannot say which characters those are. One function renders the
plain text (`2×10^8`), for tooltips, ARIA labels, canvas fallback and tests. The
numbers live in `NUMBER_DISPLAY`; the structure is in `display.ts`.

Rounding here is a display concern and never feeds back into a computation.

### Axis tick placement

```
major ticks at 1, 2 or 5 × 10ⁿ    about ten across an axis
minor ticks at a fifth of that    a quarter, for a step of 2×10ⁿ
```

Steps a reader can do arithmetic with. A step of `2×10ⁿ` subdivides into **four**
rather than five, so the minor lines land on `0.5×10ⁿ` and not on `0.4×10ⁿ`: a
grid drawn at `0.4` does not help anyone read a grid drawn at `2`.

Every tick is computed as `index × step`, never by adding the step repeatedly. The
difference is invisible for the first few ticks and then is not: a running total
puts the tick that should be at `0.3` at `0.30000000000000004`, and prints it that
way. Because the index form is exact, the label and the line cannot disagree —
which is the one failure an axis must never have. Both properties are asserted in
`packages/mathcore/test/ticks.test.ts`.

The same step is handed to the fragment shader as its grid spacing, so the GPU
grid and the numbered ticks agree about where a unit is by construction rather
than by coincidence. The numbers live in `TICK_STEP`.

### Display of tiny components

A displayed complex value whose component is smaller than a fraction of the
largest component is shown as zero — the fraction is
`NUMBER_DISPLAY.zeroThreshold`, `1e-12`. This is a **display** convention and
changes no computed value. Its purpose: `(1 + i)^2` is exactly `2i`, but
evaluating it in double precision leaves a real part of about `1e-16`, and
printing `1.11022e-15 + 2i` would present rounding as if it were structure.

The threshold is relative, so a value whose components are all genuinely tiny is
still printed in full — and relative also means a part far below the scale of the
other really is noise:

```
2×10^8 + 3×10^-5 i   →  2×10⁸         the imaginary part is 1.5e-13 relative
1.2×10^-5 + 3.4×10^6 i                  both parts survive, both stated
```

The second line is what the structure buys: both components are written as
magnitudes with an exponent set in smaller type, which a single formatted string
could not express.

Note also which numbers are deliberately *not* routed through this layer. The
symbolic panel prints what the symbolic engine returned, verbatim. That engine
works in exact rationals and prints its own syntax; re-formatting its output as a
decimal would report `Rational(1, 3)` as `0.333333`, destroying exactly the
distinction the product is built to preserve (see *Exact versed approximate*
above).

### Undefined values

Undefined points produce a **reason**, not `NaN` reaching the interface:

```
1/z  at z = 0   ⟹  the divisor is zero here; the expression is not defined
log(0)          ⟹  zero is not in the domain of the logarithm
arg(0)          ⟹  the argument of zero has no value
0^(-1)          ⟹  a pole: zero to a negative power is not defined
```

The GPU path cannot carry a reason, so the shader marks undefined pixels with a
distinct grey and the CPU evaluator remains the reference for what the reason is.

---

## Parsing conventions

Two reading rules that are conventions in the same sense as the rest — they decide
what a piece of source text means.

### Juxtaposition multiplies

`2z`, `2(z+1)`, `(z+1)(z-1)`, and letter runs that are not known names:

```
it      ⟹  i * t
ay      ⟹  a * y
```

A run of letters that *is* a known name stays one symbol: `pi`, `sin`, a parameter
you defined (`a = 2`), a function you defined.

### A name followed by `(`

It is a call if the name is a builtin or is defined as a function **anywhere in the
document** — definition order does not matter. Otherwise it is a product, which is
how `z(z+1)` reads as `z * (z + 1)`.

### Numeric literals

`2e3` is `2000`, not `2 * e * 3`: an exponent is consumed only when digits actually
follow the `e`. This is what lets `2e^(it)` mean `2 * e^(i*t)`.

---

## Naming

The space of a variable comes from one documented table
(`VARIABLE_SPACE_BY_NAME`), applied when a definition's parameter list becomes a
domain:

| Names | Space |
|---|---|
| `z`, `w`, `s` | `C` |
| `x`, `y`, `t`, `u`, `v`, `r`, `a` … `q` | `R` |
| anything else | `R` (the documented default) |

This is a naming convention, not type guessing: the *codomain* of every expression
is computed by inference over the tree. `f(z) = z^2` and `f(x) = x^2` are the same
text and become different objects because the declared variable differs — which is
what a mathematician means by them too.
