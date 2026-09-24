/**
 * The readout: the exact value of the shared cursor.
 *
 * This strip is what turns a picture into mathematics. It shows the plane
 * coordinate, the value of the active expression there, the modulus, the argument,
 * and the colour the field view is currently painting that value — so the colour
 * on the canvas is tied to a number rather than left as decoration.
 *
 * Where a value is undefined, the strip prints the reason the evaluator gave
 * ("the denominator is zero here") instead of a number, which is the distinction
 * GOAL.md section 14 asks for.
 *
 * The value here is computed by the same binding the views use, which is the
 * point: the number in this strip is the value of the function at the point being
 * pointed at, and it is the same number the picture was drawn from.
 */
import { useMemo } from 'react';
import {
  type Complex,
  type UserFunctionDefinition,
  DEFAULT_DOMAIN_COLORING,
  cabs,
  displayComplex,
  displayNumber,
  domainColor,
  fieldColor,
  principalArg,
  rgbToCss,
} from '@mathviz/mathcore';
import { ComplexText, NumberText } from '../display/NumberText';
import { useStore } from '../state/store';
import { makePointEvaluation } from '../views/evaluation';
import {
  estimateActiveFourierTransform,
  selectFourierTransform,
  snapFrequency,
} from '../views/frequencyEvaluation';
import {
  dftFrequencyVariable,
  estimateActiveDft,
  readoutAtFrequency,
  selectDftTransform,
} from '../views/dftEvaluation';
import type { FourierEstimate } from '@mathviz/mathcore';
import type { DftEstimate } from '@mathviz/mathcore';
import type { ActiveExpression, WorkspaceStore } from '../state/workspaceStore';

export function ReadoutBar({ store }: { store: WorkspaceStore }): React.JSX.Element {
  const state = useStore(store, (current) => current);
  const point = state.hover ?? state.selection;
  const frequency = state.frequencyHover ?? state.frequencySelection;
  const active = store.sourceExpression();
  const transform = store.activeExpression();
  const transformEstimate = useMemo(
    () =>
      estimateActiveFourierTransform(
        transform,
        state.workspace,
        state.parameterValues,
        state.sampling,
      ),
    [transform, state.workspace, state.parameterValues, state.sampling],
  );
  const dftEstimate = useMemo(
    () => estimateActiveDft(transform, state.workspace, state.parameterValues, state.sampling),
    [transform, state.workspace, state.parameterValues, state.sampling],
  );

  if (frequency !== null && selectDftTransform(transform) !== null) {
    return (
      <div className="readout">
        <DftFrequencyValueCells
          frequency={frequency}
          frequencyVariable={dftFrequencyVariable(transform)}
          estimate={dftEstimate}
        />
        <span className="readout__spacer" />
        <span className="readout__held">
          {state.frequencySelection !== null ? 'held' : 'following the pointer'}
        </span>
      </div>
    );
  }

  if (frequency !== null && selectFourierTransform(transform) !== null) {
    return (
      <div className="readout">
        <FrequencyValueCells frequency={frequency} estimate={transformEstimate} />
        <span className="readout__spacer" />
        <span className="readout__held">
          {state.frequencySelection !== null ? 'held' : 'following the pointer'}
        </span>
      </div>
    );
  }

  if (point === null) {
    return (
      <div className="readout readout--idle">
        <span className="readout__hint">
          Move the pointer over a view to read the value there. Click to hold a point.
        </span>
      </div>
    );
  }

  return (
    <div className="readout">
      <Cell label="point" value={<ComplexText value={displayComplex(point, { digits: 5 })} />} />

      {active === null ? (
        <Cell label="value" value="—" />
      ) : (
        <ValueCells
          active={active}
          point={point}
          parameters={state.parameterValues}
          functions={state.workspace.functions}
        />
      )}

      <span className="readout__spacer" />
      <span className="readout__held">
        {state.selection !== null ? 'held' : 'following the pointer'}
      </span>
    </div>
  );
}

