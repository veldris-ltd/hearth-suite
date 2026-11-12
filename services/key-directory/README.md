# key-directory, public-key directory + transparency log (P3.2)

Optional service that publishes users' **public** post-quantum keys for recipient
lookup. It never stores private keys, and every publish/revoke is recorded in an
**append-only transparency log** so key substitution is detectable. Clients can
also exchange keys peer-to-peer (QR / contact card) with no directory at all.

## Layout

- `api/`, Rust/axum service (excluded from the workspace; built into the image).
  Validation, the transparency log, and substitution detection come from the
  in-workspace, tested `crates/key-directory-core`.
- `Dockerfile`, `docker-compose.yml`, `helm/`, self-hosting.

## API

| Method   | Path                        | Purpose                                                                          |
| -------- | --------------------------- | -------------------------------------------------------------------------------- |
| `PUT`    | `/keys`                     | Publish/rotate a public identity (body = `PublicIdentity` bytes) → `{ key_id }`. |
| `GET`    | `/keys/{id}`                | Look up an active public key for sealing.                                        |
| `DELETE` | `/keys/{id}`                | Revoke a key.                                                                    |
| `GET`    | `/log`                      | The full append-only transparency log.                                           |
| `GET`    | `/log/inclusion?seq=&hash=` | Verify a pinned event's inclusion.                                               |

## Acceptance criteria

- **AC-KEYDIR-1 (public only):** only valid `PublicIdentity` bytes are accepted -
  parsing rejects anything containing private material; tested in `*-core`.
- **AC-KEYDIR-2 (transparency log):** publish/revoke append hash-chained events.
- **AC-KEYDIR-3 (substitution detectable):** a client compares the served key
  against its pinned hash and verifies the log's hash chain; any change or
  silent rewrite is detected (`is_substituted`, `verify_log`/`verify_inclusion`).

## Run

```sh
# no default passwords: generate them once (.env is git-ignored)
printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> services/key-directory/.env
docker compose -f services/key-directory/docker-compose.yml up --build
# or: helm install keydir services/key-directory/helm --set config.databaseUrl=postgres://…
```
