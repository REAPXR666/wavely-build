---
name: app.js override layers
description: How static/app.js redefines core functions, and where app state is persisted
---

# static/app.js has stacked function overrides
Several core functions (`pollCommunity`, `initCommunityPage`, `startWebRTCCall`,
`selectChannel`, `switchDCView`, `switchDashTab`) are declared more than once.
**The LAST declaration in file order wins** (function hoisting + redefinition),
so the active versions live near the BOTTOM of the file.

**How to apply:** When changing community/WebRTC/notification behavior, edit the
*last* definition of the function, and grep for all declarations first
(`grep -n "function NAME" static/app.js`) to confirm which one is live.

# Data persistence
Auth and DM/notification data are stored as plain JSON files at the workspace
root: `AUTH.json` and the DMs store (see `load_auth`/`save_dms` in app.py).
These files are **tracked in git and not gitignored** — they can contain user
API keys and message contents. Treat any key found there as compromised.
