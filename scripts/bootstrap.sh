#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root_directory="$(cd -- "$script_directory/.." && pwd)"
pnpm_version="11.22.0"
minimum_node_version="24.0.0"
minimum_uv_version="0.12.0"

say() {
  printf '\n==> %s\n' "$1"
}

fail() {
  printf 'Bootstrap failed: %s\n' "$1" >&2
  exit 1
}

version_from() {
  printf '%s\n' "$1" | sed -nE 's/.*([^0-9]|^)([0-9]+\.[0-9]+\.[0-9]+)([^0-9]|$).*/\2/p' | head -n 1
}

version_at_least() {
  local actual minimum actual_major actual_minor actual_patch minimum_major minimum_minor minimum_patch
  actual="$(version_from "$1")"
  minimum="$(version_from "$2")"
  [ -n "$actual" ] || return 1
  [ -n "$minimum" ] || return 1
  IFS=. read -r actual_major actual_minor actual_patch <<< "$actual"
  IFS=. read -r minimum_major minimum_minor minimum_patch <<< "$minimum"
  if [ "$actual_major" -ne "$minimum_major" ]; then
    [ "$actual_major" -gt "$minimum_major" ]
  elif [ "$actual_minor" -ne "$minimum_minor" ]; then
    [ "$actual_minor" -gt "$minimum_minor" ]
  else
    [ "$actual_patch" -ge "$minimum_patch" ]
  fi
}

install_node_if_needed() {
  if command -v node >/dev/null 2>&1 && version_at_least "$(node --version)" "$minimum_node_version"; then
    return
  fi

  if command -v brew >/dev/null 2>&1; then
    brew install node@24 || brew upgrade node@24
    brew link --overwrite --force node@24 || true
  elif command -v nvm >/dev/null 2>&1; then
    nvm install 24
    nvm use 24
  else
    fail 'Node.js 24 LTS is required. Install it from https://nodejs.org/ or install Homebrew/nvm, then rerun this script.'
  fi
}

say 'Checking Node.js 24 LTS'
install_node_if_needed

say "Ensuring pnpm $pnpm_version"
current_pnpm=''
if command -v pnpm >/dev/null 2>&1; then
  current_pnpm="$(pnpm --version 2>/dev/null || true)"
fi
if [ "$current_pnpm" != "$pnpm_version" ]; then
  command -v npm >/dev/null 2>&1 || fail 'npm is unavailable after installing Node.js.'
  npm install --global "pnpm@$pnpm_version"
fi

say 'Ensuring uv 0.12 or newer'
if ! command -v uv >/dev/null 2>&1 || ! version_at_least "$(uv --version 2>/dev/null || true)" "$minimum_uv_version"; then
  command -v curl >/dev/null 2>&1 || fail 'curl is required to install uv from the official installer.'
  curl -LsSf https://astral.sh/uv/install.sh | sh
  user_home_dir="$(cd ~ && pwd)"
  if [ -x "$user_home_dir/.local/bin/uv" ]; then
    export PATH="$user_home_dir/.local/bin:$PATH"
  fi
fi
command -v uv >/dev/null 2>&1 || fail 'uv was installed but is not on PATH. Open a new terminal and rerun bootstrap.'

cd "$root_directory"
say 'Creating the project-local Python 3.12 environment'
uv python install 3.12
uv venv --python 3.12 services/symbolic/.venv
uv pip install --python services/symbolic/.venv/bin/python -r services/symbolic/requirements.txt

say 'Installing JavaScript dependencies'
pnpm install --frozen-lockfile

say 'Checking the completed environment'
node scripts/doctor.mjs

printf '\nBootstrap complete. Start the app with bash scripts/start.sh\n'
