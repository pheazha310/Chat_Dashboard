#!/usr/bin/env bash
# DEV: run the previous image again (or the tag given as $1). Restores code, not data or applied migrations.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
load_env .env.dev
tag="${1:-$(read_state previous_tag)}"
[ -n "$tag" ] || die "no previous tag recorded; pass one: rollback-dev.sh dev-<sha>"
docker image inspect "chatdash-api:$tag" "chatdash-web:$tag" >/dev/null 2>&1 || die "images for $tag are gone from this host"
export IMAGE_TAG="$tag" API_PORT WEB_PORT
app chatdash-dev up -d
wait_healthy "$API_PORT" "$WEB_PORT" 60 || die "$tag did not become healthy"
read_state current_tag > "$STATE_DIR/previous_tag"; echo "$tag" > "$STATE_DIR/current_tag"
log "DEV is running $tag"; notify "DEV rolled back to $tag"
