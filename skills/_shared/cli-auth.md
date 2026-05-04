# Shared: CLI Authentication Flow (VEK-383)

**Reference doc** — not an invokable skill. Read this file when a customer-facing skill needs to authenticate the customer against vektis-app. Consumed by `vektis-install` (VEK-349); will be consumed by `vektis-instrument` (VEK-378), `vektis-update` (VEK-379), and `vektis-bootstrap` (VEK-380).

This is the operational contract for the OAuth Device Flow (RFC 8628) plus paste-token fallback shipped in VEK-383. Both paths produce a `vkcli_*` bearer token stored in `~/.vektis/credentials.json`.

---

## Resolve `VEKTIS_API_URL`

Default: `https://app.vektis.io`. Customer can override via `VEKTIS_API_URL` env var for local dev (per VEK-345 pattern). Always read this once and reuse:

```bash
VEKTIS_API_URL="${VEKTIS_API_URL:-https://app.vektis.io}"
```

---

## Step A: Check for an existing credential

Read `~/.vektis/credentials.json`. Schema:

```json
{
  "token": "vkcli_<64-hex-chars>",
  "organizationId": "<uuid>",
  "expiresAt": "<ISO8601>"
}
```

Note: `userId` is intentionally NOT in the schema. `GET /api/auth/cli/me` returns `{email, role, organizationId, organizationName}` — no `userId` field. Re-fetch user identity via `/me` on demand rather than caching it.

If the file exists AND `expiresAt` is in the future, jump to **Step E (verify role + surface org context)**. The token may still be revoked server-side; only Step E confirms it works.

If the file does not exist OR `expiresAt` is in the past OR Step E later returns 401, proceed to **Step B**.

---

## Step B: Choose authentication mode

- **Default**: OAuth Device Flow (Step C).
- **Fallback**: when the customer invokes the skill with `--paste-token`, OR after 60 seconds of unsuccessful OAuth polling (Step C explains).

---

## Step C: OAuth Device Flow

### C.1 — Initiate

```bash
curl -s -X POST "$VEKTIS_API_URL/api/auth/cli/initiate" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response:

```json
{
  "device_code": "<opaque-32+-byte-string>",
  "user_code": "ABCD2345",
  "verification_uri": "https://app.vektis.io/cli-auth?code=ABCD2345",
  "expires_in": 600,
  "interval": 5
}
```

Capture `device_code`, `user_code`, `verification_uri`, and `interval` for later steps.

### C.2 — Surface URL and auto-open browser

Print both the URL and the user_code so the customer can verify them across browser and terminal:

```
Open this URL in your browser to authorize:
  <verification_uri>

If the codes match, click Authorize:
  Code: <user_code>
```

Auto-open via platform-appropriate command:

```bash
case "$(uname -s)" in
  Darwin)  open "$verification_uri" 2>/dev/null ;;
  Linux)   xdg-open "$verification_uri" 2>/dev/null ;;
  CYGWIN*|MINGW*|MSYS*) start "$verification_uri" 2>/dev/null ;;
esac
```

The auto-open is best-effort. Do NOT throw on non-zero exit — the URL is already printed for manual copy.

### C.3 — Poll until authorized

Loop calling `POST /api/auth/cli/poll` every `interval` seconds. RFC 8628 status codes from VEK-383:

- **200** — `{ access_token, token_type: "bearer", expires_in }`. Done.
- **428** — `{ error: "authorization_pending" }`. Customer hasn't clicked Authorize yet. Continue polling.
- **410** — `{ error: "expired_token" }`. The 10-minute device_code TTL elapsed. Restart from Step C.1 OR offer Step D fallback.
- **404** — `{ error: "access_denied" }`. The device_code was consumed by another concurrent poll, deleted, or never existed. Restart from Step C.1.

```bash
elapsed=0
while [ "$elapsed" -lt 600 ]; do
  response=$(curl -s -w "\n%{http_code}" -X POST "$VEKTIS_API_URL/api/auth/cli/poll" \
    -H "Content-Type: application/json" \
    -d "{\"device_code\":\"$device_code\"}")
  status=$(echo "$response" | tail -n 1)
  body=$(echo "$response" | sed '$d')

  if [ "$status" = "200" ]; then
    access_token=$(echo "$body" | jq -r '.access_token')
    expires_in=$(echo "$body" | jq -r '.expires_in')
    break
  elif [ "$status" = "410" ]; then
    echo "Device code expired. Restarting..."
    # Restart at Step C.1 OR ask user to switch to --paste-token
    break
  elif [ "$status" = "404" ]; then
    echo "Authorization denied. Restarting..."
    break
  fi

  # 60-second fallback prompt
  if [ "$elapsed" -ge 60 ] && [ "$elapsed" -lt $((60 + interval)) ]; then
    echo "Browser didn't open or you can switch to paste-token mode."
    echo "Press Y to switch, anything else to keep polling (30s timeout): "
    # -t 30 prevents an indefinite hang in headless / no-tty contexts
    read -t 30 -r choice || choice=""
    if [ "$choice" = "Y" ] || [ "$choice" = "y" ]; then
      break  # Skill switches to Step D
    fi
  fi

  sleep "$interval"
  elapsed=$((elapsed + interval))
