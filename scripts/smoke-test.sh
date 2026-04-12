#!/usr/bin/env bash
# smoke-test.sh — verify WikiOS responds on its real endpoints
set -euo pipefail

BASE="${WIKIOS_BASE_URL:-http://localhost:5211}"
PASS=0
FAIL=0
ERRORS=""

check_json() {
  local name="$1" url="$2" python_assert="$3"
  local body_file http_code

  body_file="$(mktemp)"
  http_code=$(curl -s -o "$body_file" -w '%{http_code}' --max-time 10 "$url" 2>/dev/null) || {
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  ✗ ${name}: connection failed"
    rm -f "$body_file"
    return
  }

  if [[ "$http_code" != "200" ]]; then
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  ✗ ${name}: HTTP ${http_code}"
    rm -f "$body_file"
    return
  fi

  if ! python3 -m json.tool "$body_file" >/dev/null 2>&1; then
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  ✗ ${name}: invalid JSON"
    rm -f "$body_file"
    return
  fi

  if ! python3 - "$body_file" "$python_assert" <<'PY'
import json, sys
path = sys.argv[1]
expr = sys.argv[2]
d = json.load(open(path))
assert eval(expr), expr
PY
  then
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  ✗ ${name}: structure check failed (${python_assert})"
    rm -f "$body_file"
    return
  fi

  PASS=$((PASS + 1))
  echo "  ✓ ${name}"
  rm -f "$body_file"
}

check_html() {
  local name="$1" url="$2" needle="$3"
  local body_file http_code

  body_file="$(mktemp)"
  http_code=$(curl -s -o "$body_file" -w '%{http_code}' --max-time 10 "$url" 2>/dev/null) || {
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  ✗ ${name}: connection failed"
    rm -f "$body_file"
    return
  }

  if [[ "$http_code" != "200" ]]; then
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  ✗ ${name}: HTTP ${http_code}"
    rm -f "$body_file"
    return
  fi

  if ! grep -q "$needle" "$body_file"; then
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  ✗ ${name}: missing '${needle}'"
    rm -f "$body_file"
    return
  fi

  PASS=$((PASS + 1))
  echo "  ✓ ${name}"
  rm -f "$body_file"
}

echo "WikiOS smoke tests (${BASE})"
echo "─────────────────────────────────────"

check_html "homepage shell" "${BASE}/" "WikiOS"
check_json "health" "${BASE}/api/health" "d.get('ok') is True and isinstance(d.get('totalPages'), int)"
check_json "version" "${BASE}/api/version" "isinstance(d.get('commit'), str) and isinstance(d.get('commitShort'), str)"
check_json "home data" "${BASE}/api/home" "isinstance(d.get('totalPages'), int) and isinstance(d.get('featured'), dict)"
check_json "stats" "${BASE}/api/stats" "isinstance(d.get('total_pages'), int) and isinstance(d.get('top_backlinks'), list)"
check_json "search" "${BASE}/api/search?q=wiki" "isinstance(d.get('results'), list)"

featured_slug=$(python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get("featured", {}).get("slug", ""))
except Exception:
    print("")
' < <(curl -s --max-time 10 "${BASE}/api/home"))

if [[ -n "$featured_slug" ]]; then
  check_json "featured article" "${BASE}/api/wiki/${featured_slug}" "isinstance(d.get('title'), str) and isinstance(d.get('contentMarkdown'), str)"
else
  FAIL=$((FAIL + 1))
  ERRORS="${ERRORS}\n  ✗ featured article: no featured slug from /api/home"
fi

echo "─────────────────────────────────────"
echo "  ${PASS} passed, ${FAIL} failed"

if [[ $FAIL -gt 0 ]]; then
  echo -e "\nFailures:${ERRORS}"
  exit 1
fi

echo "  All checks passed ✓"
