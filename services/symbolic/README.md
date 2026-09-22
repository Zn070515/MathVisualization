# Symbolic engine

The SymPy backend, behind the adapter contract in
`packages/mathcore/src/cas.ts`. It is optional: every picture, readout and
parameter slider works without it, and the interface says when it is absent rather
than guessing.

## Running

```bash
cd services/symbolic
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt    # Windows
.venv/bin/python -m pip install -r requirements.txt        # macOS / Linux
.venv/Scripts/python server.py
```

Listens on `127.0.0.1:8000`.

## Endpoints

### `GET /health`

```json
{ "status": "ok", "engine": "sympy", "version": "1.14.0" }
```

### `POST /symbolic`

```json
{
  "operation": "differentiate",
  "expression": "(sin(z) / ((z ** 2) + 1))",
  "symbols": ["z"],
  "withRespectTo": "z"
}
```

`operation` is one of `differentiate` or `simplify`. The `expression` is SymPy
syntax, produced by `lowerToSympy()` in the core — never written by hand and never
by the user.

A successful answer:

```json
{
  "status": "ok",
  "text": "(-2*z*sin(z) + (z**2 + 1)*cos(z))/(z**2 + 1)**2",
  "latex": "\\frac{- 2 z \\sin{\\left(z \\right)} + ...}",
  "assumptions": []
}
```

A failure is still a `200` with `"status": "error"`, a machine-readable `reason`
and a message for the user. A service that drops the connection instead of
reporting the problem leaves the caller unable to say what went wrong.

## Two decisions worth knowing

**Only the standard library and SymPy.** No web framework. The surface is two
endpoints on a loopback socket, and the standard library serves that without adding
a dependency to install, pin, and keep patched.

**Client input is never `exec`'d.** The request carries a `preamble`, which is
ignored. Symbols are constructed from the `symbols` list and expressions are parsed
against an explicit allowlist of names, so the only thing a request can do is
construct and differentiate an expression. A service that evaluates arbitrary
expressions *and* evaluates arbitrary code would be two problems instead of one.

## Layering

```
user types f(z)=sin(z)/(z^2+1)
        │
        ▼  packages/mathcore/src/parser.ts     — one canonical AST
   canonical AST
        │
        ▼  packages/mathcore/src/sympy.ts      — exact rationals preserved
   SymPy syntax:  (sin(z) / ((z ** 2) + 1))
        │
        ▼  packages/app/src/symbolic/symbolicClient.ts   — the transport
   HTTP
        │
        ▼  this service
   SymPy  →  "(-2*z*sin(z) + (z**2 + 1)*cos(z))/(z**2 + 1)**2"
```

The core never touches the network; the service never sees the user's text. The
`expression` field is always the output of the lowering, which is why the service
can afford to be strict about what it accepts.
