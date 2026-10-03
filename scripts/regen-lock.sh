#!/usr/bin/env bash
# Regenerate package-lock.json for exactly the committed tree (ignoring other uncommitted
# workspaces in this working tree) and amend it into HEAD if it changed.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
dir=$(mktemp -d "${TMPDIR:-/tmp}/apwt-lock.XXXXXX")
trap 'git -C "$root" worktree remove --force "$dir" >/dev/null 2>&1; rm -rf "$dir"' EXIT
git -C "$root" worktree add -q --detach "$dir" HEAD
(cd "$dir" && npm install --no-audit --no-fund >/dev/null 2>&1)
if cmp -s "$dir/package-lock.json" <(git -C "$root" show HEAD:package-lock.json); then
  echo "lockfile already matches"
else
  git -C "$root" update-index --cacheinfo "100644,$(git -C "$root" hash-object -w "$dir/package-lock.json"),package-lock.json"
  git -C "$root" commit -q --amend --no-edit
  echo "lockfile regenerated and amended"
fi
