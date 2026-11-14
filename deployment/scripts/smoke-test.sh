#!/usr/bin/env bash
# Checks a deployed environment from the outside. $1 = base URL (default $CHAT_PUBLIC_ORIGIN). Prints PASS/FAIL per
# check and exits non-zero on any failure. It proves only what it checks: it does NOT cover LOS sign-in, the iframe
# hand-off or the mobile app (they need LOS credentials; see the manual checklist in docs/deployment.md).
set -u   # no pipefail: curl on an upgraded WebSocket exits non-zero at its timeout
# CHAT_ORIGIN overrides the Origin header of the WebSocket check (only when the URL differs from the public origin).
base="${1:-${CHAT_PUBLIC_ORIGIN:?pass a base URL}}"; base="${base%/}"
fail=0; CURL_OPTS="${CURL_OPTS:-}"   # e.g. -k for a self-signed test certificate
check() { if eval "$2" >/dev/null 2>&1; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }

check "web loads (/ is HTML)"                  "curl $CURL_OPTS -fsS -m 10 '$base/' | grep -qi '<div id=\"root\"'"
check "API health: Postgres and Redis up"      "curl $CURL_OPTS -fsS -m 10 '$base/api/health' | grep -q '\"status\":\"ok\"'"
check "staff API refuses anonymous requests"   "[ \"\$(curl $CURL_OPTS -s -o /dev/null -w '%{http_code}' -m 10 '$base/api/v1/admin/conversations')\" = 401 ]"
check "dev sign-in route is not mounted"       "[ \"\$(curl $CURL_OPTS -s -o /dev/null -w '%{http_code}' -m 10 '$base/api/v1/dev/auth/login' -X POST)\" = 404 ]"
check "WebSocket upgrade answers 101"          "curl $CURL_OPTS --http1.1 -sS -m 5 -i -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Origin: ${CHAT_ORIGIN:-$base}' '$base/ws' | head -1 | grep -q 101"
check "iframe: frame-ancestors header set"     "curl $CURL_OPTS -sSI -m 10 '$base/' | grep -i '^content-security-policy:' | grep -qi 'frame-ancestors'"
check "no X-Frame-Options on the web"          "! curl $CURL_OPTS -sSI -m 10 '$base/' | grep -qi '^x-frame-options'"
exit $fail
