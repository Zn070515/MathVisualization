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
import type { ActiveExpression, WorkspaceStore } from '../state/workspaceStore';

export function ReadoutBar({ store }: { store: WorkspaceStore }): React.JSX.Element {
  const state = useStore(store, (current) => current);
  const point = state.hover ?? state.selection;
  const active = store.activeExpression();

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
