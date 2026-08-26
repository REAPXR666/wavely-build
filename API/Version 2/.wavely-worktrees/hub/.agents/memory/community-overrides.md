---
name: Community V2 JS override pattern
description: New DC community functions override old ones by appending to app.js
---
The new Discord-like community functions (initCommunityPage, selectServer, loadDMs, etc.)
are appended to the end of app.js. JavaScript function declarations in non-strict mode
replace earlier same-name declarations in the same scope — the last definition wins.
**Why:** Avoids rewriting the 3500+ line app.js while cleanly replacing community logic.
**How to apply:** When updating community JS, append new function declarations after existing ones.
The new switchDashTab override also handles 'notifications' tab and calls loadDashboardNotifications().