function DftFrequencyValueCells({
  frequency,
  frequencyVariable,
  estimate,
}: {
  frequency: number;
  frequencyVariable: string;
  estimate: DftEstimate | null;
}): React.JSX.Element {
  const readout = estimate === null ? null : readoutAtFrequency(frequency, estimate);
  if (readout === null) return <Cell label="frequency" value="—" />;

  return (
    <>
      <Cell
        label="k"
        value={<NumberText value={displayNumber(readout.bin.index, { digits: 5 })} />}
      />
      <Cell
        label="signed k"
        value={<NumberText value={displayNumber(readout.bin.signedIndex, { digits: 5 })} />}
      />
      <Cell
        label={frequencyVariable}
        value={<NumberText value={displayNumber(readout.frequency, { digits: 5 })} />}
      />
      <Cell
        label="D[k]"
        value={<ComplexText value={displayComplex(readout.value, { digits: 6 })} />}
      />
      <Cell
        label="|D[k]|"
        value={<NumberText value={displayNumber(readout.magnitude, { digits: 5 })} />}
      />
      <Cell
        label="Δt"
        value={<NumberText value={displayNumber(readout.sampleInterval, { digits: 5 })} />}
      />
      <Cell
        label="t₀"
        value={<NumberText value={displayNumber(readout.aliasing.sampleOrigin, { digits: 5 })} />}
      />
      <Cell
        label="Nyquist"
        value={<NumberText value={displayNumber(readout.nyquistAngularFrequency, { digits: 5 })} />}
      />
      <Cell
        label="Ωs"
        value={
          <NumberText
            value={displayNumber(readout.aliasing.samplingAngularFrequency, { digits: 5 })}
          />
        }
      />
      <Cell
        label="alias representatives"
        value={
          <span>
            {readout.aliasing.aliases.map((alias, index) => (
              <span key={alias}>
                {index > 0 ? ', ' : null}
                <NumberText value={displayNumber(alias, { digits: 5 })} />
              </span>
            ))}
          </span>
        }
      />
      <span className="readout__reason">
        index-domain aliases: {frequencyVariable} + k·Ωs
        {' · '}phase per +Ωs ={' '}
        <ComplexText
          value={displayComplex(readout.aliasing.phasePerSamplingFrequency, { digits: 5 })}
        />
        {' · '}Ωs ={' '}
        <NumberText
          value={displayNumber(readout.aliasing.samplingAngularFrequency, { digits: 5 })}
        />
        {' · '}
        {readout.stability === 'stable'
          ? 'stable under N→2N refinement'
          : readout.stability === 'sampling-sensitive'
            ? 'sampling-sensitive under N→2N refinement'
            : 'unresolved under N→2N refinement'}
      </span>
    </>
  );
}

function FrequencyValueCells({
  frequency,
  estimate,
}: {
  frequency: number;
  estimate: FourierEstimate | null;
}): React.JSX.Element {
  if (estimate === null || estimate.values.length === 0) {
    return <Cell label="frequency" value="—" />;
  }
  const snappedFrequency = snapFrequency(frequency, estimate.frequencies);
  if (snappedFrequency === null) return <Cell label="frequency" value="—" />;
  let nearest = 0;
  for (let index = 1; index < estimate.frequencies.length; index += 1) {
    if (
      Math.abs((estimate.frequencies[index] as number) - snappedFrequency) <
      Math.abs((estimate.frequencies[nearest] as number) - snappedFrequency)
    ) {
      nearest = index;
    }
  }
  const value = estimate.values[nearest];
  if (value === undefined) return <Cell label="frequency" value="—" />;
  return (
    <>
      <Cell
        label="ω"
        value={<NumberText value={displayNumber(snappedFrequency, { digits: 5 })} />}
      />
      <Cell label="F(ω)" value={<ComplexText value={displayComplex(value, { digits: 6 })} />} />
      <Cell label="|F|" value={<NumberText value={displayNumber(cabs(value), { digits: 5 })} />} />
      <Cell
        label="arg"
        value={
          cabs(value) === 0 ? (
            <NumberText value={{ kind: 'undefined' }} />
          ) : (
            <NumberText value={displayNumber(principalArg(value), { digits: 5 })} />
          )
        }
      />
    </>
  );
}

function ValueCells({
  active,
  point,
  parameters,
  functions,
}: {
  active: ActiveExpression;
  point: Complex;
  parameters: ReadonlyMap<string, number>;
  functions: ReadonlyMap<string, UserFunctionDefinition>;
}): React.JSX.Element {
  const evaluation = makePointEvaluation(active, parameters, functions);
  if (evaluation === null) return <Cell label="value" value="—" />;

  const result = evaluation.evaluate(point);

  if (!result.ok) {
    return (
      <>
        <Cell label="value" value={<NumberText value={{ kind: 'undefined' }} />} emphasis />
        <span className="readout__reason">{result.issue.message}</span>
      </>
    );
  }

  const value = result.value;
  const color =
    active.entry.type?.signature.codomain.kind === 'C'
      ? domainColor(value, DEFAULT_DOMAIN_COLORING)
      : fieldColor(value, 'real', { min: value.re - 1, max: value.re + 1 });

  return (
    <>
      <Cell label="value" value={<ComplexText value={displayComplex(value, { digits: 6 })} />} />
      <Cell label="|w|" value={<NumberText value={displayNumber(cabs(value), { digits: 5 })} />} />
      <Cell
        label="arg"
        value={
          // The argument of zero has no value, and saying so is more honest than
          // printing the zero that atan2 would return.
          cabs(value) === 0 ? (
            <NumberText value={{ kind: 'undefined' }} />
          ) : (
            <NumberText value={displayNumber(principalArg(value), { digits: 5 })} />
          )
        }
      />
      <span className="readout__swatch-cell">
        <span className="readout__swatch" style={{ background: rgbToCss(color) }} />
      </span>
    </>
  );
}

function Cell({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: React.ReactNode;
  emphasis?: boolean;
}): React.JSX.Element {
  return (
    <span className={emphasis ? 'readout__cell readout__cell--emphasis' : 'readout__cell'}>
      <span className="readout__label">{label}</span>
      <span className="readout__value">{value}</span>
    </span>
  );
}
