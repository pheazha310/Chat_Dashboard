#!/usr/bin/env bash
# Shared helpers for the Chat Dashboard deploy scripts. Source it; do not run it.
# Safety rules baked in (the host is shared with LOS): every Docker object is named chatdash-* / chatdash_*; we only ever
# touch our own Compose projects; no `--remove-orphans`, no global prune, no `down -v`.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$REPO_ROOT/.deploy"
mkdir -p "$STATE_DIR"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*" >&2; notify "FAILED ($CHAT_ENV): $*" || true; exit 1; }

# Loads the server-side env file and validates it. $1 = file name in the repo root (.env.dev / .env.staging).
load_env() {
  ENV_FILE="$REPO_ROOT/$1"
  [ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (copy deployment/<env>/env.example, fill it in)" >&2; exit 1; }
  set -a; . "$ENV_FILE"; set +a
  local v
  for v in CHAT_ENV GIT_BRANCH CHAT_PUBLIC_ORIGIN POSTGRES_PASSWORD REDIS_PASSWORD DATABASE_URL REDIS_URL JWT_SECRET \
           CORS_ORIGIN LOS_WEB_ORIGIN; do
    [ -n "${!v:-}" ] || die "$v is empty in $ENV_FILE"
    case "${!v}" in *CHANGE_ME*) die "$v still holds a CHANGE_ME placeholder";; esac
  done
  [ "$CORS_ORIGIN" = "$CHAT_PUBLIC_ORIGIN" ] || die "CORS_ORIGIN must equal CHAT_PUBLIC_ORIGIN (the gateway checks the browser Origin against it)"
  CHAT_WS_ORIGIN="wss://${CHAT_PUBLIC_ORIGIN#https://}"
  export CHAT_ENV ENV_FILE LOS_WEB_ORIGIN CHAT_WS_ORIGIN
}

# Telegram, only when the env file sets both values (LOS posts its deploys the same way). Never blocks a deploy.
notify() {
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || return 0
  curl -fsS -m 10 -o /dev/null "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=chatdash $*" || true
}

require_branch() {
  local b; b="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
  [ "$b" = "$GIT_BRANCH" ] || die "checked out '$b', this environment deploys '$GIT_BRANCH' (Jenkins checks it out first)"
}

require_disk() { # refuses below 10 GB free, the LOS rule (a full disk once killed a live container there)
  local free_kb; free_kb="$(df -Pk / | awk 'NR==2{print $4}')"
  [ "$free_kb" -ge $((10 * 1024 * 1024)) ] || die "less than 10 GB free on / ($((free_kb / 1024 / 1024)) GB)"
}

port_listening() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }

# A host port must be free, unless one of OUR containers of this project already publishes it.
require_port_free() { # $1 = port, $2 = compose project that may legitimately hold it
  port_listening "$1" || return 0
  docker ps --filter "label=com.docker.compose.project=$2" --format '{{.Ports}}' | grep -q "127.0.0.1:$1->" \
    || die "host port $1 is in use by something that is not $2 (LOS?). Pick another in the env file"
}

infra() { docker compose -p "chatdash-$CHAT_ENV-infra" --env-file "$ENV_FILE" -f "$REPO_ROOT/deployment/compose/infra.yml" "$@"; }
app()   { # $1 = project, rest = compose args. Needs IMAGE_TAG, API_PORT, WEB_PORT in the environment.
  local project="$1"; shift
  docker compose -p "$project" --env-file "$ENV_FILE" -f "$REPO_ROOT/deployment/compose/app.yml" "$@"
}

ensure_infra() {
  log "Postgres + Redis up (idempotent; data volumes are never touched)"
  infra up -d --wait
}

build_images() { # $1 = tag. The web image bakes in this environment's URLs.
  local tag="$1" ws="wss://${CHAT_PUBLIC_ORIGIN#https://}/ws"
  log "Building chatdash-api / chatdash-migrate / chatdash-web :$tag"
  docker build -q -f "$REPO_ROOT/backend/Dockerfile" -t "chatdash-api:$tag" "$REPO_ROOT"
  docker build -q -f "$REPO_ROOT/backend/Dockerfile" --target migrate -t "chatdash-migrate:$tag" "$REPO_ROOT"
  docker build -q -f "$REPO_ROOT/frontend/Dockerfile" -t "chatdash-web:$tag" \
    --build-arg "VITE_WS_URL=$ws" --build-arg "VITE_API_URL=$CHAT_PUBLIC_ORIGIN/api/v1/admin" \
    --build-arg "VITE_LOS_WEB_ORIGIN=$LOS_WEB_ORIGIN" "$REPO_ROOT"
}

backup_db() { # STG only: a dump before migrations. Kept: the last 5. Restore is manual (docs/deployment.md).
  local dir="$STATE_DIR/backups"; mkdir -p "$dir"
  local out="$dir/$CHAT_ENV-$(date +%Y%m%d-%H%M%S).dump"
  log "pg_dump -> $out"
  docker exec "$(infra ps -q postgres)" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$out" || { rm -f "$out"; die "pg_dump failed"; }
  ls -1t "$dir"/"$CHAT_ENV"-*.dump | tail -n +6 | xargs -r rm -f
}

run_migrations() { # $1 = tag. `prisma migrate deploy` only: applies committed migrations, never resets or drops.
  log "prisma migrate deploy"
  docker run --rm --network "chatdash_${CHAT_ENV}_net" --env-file "$ENV_FILE" "chatdash-migrate:$1" \
    || die "prisma migrate deploy failed; nothing was switched"
}

