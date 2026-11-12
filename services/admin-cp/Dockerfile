# syntax=docker/dockerfile:1
# Admin Control Panel image: Rust API + static web UI.
# Build context is the repository root (see .github/workflows/services.yml).

# ---- web UI build -----------------------------------------------------------
FROM node:20-slim AS web
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm --filter "@hearth/admin..." build

# ---- API build --------------------------------------------------------------
FROM rust:1.82-slim AS api
WORKDIR /src
# webauthn-rs links OpenSSL (openssl-sys); the runtime image ships libssl3.
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY . .
# The admin-cp API is excluded from the root workspace; build it standalone.
RUN cargo build --release --manifest-path services/admin-cp/api/Cargo.toml

# ---- runtime ----------------------------------------------------------------
FROM gcr.io/distroless/cc-debian12
COPY --from=api /src/services/admin-cp/api/target/release/hearth-admin-cp /usr/local/bin/hearth-admin-cp
COPY --from=web /src/apps/admin/dist /srv/admin-web
ENV HEARTH_ADMIN_WEB=/srv/admin-web
EXPOSE 8080
# Run unprivileged.
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/hearth-admin-cp"]
