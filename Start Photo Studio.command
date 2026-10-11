#!/bin/zsh
set -e
cd "${0:A:h}"

runtime_root="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
if ! command -v node >/dev/null 2>&1 && [[ -x "$runtime_root/node/bin/node" ]]; then
  export PATH="$runtime_root/node/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  print 'Install Node.js 22.12 or later and pnpm, then run this launcher again.'
  read -k 1 '?Press any key to close.'
  exit 1
fi
if command -v pnpm >/dev/null 2>&1; then
  package_runner="$(command -v pnpm)"
elif [[ -x "$runtime_root/bin/fallback/pnpm" ]]; then
  package_runner="$runtime_root/bin/fallback/pnpm"
else
  print 'pnpm is missing. Run: corepack enable'
  read -k 1 '?Press any key to close.'
  exit 1
fi
if curl -fsS http://127.0.0.1:5173/ 2>/dev/null | /usr/bin/grep -q 'Photo Studio'; then
  open http://127.0.0.1:5173
  exit 0
fi
if [[ ! -d node_modules ]]; then
  "$package_runner" install --frozen-lockfile
fi
exec "$package_runner" dev --open
