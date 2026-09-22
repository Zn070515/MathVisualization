/**
 * The HTTP adapter for the symbolic engine.
 *
 * The core defines the contract (`cas.ts`) and translates the canonical AST into
 * SymPy syntax (`sympy.ts`); this file is the transport. It lives in the
 * application rather than in the core because it is an environment concern: the
 * core stays free of network access, and the application decides where the engine
 * is and what to do when it is not there.
 *
 * Absence of the engine is a normal state, not an error. Every call returns an
 * outcome that says which it was, so no caller is ever tempted to invent a result.
 */
import {
  type CasAdapter,
  type SymbolicOutcome,
  type SymbolicRequest,
  createUnavailableAdapter,
} from '@mathviz/mathcore';

/** Where the engine lives, overridable at build time. */
export const DEFAULT_SYMBOLIC_URL = 'http://127.0.0.1:8000';

function baseUrl(): string {
  const configured = import.meta.env.VITE_SYMBOLIC_URL;
  return typeof configured === 'string' && configured.length > 0
    ? configured
    : DEFAULT_SYMBOLIC_URL;
}

/** How long to wait before deciding the engine is not there. */
const TIMEOUT_MS = 6000;

export function createSymbolicAdapter(url: string = baseUrl()): CasAdapter {
  return {
    name: 'SymPy',

    async isAvailable(): Promise<boolean> {
      try {
        const response = await fetchWithTimeout(`${url}/health`, { method: 'GET' }, TIMEOUT_MS);
        return response.ok;
      } catch {
        return false;
      }
    },

    async run(request: SymbolicRequest): Promise<SymbolicOutcome> {
      let response: Response;
      try {
        response = await fetchWithTimeout(
          `${url}/symbolic`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
          },
          TIMEOUT_MS,
        );
      } catch {
        return {
          status: 'unavailable',
          reason: `The symbolic engine at ${url} could not be reached. Numeric views are unaffected.`,
        };
      }

      if (!response.ok) {
        return {
          status: 'failed',
          message: `The symbolic engine returned ${String(response.status)}.`,
          issue: {
            kind: 'unsupported',
            detail: `HTTP ${String(response.status)} from the symbolic engine`,
            message: 'The symbolic engine could not answer this request.',
          },
        };
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return {
          status: 'failed',
          message: 'The symbolic engine returned a response that could not be read.',
          issue: {
            kind: 'unsupported',
            detail: 'unreadable response body',
            message: 'The symbolic engine returned a response that could not be read.',
          },
        };
      }

      return interpret(payload);
    },
  };
}

/** Turn the engine's JSON into an outcome, rejecting anything unexpected. */
function interpret(payload: unknown): SymbolicOutcome {
  if (typeof payload !== 'object' || payload === null) {
    return malformed();
  }
  const record = payload as Record<string, unknown>;

  if (record['status'] === 'ok' && typeof record['text'] === 'string') {
    const latex = record['latex'];
    const assumptions = record['assumptions'];
    return {
      status: 'computed',
      result: {
        exact: true,
        text: record['text'],
        latex: typeof latex === 'string' ? latex : null,
        assumptions: Array.isArray(assumptions)
          ? assumptions.filter((item): item is string => typeof item === 'string')
          : [],
      },
    };
  }

  if (typeof record['message'] === 'string') {
    return {
      status: 'failed',
      message: record['message'],
      issue: {
        kind: 'unsupported',
        detail: typeof record['reason'] === 'string' ? record['reason'] : 'symbolic failure',
        message: record['message'],
      },
    };
  }

  return malformed();
}

function malformed(): SymbolicOutcome {
  return {
    status: 'failed',
    message: 'The symbolic engine returned a response in an unexpected shape.',
    issue: {
      kind: 'unsupported',
      detail: 'unexpected response shape',
      message: 'The symbolic engine returned a response in an unexpected shape.',
    },
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** The adapter used in tests and when the application is run without a backend. */
export const offlineSymbolicAdapter: CasAdapter = createUnavailableAdapter(
  'No symbolic engine is configured. Set VITE_SYMBOLIC_URL, or start the service in services/symbolic.',
);
