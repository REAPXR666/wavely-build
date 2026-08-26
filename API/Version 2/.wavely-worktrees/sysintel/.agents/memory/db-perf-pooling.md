---
name: DB pooling & request concurrency
description: Why this Flask app uses a connection pool, a banned-IP TTL cache, and a single gthread worker for fast page loads.
---

# Page-load performance model

The app felt slow not because the server is slow in isolation (a warm query is ~0.5ms, a home render ~13ms) but because of three compounding issues, all now fixed. Keep these decisions consistent.

## 1. Connection pooling (biggest win)
A fresh `psycopg2.connect` costs ~11ms (TCP+TLS+auth); a query on a warm connection is ~0.5ms. The old code opened a new connection per `load_json`/`save_json` AND the `with conn:` block never closed it (transaction-only context manager → leak).

`_get_db_conn()` is now a `@contextmanager` over a module-level `ThreadedConnectionPool(1, 20)`: getconn → yield → commit (rollback on exception) → putconn in `finally`. All callers use `with _get_db_conn() as conn:` so they were compatible without edits. `_ensure_table`/`save_json` still call `conn.commit()` internally — redundant with the contextmanager's commit but harmless.

**Why pool max=20:** must exceed thread count (8) with headroom. If you ever raise `--threads` or add workers, raise maxconn in lockstep and watch Postgres' connection ceiling (pool count = workers × maxconn).

## 2. before_request must not hit the DB per request
`enforce_banned_ips` used to call `load_auth()` (a DB read) on EVERY request, including every `/static/` asset. Now it (a) returns early for `/static/` paths and (b) reads banned IPs from `get_banned_ips()`, a 30s in-memory TTL cache.

**Eventual consistency caveat:** ban/unban now lag up to the TTL. The admin ban/unban endpoints call `invalidate_banned_ips_cache()` (sets `expires_at=0`) so admin actions apply immediately. Any new code path that mutates `banned_ips` MUST call the invalidator too.

## 3. Concurrency = threads, not workers
gunicorn runs `--workers=1 --threads=8 --worker-class=gthread` (both the dev workflow and prod `deployConfig`). The frontend fires ~85 fetch()/polling calls and external calls (Splice ~10s, Metered ~6s) can block a request; a single SYNC worker serialized all of it.

