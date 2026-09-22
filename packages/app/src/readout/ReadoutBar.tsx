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
 */
import {
  type Complex,
  type UserFunctionDefinition,
  type WorkspaceEntry,
  DEFAULT_DOMAIN_COLORING,
  cabs,
  cx,
  domainColor,
  evaluateScalar,
  fieldColor,
  formatComplex,
  formatReal,
  makeEnvironment,
  principalArg,
  rgbToCss,
} from '@mathviz/mathcore';
import { useStore } from '../state/store';
import { variableBindingsFor, type WorkspaceStore } from '../state/workspaceStore';

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
      <Cell label="point" value={formatComplex(point, { digits: 5 })} />

      {active === null ? (
        <Cell label="value" value="—" />
      ) : (
        <ValueCells
          entry={active.entry}
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
  entry,
  point,
  parameters,
  functions,
}: {
  entry: WorkspaceEntry;
  point: Complex;
  parameters: ReadonlyMap<string, number>;
  functions: ReadonlyMap<string, UserFunctionDefinition>;
}): React.JSX.Element {
  const body = entry.statement?.body;
  if (body === undefined) return <Cell label="value" value="—" />;

  // The variables are bound exactly as the views bind them, so the number printed
  // here is the value of the function at the point being pointed at.
  const bindings = variableBindingsFor(entry);
  const values = new Map<string, Complex>(
    [...parameters].map(([name, value]) => [name, cx(value, 0)]),
  );
  for (const [name, binding] of bindings) {
    values.set(name, binding.kind === 'complex' ? point : cx(binding.axis === 0 ? point.re : point.im, 0));
  }

  const result = evaluateScalar(body, makeEnvironment({ values, functions }));

  if (!result.ok) {
    return (
      <>
        <Cell label="value" value="undefined" emphasis />
        <span className="readout__reason">{result.issue.message}</span>
      </>
    );
  }

  const value = result.value;
  const color =
    entry.type?.signature.codomain.kind === 'C'
      ? domainColor(value, DEFAULT_DOMAIN_COLORING)
      : fieldColor(value, 'real', { min: value.re - 1, max: value.re + 1 });

  return (
    <>
      <Cell label="value" value={formatComplex(value, { digits: 6 })} />
      <Cell label="|w|" value={formatReal(cabs(value), { digits: 5 })} />
      <Cell
        label="arg"
        value={cabs(value) === 0 ? 'undefined' : formatReal(principalArg(value), { digits: 5 })}
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
  value: string;
  emphasis?: boolean;
}): React.JSX.Element {
  return (
    <span className={emphasis ? 'readout__cell readout__cell--emphasis' : 'readout__cell'}>
      <span className="readout__label">{label}</span>
      <span className="readout__value">{value}</span>
    </span>
  );
}
