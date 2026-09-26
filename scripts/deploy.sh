#!/usr/bin/env bash
# ==============================================================================
# DCITM CRM — Production Deployment Script (VPS / Docker Compose)
# ==============================================================================
# Automates zero-downtime, selective service deployment for DCITM CRM stack:
# - backend:  NestJS API container (dcitm-backend) on port 3000
# - frontend: React/Vite + Nginx container (dcitm-frontend) on port 3001
#
# GUARANTEES:
# - Never restarts or recreates PostgreSQL or Redis during normal deployments.
# - Never executes destructive commands (no 'docker compose down', no volume prune).
# - Automatic healthcheck polling and diagnostic log output on failure.
# - Rollback mechanism to safely revert to previous Git commit on failure.
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# Color Output Formatting
# ------------------------------------------------------------------------------
C_RESET="\033[0m"
C_RED="\033[1;31m"
C_GREEN="\033[1;32m"
C_YELLOW="\033[1;33m"
C_BLUE="\033[1;34m"
C_CYAN="\033[1;36m"

log_info()    { echo -e "${C_BLUE}==>${C_RESET} [INFO] $*"; }
log_success() { echo -e "${C_GREEN}==>${C_RESET} [SUCCESS] $*"; }
log_warn()    { echo -e "${C_YELLOW}==>${C_RESET} [WARN] $*"; }
log_error()   { echo -e "${C_RED}==>${C_RESET} [ERROR] $*" >&2; }

# ------------------------------------------------------------------------------
# Path & Environment Resolution
# ------------------------------------------------------------------------------
# Base path can be overridden by setting DCITM_BASE_DIR
BASE_DIR="${DCITM_BASE_DIR:-/var/www/crm}"
BACKEND_DIR="${DCITM_BACKEND_DIR:-$BASE_DIR/dcitm-crm}"
FRONTEND_DIR="${DCITM_FRONTEND_DIR:-$BASE_DIR/dcitm-crm-frontend}"
BRANCH="${DEPLOY_BRANCH:-main}"

# State directory to record deployed commits for change detection and rollbacks
STATE_DIR="$BASE_DIR/.deploy_state"
mkdir -p "$STATE_DIR"

BACKEND_STATE_FILE="$STATE_DIR/last_backend_commit"
FRONTEND_STATE_FILE="$STATE_DIR/last_frontend_commit"

TARGET="${1:-auto}"

