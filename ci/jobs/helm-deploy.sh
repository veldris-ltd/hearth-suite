#!/usr/bin/env bash
# Deploy the optional services chart.  helm-deploy.sh <staging|prod>
# Needs KUBECONFIG_B64 (base64 kubeconfig); skips cleanly when absent.
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1
env="${1:?usage: helm-deploy.sh <staging|prod>}"
if [ -z "${KUBECONFIG_B64:-}" ]; then
  ci_notice "KUBECONFIG_B64 not set; skipping $env deploy. Self-hosters: helm upgrade --install hearth deploy/helm/hearth-services"
  exit 0
fi
ci_need helm
KUBECONFIG="$(ci_tmp)/kubeconfig"
export KUBECONFIG
( umask 077; echo "$KUBECONFIG_B64" | base64 -d > "$KUBECONFIG" )
trap 'rm -f "$KUBECONFIG"' EXIT
helm upgrade --install hearth deploy/helm/hearth-services \
  --namespace "hearth-$env" --create-namespace \
  --set image.tag="$(ci_sha)" --wait --timeout 5m
