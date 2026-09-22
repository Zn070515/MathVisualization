"""The symbolic engine service.

SymPy is a backend mathematical capability (GOAL.md 12), so it runs as a separate
process behind the adapter contract in ``packages/mathcore/src/cas.ts``. The
browser never talks to SymPy directly, and the core never talks to the network.

Two deliberate choices:

* **Only the standard library and SymPy.** No web framework. The surface is two
  endpoints on a loopback socket, and the standard library serves that without
  adding a dependency to install, pin and maintain.
* **No ``exec`` of client input.** The request carries a preamble, but it is not
  executed. Symbols are constructed from the ``symbols`` list and expressions are
  parsed with an explicit allowlist of names, so the only thing a request can do
  is construct and differentiate a SymPy expression. Running a service that
  evaluates arbitrary expressions *and* evaluates arbitrary code would be two
  problems instead of one.

What it answers is exact. A derivative from here is marked ``exact`` in the
response and shown as such in the interface, which is the distinction GOAL.md
section 13 requires the product to make between a symbolic result and a numerical
approximation.
"""

from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import sympy
from sympy import (
    Abs,
    E,
    Float,
    I,
    Integer,
    Matrix,
    Rational,
    Symbol,
    arg,
    conjugate,
    cos,
    cosh,
    exp,
    log,
    nan,
    oo,
    simplify,
    sin,
    sinh,
    sqrt,
    tan,
    tanh,
    zoo,
)
# SymPy's real and imaginary parts are named `re` and `im`, which collide with the
# standard library's `re` module. They are imported under aliases and registered
# in the namespace under their SymPy names, so both are available without one
# shadowing the other.
from sympy import im as sympy_im
from sympy import re as sympy_re

HOST = "127.0.0.1"
PORT = 8000

OPERATIONS = ("simplify", "differentiate")

# Every name the lowering in `sympy.ts` may emit. Restricting the namespace to
# this list is what keeps a request from reaching anything else.
NAMESPACE: dict[str, Any] = {
    "Symbol": Symbol,
    "Integer": Integer,
    "Float": Float,
    "Rational": Rational,
    "Matrix": Matrix,
    "pi": sympy.pi,
    "E": E,
    "I": I,
    "oo": oo,
    "nan": nan,
    "zoo": zoo,
    "sin": sin,
    "cos": cos,
    "tan": tan,
    "sinh": sinh,
    "cosh": cosh,
    "tanh": tanh,
    "exp": exp,
    "log": log,
    "sqrt": sqrt,
    "Abs": Abs,
    "arg": arg,
    "re": sympy_re,
    "im": sympy_im,
    "conjugate": conjugate,
}

# Names that must not appear in an expression at all, because they would escape
# the allowlist above.
FORBIDDEN = ("__", "import", "lambda", "exec", "eval", "open", "os.", "sys.")

