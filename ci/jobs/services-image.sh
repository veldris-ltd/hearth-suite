#!/usr/bin/env bash
# Build, push and sign one optional-service image.  services-image.sh <service>
# Registry from IMAGE_REGISTRY + IMAGE_PREFIX (default ghcr.io/veldris-ltd/hearth-suite).
# Pushes and signs only when IMAGE_PUSH=true (never for pull/merge requests).
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1
svc="${1:?usage: services-image.sh <service>}"
[ -f "services/$svc/Dockerfile" ] || { ci_notice "services/$svc/Dockerfile not present, skipping"; exit 0; }
ci_need docker
image="${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_PREFIX:-veldris-ltd/hearth-suite}/${svc}:$(ci_sha)"
docker build -f "services/$svc/Dockerfile" -t "$image" .
if [ "${IMAGE_PUSH:-false}" = "true" ]; then
  docker push "$image"
  digest="$(docker inspect --format '{{index .RepoDigests 0}}' "$image")"
  ci_need cosign
  cosign sign --yes "$digest"
fi
