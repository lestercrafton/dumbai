#!/usr/bin/env bash
# Push this run's commit to main without ever failing the job: rebase onto the latest main
# with retries, then try a merge that keeps this run's files on conflict, else skip with a warning.
set -u
[ "$(git rev-parse --is-shallow-repository)" = true ] && git fetch --quiet --unshallow origin || true
for attempt in 1 2 3 4; do
  git fetch --quiet origin main || { sleep $((attempt*10)); continue; }
  if git rebase origin/main; then
    git push origin HEAD:main && exit 0
  else
    git rebase --abort 2>/dev/null || true
  fi
  sleep $((attempt*10))
done
git fetch --quiet origin main && git merge --no-edit -X ours -m 'Milly: merge results with main [skip ci]' origin/main && git push origin HEAD:main && exit 0
git merge --abort 2>/dev/null || true
echo "::warning title=Milly results not pushed::Could not rebase or merge onto main after retries. Results are kept in this run's artifact."
exit 0
