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

Recorded now so the features that need them start from a fixed sign.

### Contour orientation

Positive orientation is **counter-clockwise**. This fixes the sign of every
contour integral and therefore the sign of `2πi Σ Res(f, zₖ)`.

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

### Display of tiny components

A displayed complex value whose component is smaller than `1e-12` of the largest
component is shown as zero. This is a **display** convention and changes no
computed value. Its purpose: `(1 + i)^2` is exactly `2i`, but evaluating it in
double precision leaves a real part of about `1e-16`, and printing
`1.11022e-15 + 2i` would present rounding as if it were structure.

The threshold is relative, so a value whose components are all genuinely tiny is
still printed in full.

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
