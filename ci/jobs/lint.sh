#!/usr/bin/env bash
# Lint and format gate (AC-QA-1): rustfmt, clippy -D warnings, eslint, prettier.
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1
ci_pnpm_install
ci_group "rustfmt";  cargo fmt --all --check; ci_endgroup
ci_group "clippy";   cargo clippy --workspace --all-targets --all-features --locked -- -D warnings; ci_endgroup
ci_group "eslint";   pnpm run lint; ci_endgroup
ci_group "prettier"; pnpm run format:check; ci_endgroup
# Tracked scripts with a shebang must carry the executable bit, or the jobs
# that call them fail with "Permission denied" (`#![` is a Rust attribute).
ci_group "executable bits"
missing=""
while IFS= read -r f; do
  if [ "$(head -c 3 "$f" | tr -d '\0')" = "#!/" ]; then missing+="$f"$'\n'; fi
done < <(git ls-files -s | awk '$1 == "100644" { sub(/^[^\t]*\t/, ""); print }')
if [ -n "$missing" ]; then
  printf '%s' "$missing" | sed 's/$/: has a shebang but is not executable/'
  exit 1
fi
ci_endgroup
