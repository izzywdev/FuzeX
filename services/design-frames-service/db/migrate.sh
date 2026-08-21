#!/usr/bin/env bash
# db/migrate.sh — tiny, dependency-free migration runner for the
# design_frames Postgres lifecycle tier.
#
# Applies every services/design-frames-service/db/migrations/NNNN_*.sql file,
# in filename order, inside its own transaction, tracking what has already
# run in design_frames._migrations so re-running this script is a no-op for
# already-applied files (on top of every migration file also being
# idempotent on its own — CREATE ... IF NOT EXISTS / guarded triggers).
#
# This script does NOT create the database, a role, or a superuser. It
# assumes DATABASE_URL already points at a database + role that FuzeInfra
# has provisioned (see ../README.md). Requires only `psql` (no node_modules,
# no pg client library — the app tier's own DB client is a separate,
# backend-engineer-owned concern).
#
# Usage:
#   DATABASE_URL=postgres://user:pass@host:5432/dbname ./db/migrate.sh
#
# Exits non-zero on the first failing migration; nothing after it is applied.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${SCRIPT_DIR}/migrations"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: DATABASE_URL is not set (SealedSecret-sourced in every real environment; export it locally to dry-run)" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql not found on PATH" >&2
  exit 1
fi

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE SCHEMA IF NOT EXISTS design_frames;
CREATE TABLE IF NOT EXISTS design_frames._migrations (
  filename    text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
SQL

shopt -s nullglob
files=("${MIGRATIONS_DIR}"/[0-9][0-9][0-9][0-9]_*.sql)
shopt -u nullglob

if [[ ${#files[@]} -eq 0 ]]; then
  echo "no migrations found in ${MIGRATIONS_DIR}" >&2
  exit 1
fi

for f in "${files[@]}"; do
  name="$(basename "$f")"
  already="$(psql "${DATABASE_URL}" -tA -c \
    "SELECT 1 FROM design_frames._migrations WHERE filename = '${name}'")"
  if [[ "${already}" == "1" ]]; then
    echo "skip  ${name} (already applied)"
    continue
  fi
  echo "apply ${name}"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q \
    -c "BEGIN;" \
    -f "${f}" \
    -c "INSERT INTO design_frames._migrations (filename) VALUES ('${name}');" \
    -c "COMMIT;"
done

echo "design_frames schema up to date."
