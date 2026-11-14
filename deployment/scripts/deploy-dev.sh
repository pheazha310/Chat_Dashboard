#!/usr/bin/env bash
# DEV (branch nak): single container set, no slots, like LOS Dev. Jenkins checks out `nak` in the deploy directory
# (/home/ubuntu/chatdash-dev) and runs this. Safe to re-run. Never touches LOS or any other Compose project.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
load_env .env.dev
require_branch; require_disk

tag="dev-$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
prev="$(read_state current_tag)"
export API_PORT WEB_PORT   # from the env file
require_port_free "$API_PORT" chatdash-dev; require_port_free "$WEB_PORT" chatdash-dev

ensure_infra
build_images "$tag"
run_migrations "$tag"

export IMAGE_TAG="$tag"
log "Starting $tag"
app chatdash-dev up -d
if ! wait_healthy "$API_PORT" "$WEB_PORT" "${HEALTH_TIMEOUT_SECONDS:-60}"; then
  app chatdash-dev logs --tail 60 api || true
  if [ -n "$prev" ] && docker image inspect "chatdash-api:$prev" >/dev/null 2>&1; then
    log "Unhealthy: restoring $prev (migrations already applied are NOT undone)"
    IMAGE_TAG="$prev" app chatdash-dev up -d
  fi
  die "$tag is unhealthy"
fi

echo "$prev" > "$STATE_DIR/previous_tag"; echo "$tag" > "$STATE_DIR/current_tag"
prune_images 3
log "DEV is running $tag"; notify "DEV deployed $tag"