wait_healthy() { # $1 = api port, $2 = web port, $3 = seconds. /api/health is 200 only when Postgres AND Redis answer.
  local deadline=$((SECONDS + ${3:-60}))
  while [ $SECONDS -lt $deadline ]; do
    if curl -fsS -m 3 "http://127.0.0.1:$1/api/health" 2>/dev/null | grep -q '"status":"ok"' \
       && curl -fsS -m 3 "http://127.0.0.1:$2/healthz" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

write_upstream() { # $1 = api port, $2 = web port. Atomic replace of the include the host Nginx reads.
  local file="${NGINX_UPSTREAM_FILE:-/etc/nginx/chatdash/$CHAT_ENV-upstream.inc}"
  [ -d "$(dirname "$file")" ] || die "$(dirname "$file") missing: do the one-time Nginx setup (docs/deployment.md)"
  [ -f "$file" ] && cp "$file" "$STATE_DIR/upstream.prev"
  printf 'upstream chatdash_%s_api { server 127.0.0.1:%s; keepalive 16; }\nupstream chatdash_%s_web { server 127.0.0.1:%s; }\n' \
    "$CHAT_ENV" "$1" "$CHAT_ENV" "$2" > "$file.new" && mv "$file.new" "$file"
}

nginx_reload() { # `nginx -t` first; a bad config is rolled back and nothing is reloaded.
  ${NGINX_TEST_CMD:-sudo nginx -t} && ${NGINX_RELOAD_CMD:-sudo nginx -s reload}
}

# Keeps the newest N image tags of OUR three repositories for this environment. Never a global `docker image prune`.
prune_images() { # $1 = keep (default 3)
  local keep="${1:-3}" repo
  for repo in chatdash-api chatdash-web chatdash-migrate; do
    docker images "$repo" --format '{{.Tag}}' | grep "^$CHAT_ENV-" | tail -n +$((keep + 1)) \
      | xargs -r -I{} docker rmi "$repo:{}" 2>/dev/null || true
  done
}

# --- Blue-green (STG) ---------------------------------------------------------------------------------------------
upper() { printf %s "$1" | tr 'a-z' 'A-Z'; }
read_state() { cat "$STATE_DIR/$1" 2>/dev/null || true; }

# Starts image tag $1 in the idle slot, proves it healthy, flips Nginx, drains and removes the old slot. Any failure
# before the flip removes the new slot and leaves the live one serving. Used by deploy (new build) and rollback (old tag).
bluegreen_cutover() {
  local tag="$1" active new old up
  active="$(read_state active_slot)"; [ "$active" = blue ] && new=green || new=blue
  [ "$new" = blue ] && old=green || old=blue
  up="$(upper "$new")"; local api_var="API_PORT_$up" web_var="WEB_PORT_$up"
  export IMAGE_TAG="$tag" API_PORT="${!api_var}" WEB_PORT="${!web_var}"
  local project="chatdash-$CHAT_ENV-$new" old_project="chatdash-$CHAT_ENV-$old"

  log "Live slot: ${active:-none}. Starting $tag in the idle slot '$new' (api :$API_PORT, web :$WEB_PORT)"
  app "$project" down 2>/dev/null || true   # leftovers of an earlier failed attempt: our own project only
  require_port_free "$API_PORT" "$project"; require_port_free "$WEB_PORT" "$project"
  app "$project" up -d

  if ! wait_healthy "$API_PORT" "$WEB_PORT" "${HEALTH_TIMEOUT_SECONDS:-60}"; then
    app "$project" logs --tail 60 api || true
    app "$project" down
    die "new slot '$new' never became healthy; the live slot '${active:-none}' was not touched"
  fi

  log "Healthy. Flipping Nginx to '$new'"
  write_upstream "$API_PORT" "$WEB_PORT"
  if ! nginx_reload; then
    [ -f "$STATE_DIR/upstream.prev" ] && cp "$STATE_DIR/upstream.prev" "${NGINX_UPSTREAM_FILE:-/etc/nginx/chatdash/$CHAT_ENV-upstream.inc}"
    app "$project" down
    die "nginx -t/reload failed; upstream restored, live slot untouched"
  fi

  if [ -n "$active" ] && [ "${SMOKE_AFTER_FLIP:-1}" = 1 ]; then
    if ! "$REPO_ROOT/deployment/scripts/smoke-test.sh" "$CHAT_PUBLIC_ORIGIN"; then
      log "Smoke test through Nginx failed: flipping back to '$old'"
      local ob="API_PORT_$(upper "$old")" ow="WEB_PORT_$(upper "$old")"
      write_upstream "${!ob}" "${!ow}" && nginx_reload
      app "$project" down
      die "smoke test failed after the flip; traffic is back on '$old'"
    fi
  fi

  if [ -n "$active" ]; then
    log "Draining '$old' (up to ${DRAIN_SECONDS:-60}s; browsers and the mobile app reconnect to the new slot and rejoin their rooms)"
    local deadline=$((SECONDS + ${DRAIN_SECONDS:-60})) old_api="API_PORT_$(upper "$old")" old_web="WEB_PORT_$(upper "$old")"
    while [ $SECONDS -lt $deadline ] && ss -tnH state established "sport = :${!old_api}" | grep -q .; do sleep 2; done
    export IMAGE_TAG="$(read_state current_tag)" API_PORT="${!old_api}" WEB_PORT="${!old_web}"
    app "$old_project" down
  fi

  read_state current_tag > "$STATE_DIR/previous_tag"
  echo "$tag" > "$STATE_DIR/current_tag"; echo "$new" > "$STATE_DIR/active_slot"
  log "Live: slot '$new', tag $tag"
}
