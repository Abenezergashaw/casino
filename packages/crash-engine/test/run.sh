#!/usr/bin/env bash
# Compile the engine with whichever tsc is available and run the tests.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tsc="${TSC:-$here/../../../games/aviator/node_modules/.bin/tsc}"
out="$(mktemp -d)"
"$tsc" --outDir "$out" --module commonjs --target es2020 --lib es2020,dom --strict --skipLibCheck "$here/../src/index.ts"
node "$here/engine.test.cjs" "$out/index.js"
