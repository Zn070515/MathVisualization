/**
 * Numbers, written for a reader.
 *
 * The whole reason the core returns a *structured* number rather than a string is
 * that the exponent of `2×10⁸` is set in smaller type, and a string cannot say
 * which characters those are. This is where that finally happens.
 *
 * There is one subtlety worth stating, because it is easy to get wrong and
 * invisible until a screen reader reads it aloud. A superscript is not a
 * character, so the text content of the rendered element is `2×108` — the
 * boundary between mantissa and exponent is gone. Anything that reads the value
 * as text therefore has to be given it separately, which is what the `aria-label`
 * and the `title` are for, and what `displayNumberToText` produces. The
 * non-scientific kinds have no such problem: their text content *is* the number.
 */
import { displayNumberToText, type DisplayComplex, type DisplayNumber } from '@mathviz/mathcore';

export interface NumberTextProps {
  readonly value: DisplayNumber;
}

/** A real number. */
export function NumberText({ value }: NumberTextProps): React.JSX.Element {
  const text = displayNumberToText(value);

  if (value.kind === 'scientific') {
    return (
      <span className="number" aria-label={text} title={text}>
        <span aria-hidden="true">
          {value.mantissa}×10<sup>{value.exponent}</sup>
        </span>
      </span>
    );
  }

  return <span className="number">{text}</span>;
}

export interface ComplexTextProps {
  readonly value: DisplayComplex;
}

/**
 * A complex number, in the form mathematics is written in: `2i`, `-i`,
 * `3 + 4i`, `4`.
 *
 * The imaginary coefficient collapses to a bare `i` when it is one, and the
 * string projection in the core does the same — the two must agree, and a test
 * compares them.
 */
export function ComplexText({ value }: ComplexTextProps): React.JSX.Element {
  switch (value.kind) {
    case 'undefined':
      return <span className="number">undefined</span>;
    case 'real':
      return <NumberText value={value.re} />;
    case 'imaginary':
      return (
        <>
          {value.sign < 0 ? '-' : null}
          <ImaginaryText magnitude={value.im} />
        </>
      );
    case 'rectangular':
      return (
        <>
          <NumberText value={value.re} />
          {value.sign < 0 ? ' - ' : ' + '}
          <ImaginaryText magnitude={value.im} />
        </>
      );
  }
}

/** The imaginary part as written, with no coefficient when it is one. */
function ImaginaryText({ magnitude }: { magnitude: DisplayNumber }): React.JSX.Element {
  if (displayNumberToText(magnitude) === '1') return <>i</>;
  return (
    <>
      <NumberText value={magnitude} />i
    </>
  );
}
