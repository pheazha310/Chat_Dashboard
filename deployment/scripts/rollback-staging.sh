#!/usr/bin/env bash
# STG: blue-green cutover back to the previous image (or $1). Restores code, not data or applied migrations.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
load_env .env.staging
require_disk
tag="${1:-$(read_state previous_tag)}"
[ -n "$tag" ] || die "no previous tag recorded; pass one: rollback-staging.sh stg-<sha>"
docker image inspect "chatdash-api:$tag" "chatdash-web:$tag" >/dev/null 2>&1 || die "images for $tag are gone from this host"
ensure_infra
bluegreen_cutover "$tag"
notify "STG rolled back to $tag"
