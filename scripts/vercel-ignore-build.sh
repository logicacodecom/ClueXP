#!/bin/bash
# Vercel "Ignored Build Step" for every ClueXP project (specs/004 FR-013 amendment).
# Exit 0 = skip this build; any non-zero exit = build.
#
# Skips only when nothing under the given paths (relative to the project's root
# directory) changed since this branch's LAST SUCCESSFUL deployment
# (VERCEL_GIT_PREVIOUS_SHA). Comparing to the last successful deployment, not HEAD^,
# means a change whose build failed or was rate-limited is still built next time.
# Any doubt (no previous deployment, missing history, git error) builds.
set -u

prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$prev" ]; then
  echo "vercel-ignore-build: no previous successful deployment -> build"
  exit 1
fi

if ! git cat-file -e "${prev}^{commit}" 2>/dev/null; then
  git fetch --quiet --depth=200 origin "$prev" 2>/dev/null
  if ! git cat-file -e "${prev}^{commit}" 2>/dev/null; then
    echo "vercel-ignore-build: previous deployment ${prev} not in history -> build"
    exit 1
  fi
fi

git diff --quiet "$prev" HEAD -- "$@"
status=$?
if [ "$status" -eq 0 ]; then
  echo "vercel-ignore-build: no changes in [$*] since ${prev:0:12} -> skip"
  exit 0
fi
echo "vercel-ignore-build: changes in [$*] since ${prev:0:12} (git diff exit $status) -> build"
exit 1
