#!/usr/bin/env bash
# STG (branch staging): blue-green. Jenkins checks out `staging` in /home/ubuntu/chatdash-staging and runs this.
# Order: build -> dump DB -> migrate -> start idle slot -> health gate -> flip Nginx -> smoke -> drain old slot.
# Migrations run while the OLD code still serves, so they must be expand-only (docs/deployment.md).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
load_env .env.staging
require_branch; require_disk

tag="stg-$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
[ "$tag" != "$(read_state current_tag)" ] || log "$tag is already live; redeploying it into the idle slot"

ensure_infra
build_images "$tag"
backup_db
run_migrations "$tag"
bluegreen_cutover "$tag"
prune_images 3
notify "STG deployed $tag (slot $(read_state active_slot))"
