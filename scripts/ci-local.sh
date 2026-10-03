#!/usr/bin/env bash
# Run exactly the CI steps on a commit (default HEAD) in a fresh worktree: real submodule
# checkouts (no symlinks into this working tree), npm ci, typecheck, lint, format, tests, build.
set -uo pipefail
commit=${1:-HEAD}
root=$(git rev-parse --show-toplevel)
dir=$(mktemp -d "${TMPDIR:-/tmp}/apwt-ci.XXXXXX")
trap 'git -C "$root" worktree remove --force "$dir" >/dev/null 2>&1; rm -rf "$dir"' EXIT
git -C "$root" worktree add -q --detach "$dir" "$commit"
cd "$dir"
# Reuse the local object store so submodules don't re-download history.
git submodule update --init --depth 1 --reference "$root/upstream" upstream >/dev/null 2>&1 || git submodule update --init --depth 1 upstream
step=$(sed -n 's/.*run: \(git -C upstream submodule update.*\)/\1/p' .github/workflows/ci.yml)
eval "$step" >/dev/null 2>&1 || { echo "FAIL: nested submodules"; exit 1; }
status=0
run() { local name=$1; shift; if "$@" >"$dir/.log-$name" 2>&1; then echo "ok   $name"; else echo "FAIL $name"; tail -20 "$dir/.log-$name"; status=1; fi; }
run npm-ci npm ci
run typecheck npm run typecheck
run lint npm run lint
run format npm run format:check
run test npx vitest run
grep -E 'Tests ' "$dir/.log-test" | tail -1
run slow-proofs env APWT_SLOW_PROOFS=1 npx vitest run --no-file-parallelism proofs/mavlink/sha256-length.test.ts proofs/scurve-tool/scurve-tool.test.ts
run build npx vite build
exit $status
