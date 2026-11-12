#!/usr/bin/env bash
# Lint and render the services chart without a cluster.
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1
ci_need helm
helm lint deploy/helm/hearth-services
helm template hearth deploy/helm/hearth-services >/dev/null
helm template hearth deploy/helm/hearth-services --set ingress.tls.enabled=false >/dev/null
