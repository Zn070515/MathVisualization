#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root_directory="$(cd -- "$script_directory/.." && pwd)"
cd "$root_directory"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js is not installed. Run bash scripts/bootstrap.sh first.' >&2
  exit 1
fi

exec node scripts/start.mjs "$@"
