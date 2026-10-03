#!/usr/bin/env bash
# Run the CI steps on HEAD in a fresh worktree; push only if they all pass, then wait for GitHub CI.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
if ! "$root/scripts/ci-local.sh"; then
  echo "Not pushing: local CI failed." >&2
  exit 1
fi
git -C "$root" push -q origin HEAD
sha=$(git -C "$root" rev-parse HEAD)
echo "Pushed ${sha:0:7}; waiting for GitHub CI..."
for _ in $(seq 1 90); do
  sleep 20
  line=$(gh run list --limit 10 --json headSha,status,conclusion --jq ".[] | select(.headSha==\"$sha\") | \"\(.status) \(.conclusion // \"\")\"" | head -1)
  case "$line" in
    "completed success") echo "GitHub CI: success"; exit 0 ;;
    completed*) echo "GitHub CI: $line" >&2; exit 1 ;;
  esac
done
echo "GitHub CI: timed out waiting" >&2
exit 1