done
```

On success, jump to **Step E** with `access_token` (the `vkcli_*` bearer).

---

## Step D: Paste-Token Fallback

Triggered by `--paste-token` flag OR by the customer pressing Y at the 60s polling prompt.

```
Paste your CLI token from app.vektis.io/settings/api-usage (Personal CLI Tokens section):
```

Read input from the customer. Validate strict format:

```bash
if ! echo "$pasted_token" | grep -qE '^vkcli_[a-f0-9]{64}$'; then
  echo "Invalid token format. Expected: vkcli_ followed by 64 hex characters."
  exit 1
fi
access_token="$pasted_token"
```

The customer must have already created the token at `${VEKTIS_API_URL}/settings/api-usage` (the "Personal CLI Tokens" section, Admin-only, shipped in VEK-383). If the customer is not an admin, Step E will surface the role error.

---

## Step E: Verify role + surface org context

```bash
me_response=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $access_token" \
  "$VEKTIS_API_URL/api/auth/cli/me")
me_status=$(echo "$me_response" | tail -n 1)
me_body=$(echo "$me_response" | sed '$d')

if [ "$me_status" = "401" ]; then
  echo "Token expired or revoked. Re-authenticating..."
  rm -f ~/.vektis/credentials.json
  # Restart: skill loops back to Step A. In Claude-driven invocation,
  # exit non-zero so the orchestrator can retry the skill cleanly.
  exit 1
fi

email=$(echo "$me_body" | jq -r '.email')
role=$(echo "$me_body" | jq -r '.role')
org_id=$(echo "$me_body" | jq -r '.organizationId')
org_name=$(echo "$me_body" | jq -r '.organizationName')

if [ "$role" != "admin" ]; then
  echo "Ask your admin to run this skill — only admins can create SDK API keys."
  echo "Authenticated as: $email (role: $role)"
  exit 1
fi

echo "Authenticated as $email in $org_name org."
```

This step is **mandatory before any mutating call** (e.g., `POST /api/admin/api-keys`). It surfaces the org name for tenant confirmation and prevents 403 mid-flow.

---

## Step F: Persist credentials

Compute `expiresAt` from `$expires_in` (captured in Step C.3 from the poll 200 response). For the paste-token path (Step D), default to 30 days (`expires_in=2592000`) since that matches `CLI_TOKEN_TTL_MS` in VEK-383.

The `date` syntax differs between BSD (macOS) and GNU (Linux); the snippet below tries GNU first, then falls back to BSD:

```bash
expires_in=${expires_in:-2592000}
expiresAt=$(date -u -d "+${expires_in} seconds" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
  || date -u -v "+${expires_in}S" +"%Y-%m-%dT%H:%M:%SZ")

mkdir -p ~/.vektis
cat > ~/.vektis/credentials.json <<EOF
{
  "token": "$access_token",
  "organizationId": "$org_id",
  "expiresAt": "$expiresAt"
}
EOF
chmod 600 ~/.vektis/credentials.json 2>/dev/null || true
```

Windows note: `chmod 600` is best-effort; on Windows the file inherits ACLs from `~/.vektis/`. Print a one-line warning if `chmod` fails on Windows.

---

## Re-authentication semantics

- A 401 from any vektis-app endpoint AFTER initial auth means the token was revoked or expired. Delete `~/.vektis/credentials.json` and restart from Step A.
- The skill should NOT loop indefinitely on 401 — one re-auth attempt, then surface the error.

---

## Reference (vektis-app source-of-truth)

- `src/proxy.ts:43-51` — public CLI auth routes (no Clerk session required for `/initiate` and `/poll`)
- `src/backend/auth/dto/device-flow.dto.ts` — device-flow DTO contract
- `src/backend/auth/dto/cli-token.dto.ts:24-44` — CLI token DTO; `~/.vektis/credentials.json` schema
- `src/app/api/auth/cli/me/route.ts` — `GET /api/auth/cli/me` returns `{ email, role, organizationId, organizationName }`
