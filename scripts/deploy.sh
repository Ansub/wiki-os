#!/usr/bin/env bash
# deploy.sh — generic self-hosted deploy helper for WikiOS
# Usage: ./scripts/deploy.sh [--skip-pull] [--skip-install] [--skip-restart] [--skip-smoke]
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

SKIP_PULL=false
SKIP_INSTALL=false
SKIP_RESTART=false
SKIP_SMOKE=false

for arg in "$@"; do
  case "$arg" in
    --skip-pull) SKIP_PULL=true ;;
    --skip-install) SKIP_INSTALL=true ;;
    --skip-restart) SKIP_RESTART=true ;;
    --skip-smoke) SKIP_SMOKE=true ;;
    *) echo "Unknown option: ${arg}" >&2; exit 1 ;;
  esac
done

APP_NAME="WikiOS"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/wiki-os"
LOG_DIR="${STATE_DIR}/logs"
DEPLOY_LOG="${LOG_DIR}/deploy.log"
BASE_URL="${WIKIOS_BASE_URL:-http://localhost:5211}"
RESTART_COMMAND="${WIKIOS_RESTART_COMMAND:-}"

mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$DEPLOY_LOG"; }
fail() { log "FATAL: $*"; exit 1; }

log "═══════════════════════════════════════"
log "${APP_NAME} deploy started"
log "═══════════════════════════════════════"

if [[ "$SKIP_PULL" == false ]]; then
  log "Pulling latest from origin/main..."
  git pull origin main --ff-only 2>&1 | tee -a "$DEPLOY_LOG" || fail "git pull failed — resolve conflicts first"
else
  log "Skipping git pull (--skip-pull)"
fi

COMMIT="$(git rev-parse --short HEAD)"
COMMIT_FULL="$(git rev-parse HEAD)"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "Commit: ${COMMIT}"

if [[ "$SKIP_INSTALL" == false ]]; then
  log "Installing dependencies..."
  npm install --prefer-offline 2>&1 | tail -3 | tee -a "$DEPLOY_LOG" || fail "npm install failed"
else
  log "Skipping npm install (--skip-install)"
fi

log "Building app..."
npm run build 2>&1 | tail -8 | tee -a "$DEPLOY_LOG" || fail "Build failed"

cat > version.json <<EOF
{
  "commit": "${COMMIT_FULL}",
  "commitShort": "${COMMIT}",
  "deployedAt": "${DEPLOYED_AT}"
}
EOF
log "Version file written (${COMMIT})"

if [[ "$SKIP_RESTART" == false ]]; then
  if [[ -n "$RESTART_COMMAND" ]]; then
    log "Running restart command..."
    bash -lc "$RESTART_COMMAND" 2>&1 | tee -a "$DEPLOY_LOG" || fail "restart command failed"
  else
    log "No WIKIOS_RESTART_COMMAND configured; restart your process manager manually if needed."
  fi
else
  log "Skipping service restart (--skip-restart)"
fi

if [[ "$SKIP_SMOKE" == false ]]; then
  log "Waiting for health endpoint..."
  for i in $(seq 1 20); do
    if curl -s -o /dev/null --max-time 2 "${BASE_URL}/api/health" 2>/dev/null; then
      log "Health endpoint is up (took ${i}s)"
      break
    fi
    if [[ $i -eq 20 ]]; then
      fail "Health endpoint did not come up within 20 seconds (${BASE_URL}/api/health)"
    fi
    sleep 1
  done

  log "Running smoke tests..."
  if WIKIOS_BASE_URL="${BASE_URL}" bash "${REPO_DIR}/scripts/smoke-test.sh" 2>&1 | tee -a "$DEPLOY_LOG"; then
    log "═══════════════════════════════════════"
    log "Deploy complete ✓  (${COMMIT})"
    log "═══════════════════════════════════════"
  else
    log "═══════════════════════════════════════"
    log "DEPLOY FAILED — smoke tests did not pass"
    log "Check: ${DEPLOY_LOG}"
    log "═══════════════════════════════════════"
    exit 1
  fi
else
  log "Skipping smoke tests (--skip-smoke)"
  log "Deploy complete ✓  (${COMMIT})"
fi
