#!/usr/bin/env bash
# Developer Certificate of Origin check for pull requests (launch readiness L-10,
# CONTRIBUTING.md "Signing off your commits").
#
# Every non-merge commit in DCO_BASE..DCO_HEAD must carry a trailer
#   Signed-off-by: Name <email>
# whose email matches the commit author's email (case-insensitive), as added by
# `git commit -s`. Merge commits are skipped: they add no authored content.
#
#   DCO_BASE   base commit of the pull request (required)
#   DCO_HEAD   head commit of the pull request (default: HEAD)
#
# Runs locally too: DCO_BASE=origin/main ci/jobs/dco.sh
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "${DCO_REPO:-$CI_ROOT}" || exit 1

base="${DCO_BASE:-}"
head="${DCO_HEAD:-HEAD}"
[ -n "$base" ] || { ci_error "DCO_BASE is not set"; exit 1; }
git rev-parse -q --verify "$base^{commit}" >/dev/null || { ci_error "DCO_BASE $base is not a commit in this checkout (fetch full history)"; exit 1; }
git rev-parse -q --verify "$head^{commit}" >/dev/null || { ci_error "DCO_HEAD $head is not a commit in this checkout"; exit 1; }

checked=0
failed=0
while IFS= read -r sha; do
  [ -n "$sha" ] || continue
  checked=$((checked + 1))
  author="$(git log -1 --format='%ae' "$sha" | tr '[:upper:]' '[:lower:]')"
  signoffs="$(git log -1 --format='%(trailers:key=Signed-off-by,valueonly)' "$sha" | tr '[:upper:]' '[:lower:]')"
  if ! printf '%s\n' "$signoffs" | grep -qF "<$author>"; then
    failed=$((failed + 1))
    ci_error "commit $(git log -1 --format='%h %s' "$sha") has no Signed-off-by for its author <$author>"
  fi
done < <(git rev-list --no-merges "$base..$head")

if [ "$failed" -gt 0 ]; then
  ci_error "$failed of $checked commit(s) are not signed off. Add the sign-off with: git rebase --signoff $base && git push --force-with-lease"
  exit 1
fi
echo "dco: $checked commit(s) signed off"
