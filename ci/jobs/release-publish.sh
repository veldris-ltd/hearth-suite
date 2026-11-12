#!/usr/bin/env bash
# Publish signed release metadata to a release-service channel (P3.3).
#   release-publish.sh <beta|stable> <release-dir>
# Skips cleanly when RELEASE_SERVICE_URL is not configured (forks, self-hosters).
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
channel="${1:?usage: release-publish.sh <beta|stable> <release-dir>}"
dir="${2:?usage: release-publish.sh <beta|stable> <release-dir>}"
if [ -z "${RELEASE_SERVICE_URL:-}" ]; then
  ci_notice "RELEASE_SERVICE_URL not set, skipping $channel publish"
  exit 0
fi
[ -n "${HEARTH_PUBLISH_TOKEN:-}" ] || { ci_error "HEARTH_PUBLISH_TOKEN is not set"; exit 1; }
curl -fsS -X POST "${RELEASE_SERVICE_URL}/${channel}/publish" \
  -H "Authorization: Bearer ${HEARTH_PUBLISH_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "@${dir}/targets.json"
