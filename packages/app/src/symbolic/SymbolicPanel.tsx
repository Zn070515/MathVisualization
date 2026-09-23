/**
 * The symbolic panel.
 *
 * Offers one real operation — the derivative — for the active expression, through
 * the adapter. It exists for two reasons: a derivative in closed form is genuinely
 * useful next to the picture, and it proves the whole symbolic path end to end
 * (canonical AST → SymPy syntax → engine → result) rather than leaving the CAS
 * adapter as an aspiration.
 *
 * Three states are shown distinctly, because conflating them would be dishonest:
 * the engine is not running, the engine ran and answered, the engine ran and could
 * not. When it is not running the panel says so and points at the service; it never
 * substitutes a guess.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type CasAdapter,
  type SymbolicOutcome,
  complexDerivativeIssue,
  lowerToSympy,
  sympyPreamble,
} from '@mathviz/mathcore';
import { useStore } from '../state/store';
import type { WorkspaceStore } from '../state/workspaceStore';
import { createSymbolicAdapter } from './symbolicClient';

type Availability = 'checking' | 'available' | 'absent';

export function SymbolicPanel({
  store,
  adapter,
}: {
  store: WorkspaceStore;
  adapter?: CasAdapter;
}): React.JSX.Element {
  const state = useStore(store, (current) => current);
  const resolved = useMemo(() => adapter ?? createSymbolicAdapter(), [adapter]);

  const [availability, setAvailability] = useState<Availability>('checking');
  const [outcome, setOutcome] = useState<SymbolicOutcome | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void resolved.isAvailable().then((available) => {
      if (!cancelled) setAvailability(available ? 'available' : 'absent');
    });
    return () => {
      cancelled = true;
    };
  }, [resolved]);

  const active = store.activeExpression();

  const differentiate = useCallback(async () => {
    if (active === null || active.entry.statement === null) return;
    const body = active.entry.statement.body;
    const declaredSymbols =
      active.entry.statement.kind === 'function-definition'
        ? [...active.entry.statement.parameters]
        : [...active.bindings.keys()];
    const symbols = [...new Set([...declaredSymbols, ...active.parameterNames])];

    const variable =
      active.entry.statement.kind === 'function-definition'
        ? active.entry.statement.parameters[0]
        : symbols[0];

    if (active.signature.domain.kind === 'C' && variable !== undefined) {
      const issue = complexDerivativeIssue(body, variable);
      if (issue !== null) {
        setOutcome({
          status: 'failed',
          message: issue.message,
          issue,
        });
        return;
      }
    }

    const lowered = lowerToSympy(body, symbols);
    if (!lowered.ok) {
      setOutcome({
        status: 'failed',
        message: lowered.issue.message,
        issue: lowered.issue,
      });
      return;
    }

    setPending(true);
    const result = await resolved.run({
      operation: 'differentiate',
      expression: lowered.value,
      symbols,
      preamble: sympyPreamble(symbols),
      ...(variable === undefined ? {} : { withRespectTo: variable }),
    });
    setOutcome(result);
    setPending(false);
  }, [active, resolved]);

  // A new expression makes the previous result stale; drop it rather than let it
  // read as the derivative of something else.
  useEffect(() => {
    setOutcome(null);
    // A result belongs to the expression it was computed from, so a changed
    // expression makes it stale. Keyed on the workspace rather than on a counter.
  }, [state.workspace]);

  return (
    <section className="symbolic" aria-label="Symbolic analysis">
      <header className="symbolic__header">
        <h2 className="symbolic__title">Symbolic</h2>
        <span className={`symbolic__state symbolic__state--${availability}`}>
          {availability === 'checking'
            ? 'checking the engine'
            : availability === 'available'
              ? `engine: ${resolved.name}`
              : 'engine not running'}
        </span>
      </header>

      {availability === 'absent' && (
        <p className="symbolic__note">
          The symbolic engine is a separate service. Start it with{' '}
          <span className="symbolic__mono">python services/symbolic/server.py</span>. Numeric views
          work without it; nothing here is guessed when it is absent.
        </p>
      )}

      <div className="symbolic__actions">
        <button
          type="button"
          className="symbolic__action"
          disabled={active === null || pending || availability !== 'available'}
          onClick={() => {
            void differentiate();
          }}
        >
          {pending ? 'Computing…' : 'Differentiate'}
        </button>
        {active !== null && (
          <span className="symbolic__subject">
            d/d
            {active.entry.statement?.kind === 'function-definition'
              ? firstSymbol(active.entry.statement.parameters)
              : firstSymbol(active.bindings.keys())}
          </span>
        )}
      </div>

      {outcome !== null && <Outcome outcome={outcome} />}
    </section>
  );
}

function firstSymbol(names: Iterable<string>): string {
  const first = names[Symbol.iterator]().next();
  return first.done === true ? 'x' : first.value;
}

function Outcome({ outcome }: { outcome: SymbolicOutcome }): React.JSX.Element {
  if (outcome.status === 'unavailable') {
    return <p className="symbolic__note">{outcome.reason}</p>;
  }
  if (outcome.status === 'failed') {
    return (
      <p className="symbolic__problem" role="status">
        {outcome.message}
      </p>
    );
  }

  return (
    <div className="symbolic__result">
      {/* Marked exact, because it came from the engine. Numeric readouts are
          approximations; this is not, and the interface says which is which. */}
      <span className="symbolic__exact">exact</span>
      <code className="symbolic__value">{outcome.result.text}</code>
      {outcome.result.assumptions.length > 0 && (
        <ul className="symbolic__assumptions">
          {outcome.result.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
