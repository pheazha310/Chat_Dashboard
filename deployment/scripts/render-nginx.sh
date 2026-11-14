#!/usr/bin/env bash
# Renders deployment/nginx/chatdash.conf.template for review. It writes to a local file and installs NOTHING:
# a person copies it into the host Nginx after reading it (the same server carries LOS).
#   CHAT_ENV=dev CHAT_SERVER_NAME=<host> SSL_CERT=<path> SSL_KEY=<path> ./render-nginx.sh > chatdash-dev.conf
set -euo pipefail
: "${CHAT_ENV:?dev|stg}" "${CHAT_SERVER_NAME:?}" "${SSL_CERT:?}" "${SSL_KEY:?}"
export UPSTREAM_INC="${UPSTREAM_INC:-/etc/nginx/chatdash/$CHAT_ENV-upstream.inc}"
envsubst '${CHAT_ENV} ${CHAT_SERVER_NAME} ${SSL_CERT} ${SSL_KEY} ${UPSTREAM_INC}' \
  < "$(dirname "$0")/../nginx/chatdash.conf.template"
