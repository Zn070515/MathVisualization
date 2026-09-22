/**
 * A parameter slider.
 *
 * A real assignment such as `a = 2` becomes a control, and every expression that
 * mentions `a` follows it live (GOAL.md 6.2). Because the shader takes parameters
 * as uniforms, dragging the slider updates a uniform and does not rebuild the
 * program, so the response is immediate even for an expensive expression.
 *
 * The control is a range input with a number field beside it. The number field
 * exists because a slider alone cannot reach an exact value, and exactness is
 * often the point of the parameter.
 */
import { useEffect, useState } from 'react';
import { parameterInputText } from '../display/numbers';

export interface ParameterSliderProps {
  readonly name: string;
  readonly value: number;
  /** The value the definition `a = ...` implies, for the reset control. */
  readonly defined: number;
  readonly onChange: (value: number) => void;
  readonly onReset: () => void;
}

/** A range that always contains the current value, so any parameter is reachable. */
function sliderBounds(value: number, defined: number): { min: number; max: number; step: number } {
  const magnitude = Math.max(1, Math.abs(value), Math.abs(defined));
  const min = -magnitude * 2;
  const max = magnitude * 2;
  return { min, max, step: (max - min) / 400 };
}

export function ParameterSlider({
  name,
  value,
  defined,
  onChange,
  onReset,
}: ParameterSliderProps): React.JSX.Element {
  const bounds = sliderBounds(value, defined);
  // Not `String(value)`: that is the shortest round-tripping form of the double,
  // which for a value that came out of arithmetic is `0.30000000000000004`.
  const [draft, setDraft] = useState(parameterInputText(value));

  // Follow the value when it changes from elsewhere, but leave the field alone
  // while the user is typing in it.
  useEffect(() => {
    setDraft(parameterInputText(value));
  }, [value]);

  const commitDraft = (): void => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) {
      onChange(parsed);
    } else {
      setDraft(parameterInputText(value));
    }
  };

  return (
    <div className="parameter">
      <span className="parameter__name">{name}</span>
      <input
        className="parameter__slider"
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        value={value}
        aria-label={`Value of ${name}`}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
      />
      <input
        className="parameter__value"
        type="text"
        inputMode="decimal"
        value={draft}
        aria-label={`Exact value of ${name}`}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitDraft();
          }
        }}
      />
      <button
        type="button"
        className="parameter__reset"
        onClick={onReset}
        disabled={value === defined}
        title={`Reset to ${parameterInputText(defined)}`}
        aria-label={`Reset ${name} to its defined value`}
      >
        ↺
      </button>
    </div>
  );
}
