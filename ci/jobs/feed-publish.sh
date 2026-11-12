#!/usr/bin/env bash
# Publish a desktop build to its update feed over SSH (P12.2, AC-WIN-4,
# ADR-HS-007, ADR-HS-010). The feed is static files:
#   <FEED_PATH>/<channel>/targets.json   signed TUF metadata (checked first)
#   <FEED_PATH>/<channel>/latest.json    Tauri updater manifest
#   <FEED_PATH>/<channel>/<installers>   with their Tauri .sig and .sha256
#
# Installers go up before the metadata, so a client never sees metadata for a
# file that is not there yet. Refuses unsigned TUF metadata: a feed of unsigned
# metadata would only produce update errors on every client.
#
#   feed-publish.sh <artifact-dir> <channel>
#
#   FEED_HOST          feed host (the Plesk server hostname)
#   FEED_USER          SSH user of the feed subscription
#   FEED_PATH          document root of the feed (Plesk default: httpdocs)
#   FEED_PORT          SSH port (default 22)
#   FEED_SSH_KEY       private key authorised for that user
#   FEED_KNOWN_HOSTS   the host's public key line(s), pinned
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1

dir="${1:?usage: feed-publish.sh <artifact-dir> <channel>}"
channel="${2:?usage: feed-publish.sh <artifact-dir> <channel>}"
case "$channel" in beta) ;; *) ci_error "only the beta channel is published from here, got '$channel'"; exit 1 ;; esac
for var in FEED_HOST FEED_USER FEED_SSH_KEY FEED_KNOWN_HOSTS; do
  [ -n "${!var:-}" ] || { ci_error "$var is not set"; exit 1; }
done
for f in targets.json latest.json; do
  [ -f "$dir/$f" ] || { ci_error "$dir/$f missing"; exit 1; }
done
if ! node -e 'const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.exit(Array.isArray(m.signatures) && m.signatures.length > 0 ? 0 : 1);' "$dir/targets.json"; then
  ci_error "$dir/targets.json is unsigned (HEARTH_RELEASE_ROLE_SEED not set); not publishing"
  exit 1
fi
ci_need rsync ssh

key="$(ci_secret_file FEED_SSH_KEY)"
known_hosts="$(ci_secret_file FEED_KNOWN_HOSTS)"
trap 'rm -rf "$(ci_tmp)/secrets"' EXIT
remote="${FEED_USER}@${FEED_HOST}:${FEED_PATH:-httpdocs}/${channel}/"
ssh_cmd="ssh -p ${FEED_PORT:-22} -i $key -o IdentitiesOnly=yes -o UserKnownHostsFile=$known_hosts -o StrictHostKeyChecking=yes"

# 1. Installers, Tauri signatures and checksums.
rsync -rlptz --chmod=D755,F644 -e "$ssh_cmd" \
  --include='*.msi' --include='*.exe' --include='*.AppImage' --include='*.app.tar.gz' \
  --include='*.sig' --include='*.sha256' --exclude='*' \
  "$dir/" "$remote"
# 2. Metadata last.
rsync -lptz --chmod=F644 -e "$ssh_cmd" "$dir/targets.json" "$dir/latest.json" "$remote"
echo "published $(ci_sha) to the $channel feed"
