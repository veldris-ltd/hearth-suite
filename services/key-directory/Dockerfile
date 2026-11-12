# syntax=docker/dockerfile:1
# key-directory image. Build context is the repository root; see services.yml.
FROM rust:1.82-slim AS build
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY . .
RUN cargo build --release --manifest-path services/key-directory/api/Cargo.toml

FROM gcr.io/distroless/cc-debian12
COPY --from=build /src/services/key-directory/api/target/release/hearth-key-directory /usr/local/bin/hearth-key-directory
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/hearth-key-directory"]
