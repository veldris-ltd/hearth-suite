# Hearth Suite CI image for GitLab (ADR-HS-006).
#
# Provides every tool the ci/jobs/*.sh scripts expect, so GitLab runners execute
# the same steps GitHub Actions runs. Built and pushed by the `ci-image` job in
# .gitlab-ci.yml to $CI_REGISTRY_IMAGE/ci:<tag>. Versions are pinned; bump them
# deliberately and rebuild.

ARG RUST_VERSION=1.99.0
ARG NODE_VERSION=22.22.0
ARG GO_VERSION=1.24.9

# ---- Go-built tools (one stage, pinned module versions) ----------------------
FROM golang:${GO_VERSION}-bookworm AS gotools
ENV CGO_ENABLED=0 GOBIN=/out
RUN go install github.com/sigstore/cosign/v2/cmd/cosign@v2.4.1 \
 && go install github.com/anchore/syft/cmd/syft@v1.18.1 \
 && go install github.com/google/osv-scanner/cmd/osv-scanner@v1.9.1 \
 && go install helm.sh/helm/v3/cmd/helm@v3.16.3

FROM node:${NODE_VERSION}-bookworm-slim AS node

# ---- Runtime ---------------------------------------------------------------------
FROM rust:${RUST_VERSION}-bookworm

# System packages: git/ssh/rsync for publishing, python3 for the export tool,
# WebKitGTK and friends for the Linux Tauri desktop build.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git openssh-client rsync python3 python3-pip python3-venv \
      libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev libgtk-3-dev patchelf imagemagick \
 && rm -rf /var/lib/apt/lists/*

# Node.js + pnpm (version from package.json "packageManager").
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
 && corepack enable \
 && corepack prepare pnpm@10.34.6 --activate

COPY --from=gotools /out/ /usr/local/bin/

# Rust components, the nightly toolchain for fuzzing, and the cargo tools.
RUN rustup component add rustfmt clippy llvm-tools-preview \
 && rustup toolchain install nightly --profile minimal \
 && cargo install --locked cargo-audit@0.21.1 cargo-deny@0.16.4 cargo-llvm-cov@0.6.15 cargo-fuzz@0.12.0 just@1.38.0 \
 && rm -rf "$CARGO_HOME/registry" "$CARGO_HOME/git"

ENV CARGO_TERM_COLOR=always