# ------------------------------------------------------------------------------
# Pre-flight Checks
# ------------------------------------------------------------------------------
check_requirements() {
  if ! command -v docker &>/dev/null; then
    log_error "Docker is not installed or not in PATH."
    exit 1
  fi

  if ! docker compose version &>/dev/null; then
    log_error "Docker Compose v2 plugin is required ('docker compose')."
    exit 1
  fi

  if [ ! -d "$BACKEND_DIR" ]; then
    log_error "Backend repository directory not found at: $BACKEND_DIR"
    exit 1
  fi

  if [ ! -f "$BACKEND_DIR/docker-compose.yml" ]; then
    log_error "docker-compose.yml not found in: $BACKEND_DIR"
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# Healthcheck & Verification Functions
# ------------------------------------------------------------------------------
verify_backend_health() {
  local container_name="dcitm-backend"
  local max_attempts=24  # 24 * 5s = 120 seconds maximum wait time
  local attempt=1

  log_info "Verifying container health for '$container_name'..."

  while [ $attempt -le $max_attempts ]; do
    local is_running
    is_running=$(docker inspect --format='{{.State.Running}}' "$container_name" 2>/dev/null || echo "false")

    if [ "$is_running" != "true" ]; then
      log_error "Container '$container_name' stopped unexpectedly!"
      docker logs --tail 40 "$container_name" || true
      return 1
    fi

    local health_status
    health_status=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_name" 2>/dev/null || echo "unknown")

    if [ "$health_status" = "healthy" ]; then
      log_success "Backend is HEALTHY! Verified via /api/health endpoint."
      return 0
    elif [ "$health_status" = "unhealthy" ]; then
      log_error "Container reported UNHEALTHY!"
      docker logs --tail 50 "$container_name" || true
      return 1
    fi

    log_info "Backend starting up (health status: '$health_status')... (attempt $attempt/$max_attempts)"
    sleep 5
    attempt=$((attempt + 1))
  done

  log_error "Timed out waiting for '$container_name' to become healthy."
  docker logs --tail 50 "$container_name" || true
  return 1
}

verify_frontend_health() {
  local container_name="dcitm-frontend"
  local max_attempts=12  # 12 * 5s = 60 seconds
  local attempt=1

  log_info "Verifying container health for '$container_name'..."

  while [ $attempt -le $max_attempts ]; do
    local is_running
    is_running=$(docker inspect --format='{{.State.Running}}' "$container_name" 2>/dev/null || echo "false")

    if [ "$is_running" != "true" ]; then
      log_error "Container '$container_name' stopped unexpectedly!"
      docker logs --tail 40 "$container_name" || true
      return 1
    fi

    # Check internal Nginx HTTP response
    if docker exec "$container_name" wget --quiet --spider http://127.0.0.1/ &>/dev/null; then
      log_success "Frontend is HEALTHY! Nginx returned 200 OK."
      return 0
    fi

    log_info "Waiting for Frontend web server to accept requests... (attempt $attempt/$max_attempts)"
    sleep 5
    attempt=$((attempt + 1))
  done

  log_error "Timed out waiting for '$container_name' HTTP response."
  docker logs --tail 50 "$container_name" || true
  return 1
}

# ------------------------------------------------------------------------------
# Git Helpers & Change Detection
# ------------------------------------------------------------------------------
pull_repo() {
  local repo_dir="$1"
  local repo_name="$2"

  cd "$repo_dir"
  log_info "Synchronizing $repo_name on branch '$BRANCH'..."

  # Discard untracked working changes if any (excluding ignored files like .env)
  git fetch origin "$BRANCH"

  local current_branch
  current_branch=$(git rev-parse --abbrev-ref HEAD)
  if [ "$current_branch" != "$BRANCH" ]; then
    log_info "Switching to branch '$BRANCH'..."
    git checkout "$BRANCH"
  fi

  git pull --ff-only origin "$BRANCH"
}

# ------------------------------------------------------------------------------
# Service Deployment Functions
# ------------------------------------------------------------------------------
deploy_backend() {
  log_info "======================================================="
  log_info " Deploying DCITM CRM Backend (NestJS API)"
  log_info "======================================================="

  cd "$BACKEND_DIR"
  local prev_commit
  prev_commit=$(git rev-parse HEAD)
  echo "$prev_commit" > "$STATE_DIR/prev_backend_commit"

  # Pull latest code
  pull_repo "$BACKEND_DIR" "Backend repository"
  local new_commit
  new_commit=$(git rev-parse HEAD)

  log_info "Rebuilding Docker image: backend..."
  docker compose build backend

  log_info "Recreating backend container (isolated, preserving Postgres/Redis)..."
  docker compose up -d --no-deps backend

  if verify_backend_health; then
    echo "$new_commit" > "$BACKEND_STATE_FILE"
    log_success "Backend deployment finished successfully at commit: $new_commit"
  else
    log_error "Backend health check failed! Initiating rollback..."
    rollback_backend "$prev_commit"
    return 1
  fi
}

deploy_frontend() {
  log_info "======================================================="
  log_info " Deploying DCITM CRM Frontend (React / Vite + Nginx)"
  log_info "======================================================="

  if [ ! -d "$FRONTEND_DIR" ]; then
    log_error "Frontend directory does not exist at: $FRONTEND_DIR"
    return 1
  fi

  cd "$FRONTEND_DIR"
  local prev_commit
  prev_commit=$(git rev-parse HEAD)
  echo "$prev_commit" > "$STATE_DIR/prev_frontend_commit"

  # Pull latest frontend code
  pull_repo "$FRONTEND_DIR" "Frontend repository"
  local new_commit
  new_commit=$(git rev-parse HEAD)

  cd "$BACKEND_DIR"
  log_info "Rebuilding Docker image: frontend..."
  docker compose build frontend

  log_info "Recreating frontend container (isolated, preserving other services)..."
  docker compose up -d --no-deps frontend

  if verify_frontend_health; then
    echo "$new_commit" > "$FRONTEND_STATE_FILE"
    log_success "Frontend deployment finished successfully at commit: $new_commit"
  else
    log_error "Frontend verification failed! Initiating rollback..."
    rollback_frontend "$prev_commit"
    return 1
  fi
}

# ------------------------------------------------------------------------------
# Safe Rollback Functions
# ------------------------------------------------------------------------------
rollback_backend() {
  local target_commit="${1:-}"
  if [ -z "$target_commit" ] && [ -f "$STATE_DIR/prev_backend_commit" ]; then
    target_commit=$(cat "$STATE_DIR/prev_backend_commit")
  fi

  if [ -z "$target_commit" ]; then
    log_error "No previous commit recorded for backend rollback."
    return 1
  fi

  log_warn "Rolling back backend to previous commit: $target_commit..."
  cd "$BACKEND_DIR"
  git checkout "$target_commit"
  docker compose build backend
  docker compose up -d --no-deps backend
  verify_backend_health || log_error "Rollback health check failed. Manual intervention required."
}

rollback_frontend() {
  local target_commit="${1:-}"
  if [ -z "$target_commit" ] && [ -f "$STATE_DIR/prev_frontend_commit" ]; then
    target_commit=$(cat "$STATE_DIR/prev_frontend_commit")
  fi

  if [ -z "$target_commit" ]; then
    log_error "No previous commit recorded for frontend rollback."
    return 1
  fi

  log_warn "Rolling back frontend to previous commit: $target_commit..."
  cd "$FRONTEND_DIR"
  git checkout "$target_commit"
  cd "$BACKEND_DIR"
  docker compose build frontend
  docker compose up -d --no-deps frontend
  verify_frontend_health || log_error "Rollback verification failed. Manual intervention required."
}

# ------------------------------------------------------------------------------
# Change Detection (Auto Mode)
# ------------------------------------------------------------------------------
detect_and_deploy() {
  log_info "Running Change Detection across repositories..."

  local deploy_back=false
  local deploy_front=false

  # 1. Check Backend Repository
  cd "$BACKEND_DIR"
  git fetch origin "$BRANCH"
  local current_back_head
  current_back_head=$(git rev-parse HEAD)
  local origin_back_head
  origin_back_head=$(git rev-parse "origin/$BRANCH")

  if [ "$current_back_head" != "$origin_back_head" ]; then
    local changed_files
    changed_files=$(git diff --name-only "$current_back_head" "$origin_back_head")

    log_info "Backend files modified since last deployment:"
    echo "$changed_files" | sed 's/^/  - /'

    # Check for backend code changes
    if echo "$changed_files" | grep -qE '^(src/|prisma/|Dockerfile|docker-entrypoint.sh|package.*\.json|tsconfig.*\.json|nest-cli\.json)'; then
      log_info "Detected production backend code changes."
      deploy_back=true
    fi

    # Check for docker-compose.yml changes
    if echo "$changed_files" | grep -qE '^docker-compose\.ya?ml'; then
      log_info "Detected docker-compose configuration changes. Marking backend for update."
      deploy_back=true
    fi
  else
    log_info "Backend repository is already up-to-date ($current_back_head)."
  fi

  # 2. Check Frontend Repository (if present)
  if [ -d "$FRONTEND_DIR" ]; then
    cd "$FRONTEND_DIR"
    git fetch origin "$BRANCH"
    local current_front_head
    current_front_head=$(git rev-parse HEAD)
    local origin_front_head
    origin_front_head=$(git rev-parse "origin/$BRANCH")

    if [ "$current_front_head" != "$origin_front_head" ]; then
      local front_changed_files
      front_changed_files=$(git diff --name-only "$current_front_head" "$origin_front_head")

      log_info "Frontend files modified since last deployment:"
      echo "$front_changed_files" | sed 's/^/  - /'

      if echo "$front_changed_files" | grep -qE '^(src/|public/|index\.html|Dockerfile|nginx\.conf|package\.json|pnpm-lock\.yaml|vite\.config\.ts|tsconfig.*\.json)'; then
        log_info "Detected production frontend code changes."
        deploy_front=true
      fi
    else
      log_info "Frontend repository is already up-to-date ($current_front_head)."
    fi
  fi

  # 3. Execute selective deployment based on detection
  if [ "$deploy_back" = true ] && [ "$deploy_front" = true ]; then
    log_info "Both backend and frontend changes detected. Deploying both services sequentially..."
    deploy_backend
    deploy_frontend
  elif [ "$deploy_back" = true ]; then
    log_info "Only backend changes detected. Deploying backend only..."
    deploy_backend
  elif [ "$deploy_front" = true ]; then
    log_info "Only frontend changes detected. Deploying frontend only..."
    deploy_frontend
  else
    log_success "No production code changes detected (only documentation, configs, or unchanged trees). Deployment skipped safely."
  fi
}

# ------------------------------------------------------------------------------
# System Status Helper
# ------------------------------------------------------------------------------
show_status() {
  log_info "======================================================="
  log_info " DCITM CRM Stack Status"
  log_info "======================================================="

  cd "$BACKEND_DIR"
  echo -e "\n${C_CYAN}--- Backend Git Status ---${C_RESET}"
  git log -n 1 --pretty=format:"Commit: %h - %s (%ci) [%an]" HEAD
  echo ""

  if [ -d "$FRONTEND_DIR" ]; then
    cd "$FRONTEND_DIR"
    echo -e "\n${C_CYAN}--- Frontend Git Status ---${C_RESET}"
    git log -n 1 --pretty=format:"Commit: %h - %s (%ci) [%an]" HEAD
    echo ""
  fi

  cd "$BACKEND_DIR"
  echo -e "\n${C_CYAN}--- Docker Compose Services ---${C_RESET}"
  docker compose ps

  echo -e "\n${C_CYAN}--- Container Health Details ---${C_RESET}"
  docker ps --filter "name=dcitm-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
}

# ------------------------------------------------------------------------------
# Main Entrypoint
# ------------------------------------------------------------------------------
check_requirements

case "$TARGET" in
  backend)
    deploy_backend
    ;;
  frontend)
    deploy_frontend
    ;;
  all)
    deploy_backend
    deploy_frontend
    ;;
  auto)
    detect_and_deploy
    ;;
  rollback)
    SUBTARGET="${2:-backend}"
    if [ "$SUBTARGET" = "backend" ]; then
      rollback_backend
    elif [ "$SUBTARGET" = "frontend" ]; then
      rollback_frontend
    else
      log_error "Unknown rollback target: '$SUBTARGET'. Use 'backend' or 'frontend'."
      exit 1
    fi
    ;;
  status)
    show_status
    ;;
  *)
    log_error "Unknown target: '$TARGET'"
    echo "Usage: $0 [auto|backend|frontend|all|rollback <service>|status]"
    exit 1
    ;;
esac

log_success "Deployment operation '$TARGET' completed successfully!"
