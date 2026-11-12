#!/usr/bin/env bash
# Offline end-to-end journeys (create, edit, Ember, Seal, reopen) and the
# static accessibility, brand and no-telemetry guards.
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1
ci_pnpm_install
pnpm -r --if-present e2e
