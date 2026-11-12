# syntax=docker/dockerfile:1
# sync-relay image. Build context is the repository root (the service depends on
# the in-workspace hearth-relay-core by path); see .github/workflows/services.yml.
FROM rust:1.82-slim AS build
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY . .
RUN cargo build --release --manifest-path services/sync-relay/api/Cargo.toml

FROM gcr.io/distroless/cc-debian12
COPY --from=build /src/services/sync-relay/api/target/release/hearth-sync-relay /usr/local/bin/hearth-sync-relay
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/hearth-sync-relay"]
