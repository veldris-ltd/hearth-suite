# syntax=docker/dockerfile:1
# release-service image. Build context is the repository root; see services.yml.
FROM rust:1.82-slim AS build
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY . .
RUN cargo build --release --manifest-path services/release-service/api/Cargo.toml

FROM gcr.io/distroless/cc-debian12
COPY --from=build /src/services/release-service/api/target/release/hearth-release-service /usr/local/bin/hearth-release-service
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/hearth-release-service"]
