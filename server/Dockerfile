FROM node:22.22.3-bookworm-slim AS node

FROM rust:1.90-bookworm AS build
WORKDIR /build
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY .node-version ./
COPY server/Cargo.toml server/Cargo.lock server/build.rs server/build-admin-locales.mjs server/admin-locales.ts ./server/
COPY server/src ./server/src
COPY server/admin ./server/admin
COPY web/package.json ./web/
COPY web/src/i18n ./web/src/i18n
COPY packages/connection-protocol/Cargo.toml ./packages/connection-protocol/
COPY packages/connection-protocol/src ./packages/connection-protocol/src
RUN cargo build --release --locked --manifest-path server/Cargo.toml

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 --create-home agentdeck
COPY --from=build /build/server/target/release/agentdeck-cloud /usr/local/bin/agentdeck-cloud
USER 10001
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/agentdeck-cloud"]
