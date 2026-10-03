#!/usr/bin/env bash
# Check only the projects listed in the committed root tsconfig.json (in-progress apps in the
# working tree are ignored), plus lint, formatting and tests for them.
set -euo pipefail
projects=$(node -e "const t=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(t.references.map(r=>r.path).join(' '))" "${1:-tsconfig.json}")
npx tsc -b $projects
npx eslint $projects --max-warnings 0
npx prettier --check $projects >/dev/null
npx vitest run $projects
