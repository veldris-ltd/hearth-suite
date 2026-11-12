#!/usr/bin/env bash
# Dynamic accessibility pass (AC-A11Y-*): axe-core over every app page and, in
# the primary repository, every built page of hearth-suite.app.
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1
ci_pnpm_install
if [ -f site/build.mjs ]; then
  ci_group "build hearth-suite.app"
  pnpm --filter @hearth/design-system build
  node site/build.mjs
  ci_endgroup
fi
# axe-core and jsdom are CI-only, deliberately not in the offline lockfile, and
# installed outside the pnpm-managed node_modules.
tools="$(ci_tmp)/axe-tools"
mkdir -p "$tools"
npm install --prefix "$tools" --no-audit --no-fund --no-save axe-core@4.10.2 jsdom@25.0.1
AXE_TOOLS_DIR="$tools" node apps/e2e/axe-ci.mjs
