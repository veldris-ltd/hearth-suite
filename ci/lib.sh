#!/usr/bin/env bash
# Platform shim for Hearth Suite CI (ADR-HS-006).
#
# Every CI job is a script under ci/jobs/ that sources this file. The scripts
# hold all of the logic; .github/workflows/*.yml and .gitlab-ci.yml only provision
# a toolchain and call them, so GitHub Actions, GitLab CI and a local shell run
# exactly the same steps.
#
#   ci_platform            github | gitlab | local
#   ci_sha                 full commit SHA under test
#   ci_branch              branch name ("" for tags and merge/pull requests)
#   ci_is_main_push        true when this is a push to main (not a PR/MR)
#   ci_tmp                 scratch directory for the job
#   ci_group/ci_endgroup   collapsible log sections
#   ci_error / ci_notice   annotations
#   ci_secret_file VAR     path to a secret given either as content (GitHub
#                          secrets) or as a file path (GitLab file variables)
set -euo pipefail

ci_platform() {
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then echo github
  elif [ "${GITLAB_CI:-}" = "true" ]; then echo gitlab
  else echo local
  fi
}

ci_sha() {
  case "$(ci_platform)" in
    github) echo "$GITHUB_SHA" ;;
    gitlab) echo "$CI_COMMIT_SHA" ;;
    *) git rev-parse HEAD ;;
  esac
}

ci_branch() {
  case "$(ci_platform)" in
    github)
      if [ "${GITHUB_REF_TYPE:-}" = "branch" ] && [ -z "${GITHUB_HEAD_REF:-}" ]; then
        echo "${GITHUB_REF_NAME}"
      fi
      ;;
    gitlab) echo "${CI_COMMIT_BRANCH:-}" ;;
    *) git rev-parse --abbrev-ref HEAD ;;
  esac
}

ci_is_main_push() {
  case "$(ci_platform)" in
    github) [ "${GITHUB_EVENT_NAME:-}" != "pull_request" ] && [ "$(ci_branch)" = "main" ] ;;
    gitlab) [ -z "${CI_MERGE_REQUEST_IID:-}" ] && [ "$(ci_branch)" = "main" ] ;;
    *) return 1 ;;
  esac
}

ci_tmp() {
  local dir
  case "$(ci_platform)" in
    github) dir="${RUNNER_TEMP}" ;;
    gitlab) dir="${CI_PROJECT_DIR}/.ci-tmp" ;;
    *) dir="${TMPDIR:-/tmp}/hearth-ci" ;;
  esac
  mkdir -p "$dir"
  echo "$dir"
}

ci_group() {
  case "$(ci_platform)" in
    github) echo "::group::$*" ;;
    gitlab) printf '\e[0Ksection_start:%s:%s[collapsed=true]\r\e[0K%s\n' "$(date +%s)" "s${RANDOM}" "$*" ;;
    *) echo "==> $*" ;;
  esac
}

ci_endgroup() {
  case "$(ci_platform)" in
    github) echo "::endgroup::" ;;
    *) : ;;
  esac
}

ci_error() {
  case "$(ci_platform)" in
    github) echo "::error::$*" >&2 ;;
    *) echo "ERROR: $*" >&2 ;;
  esac
}

ci_notice() {
  case "$(ci_platform)" in
    github) echo "::notice::$*" ;;
    *) echo "NOTICE: $*" ;;
  esac
}

ci_secret_file() {
  local name="$1" value dest
  value="${!name:-}"
  [ -n "$value" ] || { ci_error "$name is not set"; return 1; }
  if [ -f "$value" ]; then
    chmod 600 "$value" 2>/dev/null || true
    echo "$value"
    return 0
  fi
  dest="$(ci_tmp)/secrets"
  ( umask 077; mkdir -p "$dest"; printf '%s\n' "$value" > "$dest/$name" )
  echo "$dest/$name"
}

ci_need() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || { ci_error "required tool '$tool' is not installed"; return 1; }
  done
}

ci_pnpm_install() {
  ci_group "pnpm install"
  pnpm install --frozen-lockfile
  ci_endgroup
}

# Repository root, whichever directory a job is started from.
CI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export CI_ROOT
