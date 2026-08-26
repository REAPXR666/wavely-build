---
name: session secret key stability
description: How the Flask session-signing key is resolved and why it must be stable across instances/restarts
---

# Session secret key (login stability)

The Flask session-signing key (`app.secret_key`) MUST be identical across every
restart and every deployed instance. If it differs, session cookies are rejected
and users appear silently logged out / "unable to log back in" — even though the
account is fine in the DB.

**Resolution order (in app.py):**
1. `SESSION_SECRET` secret (global Replit secret → present in BOTH dev and prod).
   This is the active key in normal operation.
2. Fallback only if `SESSION_SECRET` is unset: `_get_or_create_secret_key()`
   persists one random key in the shared DB (`app_data` key `secret_key`) via
   `INSERT ... ON CONFLICT DO NOTHING` then `SELECT`, with bounded retry and
   **fail-closed** (raises) — never a per-process ephemeral key.

**Why:** the old code read the key from a `.secret_key` FILE that was committed to
git. A committed key is a session-forgery risk (anyone with repo access could
forge any user's session, incl admin) and is fragile if regenerated per-instance.
That file was deleted and added to `.gitignore`. The old committed key is inert
now because `SESSION_SECRET` takes precedence (the app no longer signs with it).

**Gotcha:** during a workflow restart, old + new gunicorn workers can briefly
overlap; if they hold different keys you get a transient 401 right after restart.
With a stable `SESSION_SECRET` this disappears.

**Verified:** a cookie issued before a server restart still authenticates after
the restart (200) — proves cross-restart/redeploy stability.

**Note:** signup already persists accounts to the DB (`db_create_user`); the
"not saved to database" report was about session stability, not persistence.
Production held 221 persisted accounts at the time of this fix.