**Why 1 worker, not many:** `api_keys_cache` and `samples_metadata_cache` are in-memory per-process. Multiple workers would each hold a divergent cache, so an API key created in one worker returns 401 in another. Threads share memory, so one worker keeps caches coherent. **If you ever add workers, you must first add a DB fallback in `require_api_key` on cache miss** (re-scan `load_auth()` users' api_keys) before trusting the in-memory cache.

**Thread-safety under gthread:** `rebuild_key_cache()` builds a new dict and swaps `api_keys_cache` atomically — never `clear()`-then-refill, which would expose a window of false 401s for valid keys under concurrency.

## 4. Auth throughput under concurrent floods (login/signup)
Password hashing is the dominant per-request CPU cost. werkzeug's default `scrypt:32768:8:1` verifies in ~86ms. Under a concurrent login/signup flood, every gthread thread gets occupied hashing, so cheap requests (home/static/polling) starve waiting for a thread slot → the WHOLE site times out, not just auth. This is the classic "CPU-bound work saturates a shared thread pool" failure.

Levers, in order of leverage:
- **More thread slots for cheap requests:** raised `--threads` 8→24. Cheap requests are I/O-bound and finish in ms, so extra threads let them coexist with the few CPU-bound hash threads. scrypt **releases the GIL** (measured ~1.84x on 8 hashes / 4 cores), so threads also parallelize hashing up to core count.
- **Cheaper hash:** `HASH_METHOD = "scrypt:16384:8:1"` (constant, used by signup/change-password/admin-seed). OWASP minimum, still memory-hard, ~2x faster (~40ms). Upgrade-on-login re-hashes old hashes to this on next successful login.
- **Hold the DB connection briefly:** `load_user(username)` fetches one user via `data->'users'->%s` JSONB path (~1ms) and frees the pooled conn BEFORE the CPU hash, instead of parsing the whole auth blob and holding state across the hash.

**Real capacity ceiling = cores / hash_cost.** Password hashing is intentionally CPU-bound; a single small autoscale instance can't absorb an unbounded concurrent flood no matter the code. The user-controlled lever is deployment vCPU / autoscale max-machines in the Publishing UI. Code changes here ~2x throughput + stop cross-request starvation, but extreme synthetic floods still need more compute.

## 5. Concurrent signups were a lost-update race
Signup did `load_auth()` → mutate dict → `save_auth()` (whole-blob rewrite). Two concurrent signups both read, both add their user, both write → last write wins, first user lost. Fixed with `db_create_user()`: a single atomic `UPDATE ... SET data = jsonb_set(...) WHERE key='auth' AND NOT COALESCE(data->'users' ? %s, false)`; `rowcount==1` = created, else username taken. The `?` is the Postgres JSONB has-key operator (not a psycopg2 placeholder) — fine alongside `%s` params.

**Still outstanding (not done, out of scope):** other auth-mutating endpoints (change-password, key mgmt, friends/admin) still use whole-blob `save_auth()` and can clobber concurrent auth writes. Convert to targeted jsonb_set updates if lost-update bugs appear there. Also: pool max is per-process; total DB conns = instances × workers × maxconn — keep under Postgres `max_connections` if autoscale fans out.

## 6. "5-minute browser load" was stale production, not a code regression
When a slow-load complaint comes in, FIRST confirm which code prod is running before chasing front-end ghosts. Tell: unauth `GET /api/dashboard/analytics` returns **401** on current code but **302** on the old code — a quick canary for "did they republish?". The current code loads fast everywhere (home ~4ms, static <0.5s, CDNs <0.15s, renders clean in a headless browser); minutes-long loads were the OLD 8-thread prod saturating under their concurrent-login load test. **Fix = republish.** Front-end deploys do NOT auto-publish.

Real front-end bugs fixed alongside (affect every page): `/static/placeholder-art.png` (used ~17x: avatars/player art) and `/static/icon.png` (notification icon) were missing → 404 churn on every load; generated branded PNGs + added a favicon `<link>`. chart.js was render-blocking in `<head>` site-wide though only the dashboard uses it → added `defer`. Nav tabs (`switchTab`) do full `window.location` page reloads, so added an `@app.after_request` `Cache-Control: public, max-age=600` for `/static/` to stop re-fetching app.js(200KB)+style.css(86KB) every navigation.

**Cache carve-out (security):** `/static/cache/decrypted/*` holds decrypted licensed Splice media — it gets `Cache-Control: private, no-store`, NOT public. Any new web-served path holding access-controlled/licensed bytes must be excluded from the public static cache the same way.

## 7. Dashboard "auto-reload loop" = API auth decorator redirecting instead of 401
There are TWO login decorators: `require_login` (returns 401 JSON for `/api/*`) and `require_session_login` (originally redirected EVERYTHING, including `/api/*`, to `/login`). The dashboard's `checkAuthSession()` fetches `/api/dashboard/analytics`; when that returned a 302 to the login HTML, `fetch` followed it and the client misread auth state. Combined with `/login` server-redirecting to `/dashboard` when a session exists, the page ping-ponged `/dashboard <-> /login` forever (looks like constant auto-reloading).
**Rule:** any decorator guarding `/api/*` must return a 401 JSON for unauthenticated requests, never a 302 to an HTML page — otherwise `fetch()` follows the redirect and clients can't tell logged-out from logged-in. Page routes should still 302 to `/login`. Branch on `request.path.startswith('/api/')`.
**Client rule:** an auth-check that redirects to `/login` on *any* failed fetch will loop against a server that bounces `/login -> /dashboard`. Only redirect on an explicit 401; treat 5xx/parse/network errors as "auth unknown" (no redirect, don't flip header to signed-out).

## 8. Dashboard spamming thousands of /api/community/poll = mutual recursion via duplicate switchDashTab
static/app.js has TWO `function switchDashTab` declarations; the LATER one (an "override" that adds 'api'/'notifications' handling) shadows the earlier via hoisting — that override is what actually runs. The bug: `loadDashboard()` called `switchDashTab('api')`, and the override's 'api' branch called `loadDashboard()` back → infinite synchronous recursion. Because `loadDashboard` → `startCommunityPolling()` fires an immediate `pollCommunity()` (a `/api/community/poll` fetch) every call, each recursion level emitted a poll request → thousands of /poll hits until the stack overflowed.
**Fix pattern:** split the data-load (analytics fetch/render → `loadApiDashboardData()`) from one-time init (`loadDashboard`); the tab router calls the data-load, never the init. **Rule:** a tab-router (`switchDashTab`) and a page-initializer (`loadDashboard`) must never call each other — the router loads tab DATA, the initializer sets up the page once and may call the router, but the router must not call back into the initializer. Watch for duplicate function declarations shadowing earlier ones — search `function NAME` for ALL defs before reasoning about behavior.
