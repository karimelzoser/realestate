#!/usr/bin/env bash
set -Eeuo pipefail

PG_CLIENT_IMAGE="${PG_CLIENT_IMAGE:-postgres:18}"
PG_CLIENT_DOCKER="${PG_CLIENT_DOCKER:-0}"

run_pg_tool() {
  local tool="$1"
  shift
  if [[ "$PG_CLIENT_DOCKER" == "1" ]]; then
    docker run --rm --network host -i "$PG_CLIENT_IMAGE" "$tool" "$@"
  else
    "$tool" "$@"
  fi
}
