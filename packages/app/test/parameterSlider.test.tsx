/**
 * The parameter slider.
 *
 * What matters here is the exact-value field, because it is the one control that
 * shows a user a raw number they did not type. A slider's value comes out of
 * arithmetic on the range, so it arrives as a double — and `String` of a double
 * is the shortest decimal that round-trips, which is not the same thing as the
 * number a reader wants to see.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ParameterSlider } from '../src/expression/ParameterSlider';

beforeEach(() => {
  cleanup();
});

function fields(): { slider: HTMLInputElement; exact: HTMLInputElement } {
  return {
    slider: screen.getByLabelText('Value of a') as HTMLInputElement,
    exact: screen.getByLabelText('Exact value of a') as HTMLInputElement,
  };
}

describe('the exact-value field', () => {
  it('shows the value without the noise in the last place of a double', () => {
    // The value a slider produces for 0.1 + 0.2 is 0.30000000000000004, and
    // `String` of it says so. That is not a formatting error — the double really
    // is that — but showing it to someone dragging a slider is still wrong.
    expect(String(0.1 + 0.2)).toBe('0.30000000000000004');
    render(
      <ParameterSlider
        name="a"
        value={0.1 + 0.2}
        defined={2}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    expect(fields().exact.value).toBe('0.3');
  });

  it('writes a whole number as a whole number', () => {
    render(
      <ParameterSlider name="a" value={2} defined={2} onChange={() => {}} onReset={() => {}} />,
    );
    expect(fields().exact.value).toBe('2');
  });
});

describe('typing a value', () => {
  it('commits what was typed', () => {
    const onChange = vi.fn();
    render(
      <ParameterSlider name="a" value={1} defined={1} onChange={onChange} onReset={() => {}} />,
    );

    const { exact } = fields();
    fireEvent.change(exact, { target: { value: '2.5' } });
    fireEvent.blur(exact);

    expect(onChange).toHaveBeenCalledWith(2.5);
  });

  it('keeps the value it had when what was typed is not a number', () => {
    const onChange = vi.fn();
    render(
      <ParameterSlider name="a" value={1} defined={1} onChange={onChange} onReset={() => {}} />,
    );

    const { exact } = fields();
    fireEvent.change(exact, { target: { value: 'not a number' } });
    fireEvent.blur(exact);

    expect(onChange).not.toHaveBeenCalled();
    expect(exact.value).toBe('1');
  });
});

describe('the reset control', () => {
  it('states the defined value in the same way the field does', () => {
    // A tooltip is a place a number reaches a reader, so it goes through the
    // same layer as everything else.
    render(
      <ParameterSlider
        name="a"
        value={1}
        defined={0.1 + 0.2}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.getByTitle('Reset to 0.3')).toBeTruthy();
  });

  it('is offered only when the value has moved off its definition', () => {
    const { unmount } = render(
      <ParameterSlider name="a" value={3} defined={2} onChange={() => {}} onReset={() => {}} />,
    );
    expect(
      (screen.getByLabelText('Reset a to its defined value') as HTMLButtonElement).disabled,
    ).toBe(false);
    unmount();

    render(
      <ParameterSlider name="a" value={2} defined={2} onChange={() => {}} onReset={() => {}} />,
    );
    expect(
      (screen.getByLabelText('Reset a to its defined value') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
