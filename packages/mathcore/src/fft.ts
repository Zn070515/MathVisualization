/**
 * Radix-2 Cooley–Tukey FFT.
 *
 * This is an algorithm for the DFT, not a different transform. The forward
 * sign convention matches the repository's DFT definition: exp(-i 2πkn/N).
 */
import { cadd, cmul, csub, isFiniteComplex, type Complex } from './complex';
import { fail, ok, type MathIssue, type Result } from './errors';

/** Compute the forward radix-2 FFT of a finite power-of-two sample vector. */
export function radix2Fft(samples: readonly Complex[]): Result<readonly Complex[], MathIssue> {
  if (samples.length < 1 || !isPowerOfTwo(samples.length)) {
    return fail({
      kind: 'invalid-parameter',
      message: 'A radix-2 FFT needs a non-empty power-of-two sample count.',
      detail: String(samples.length),
    });
  }
  if (samples.some((sample) => !isFiniteComplex(sample))) {
    return fail({
      kind: 'singularity',
      message: 'The FFT cannot transform a non-finite sample.',
    });
  }

  const values = samples.map((sample) => ({ ...sample }));
  bitReverse(values);
  for (let width = 2; width <= values.length; width *= 2) {
    const half = width / 2;
    const angle = (-2 * Math.PI) / width;
    const root = { re: Math.cos(angle), im: Math.sin(angle) };
    for (let start = 0; start < values.length; start += width) {
      let twiddle = { re: 1, im: 0 };
      for (let offset = 0; offset < half; offset += 1) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + half;
        const even = values[evenIndex] as Complex;
        const odd = cmul(values[oddIndex] as Complex, twiddle);
        values[evenIndex] = cadd(even, odd);
        values[oddIndex] = csub(even, odd);
        twiddle = cmul(twiddle, root);
      }
    }
  }
  return ok(values);
}

function bitReverse(values: Complex[]): void {
  let reversed = 0;
  for (let index = 1; index < values.length; index += 1) {
    let bit = values.length >> 1;
    while ((reversed & bit) !== 0) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      const current = values[index] as Complex;
      values[index] = values[reversed] as Complex;
      values[reversed] = current;
    }
  }
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && (value & (value - 1)) === 0;
}