SYMBOL_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class RequestError(Exception):
    """A request that cannot be answered, with a message for the caller."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message


def _check_expression(expression: str) -> None:
    if not isinstance(expression, str) or expression.strip() == "":
        raise RequestError("empty-expression", "No expression was supplied.")
    lowered = expression.lower()
    for forbidden in FORBIDDEN:
        if forbidden in lowered:
            raise RequestError(
                "rejected-token",
                f"The expression contains {forbidden!r}, which this service does not accept.",
            )


def _build_symbols(names: Any) -> dict[str, Any]:
    if names is None:
        names = []
    if not isinstance(names, list):
        raise RequestError("bad-symbols", "The symbol list must be a list of names.")
    mapping: dict[str, Any] = {}
    for index, name in enumerate(names):
        if not isinstance(name, str) or not SYMBOL_NAME.match(name):
            raise RequestError(
                "bad-symbol",
                f"{name!r} is not a usable symbol name.",
            )
        mapping[name] = Symbol(name)
    return mapping


def _assumptions_for(parsed: Any) -> list[str]:
    """Branch conventions the result depends on, surfaced rather than hidden.

    SymPy's ``log`` is the principal logarithm with its cut on the negative real
    axis, and ``sqrt`` is the principal square root — the same conventions the
    rest of the project uses (see ``conventions.ts``), so these are consistent
    rather than assumed away. Stating them is what lets the interface show a
    result as exact *and* say what it depends on.

    ``sqrt`` is a function returning a power, not a class, so it is recognised as
    ``Pow`` with exponent one half rather than by ``isinstance``.
    """
    notes: set[str] = set()

    for node in sympy.preorder_traversal(parsed):
        if isinstance(node, sympy.log):
            notes.add(
                "The principal branch of the logarithm is used, with its cut on the negative real axis."
            )
        if node.is_Pow and node.exp == sympy.Rational(1, 2):
            notes.add("The principal square root is used.")

    return sorted(notes)


def handle(request: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    """Answer one request. Always returns a JSON body, even for a failure."""
    operation = request.get("operation")
    if operation not in OPERATIONS:
        return 200, {
            "status": "error",
            "reason": "unknown-operation",
            "message": f"{operation!r} is not one of {', '.join(OPERATIONS)}.",
        }

    try:
        _check_expression(request.get("expression"))
        symbols = _build_symbols(request.get("symbols"))
    except RequestError as error:
        return 200, {"status": "error", "reason": error.reason, "message": error.message}

    expression = request["expression"]
    local_namespace = dict(NAMESPACE)
    local_namespace.update(symbols)

    try:
        parsed = sympy.sympify(expression, locals=local_namespace)
    except Exception as error:  # SympifyError and friends
        return 200, {
            "status": "error",
            "reason": "unparseable",
            "message": f"The expression could not be read: {error}",
        }

    try:
        if operation == "simplify":
            result = simplify(parsed)
        else:
            variable_name = request.get("withRespectTo")
            if not isinstance(variable_name, str) or variable_name not in symbols:
                return 200, {
                    "status": "error",
                    "reason": "missing-variable",
                    "message": "Differentiation needs to know which variable to differentiate by.",
                }
            derivative = sympy.diff(parsed, symbols[variable_name])
            result = simplify(derivative)
    except Exception as error:
        return 200, {
            "status": "error",
            "reason": "engine-failure",
            "message": f"The engine could not carry out that operation: {error}",
        }

    return 200, {
        "status": "ok",
        "text": sympy.sstr(result),
        "latex": sympy.latex(result),
        "assumptions": _assumptions_for(parsed),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "MathVisualizationSymbolic/0.1"

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        # The application is served from a different port during development.
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802 - name fixed by the base class
        self._send(200, {"status": "ok"})

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/health":
            self._send(
                200,
                {"status": "ok", "engine": "sympy", "version": sympy.__version__},
            )
            return
        self._send(404, {"status": "error", "reason": "not-found", "message": "Unknown path."})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/symbolic":
            self._send(404, {"status": "error", "reason": "not-found", "message": "Unknown path."})
            return

        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            request = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send(
                200,
                {"status": "error", "reason": "bad-json", "message": "The request was not valid JSON."},
            )
            return

        if not isinstance(request, dict):
            self._send(
                200,
                {"status": "error", "reason": "bad-request", "message": "The request must be an object."},
            )
            return

        # Any failure still produces a JSON answer. A service that drops the
        # connection instead of reporting the problem leaves the caller unable to
        # say what went wrong, which is exactly what GOAL.md section 14 forbids.
        try:
            status, payload = handle(request)
        except Exception as error:  # noqa: BLE001 - the point is to answer, not to re-raise
            status, payload = 200, {
                "status": "error",
                "reason": "internal-error",
                "message": f"The engine failed unexpectedly: {type(error).__name__}: {error}",
            }
        self._send(status, payload)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        # One line per request, on stderr, without the noisy default timestamp.
        print(f"symbolic: {format % args}", flush=True)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"symbolic engine listening on http://{HOST}:{PORT}", flush=True)
    print(f"sympy {sympy.__version__} · operations: {', '.join(OPERATIONS)}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("symbolic engine stopping", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
