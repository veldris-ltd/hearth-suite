# Makefile fallback for environments without `just`. Mirrors the justfile.
.PHONY: default setup fmt lint build test e2e audit

default: lint

setup:
	pnpm install --frozen-lockfile

fmt:
	cargo fmt --all
	pnpm run format

lint: setup
	cargo fmt --all --check
	cargo clippy --workspace --all-targets --all-features -- -D warnings
	pnpm run lint
	pnpm run format:check

build: setup
	cargo build --workspace --all-targets
	pnpm run build

test: setup
	cargo test --workspace
	pnpm run test

e2e: setup
	pnpm run e2e

audit:
	cargo deny check
