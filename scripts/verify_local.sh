#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "[error] Docker is not installed."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[error] Docker daemon is not running. Start Docker Desktop and retry."
  exit 1
fi

echo "[1/3] Starting local PostgreSQL"
npm run db:up

echo "[2/3] Preparing Prisma"
npm run db:prepare -w @prive/api

echo "[3/3] Running verify"
npm run verify

echo "[done] Local verify completed"
