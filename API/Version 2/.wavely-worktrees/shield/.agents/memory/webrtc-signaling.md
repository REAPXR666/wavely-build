---
name: WebRTC call signaling constraints
description: Non-obvious timing/ordering rules for the poll-based trickle-ICE call flow
---

# Caller must buffer outgoing ICE candidates until call_id exists
The caller's ICE gathering starts at `setLocalDescription(offer)`, which runs
BEFORE the async `/api/webrtc/call/initiate` response returns with the call_id.
Host candidates fire almost instantly. If `onicecandidate` only sends when
`currentCallId` is set, those fast host candidates are dropped and the peer never
gets them → ICE fails ("Connecting…" then "Connection Failed"), especially on
same-machine/LAN where host candidates are what would have connected.

**How to apply:** Buffer local candidates while `currentCallId` is null, then flush
them right after `currentCallId` is assigned. The receiver is unaffected because
its `currentCallId` is set (from incoming_call detection) before its PC is created.

# Signaling model
Trickle ICE over polling. Backend stores append-only `caller_candidates` /
`receiver_candidates` + `sdp_offer`/`sdp_answer` in `active_calls`. Frontend
dedups by index (`slice(alreadyProcessed)`): caller reads receiver_candidates,
receiver reads caller_candidates. Remote candidates are queued until
`remoteDescription` is set, then flushed. Calls expire server-side after ~15s
without a poll/heartbeat (`last_seen`).

# Free reliable TURN: Metered.ca dynamic credentials
Public free TURN (OpenRelay) is unreliable. The reliable free option is Metered.ca
(free tier ~50GB/mo, no card). Fetch SHORT-LIVED credentials server-side so the API
key never reaches the browser:
`GET https://<APP_NAME>.metered.live/api/v1/turn/credentials?apiKey=<KEY>` returns a
ready-to-use iceServers array (STUN + several TURN incl. a `turns:443` TLS entry that
clears strict firewalls). Cache server-side (creds are time-limited; ~6h cache is safe).
Backend reads env `METERED_API_KEY` + `METERED_APP_NAME` (helper accepts bare subdomain
or full host). Frontend re-pulls ice-config right before each call so long-open tabs
get fresh creds. Fallback chain: Metered -> static TURN_URL/USERNAME/CREDENTIAL -> OpenRelay.

**Metered has TWO keys** — use the **API Key** (hex, ~36 chars) as `apiKey`, NOT the
"Secret Key" (that returns 401 on this endpoint).

**Why (security):** `requests` exceptions/tracebacks often embed the full request URL.
If the apiKey is in the query string, a logged exception leaks the key. Pass it via
`params={"apiKey": key}` and NEVER log the exception text or URL on failure — log status
code only.
