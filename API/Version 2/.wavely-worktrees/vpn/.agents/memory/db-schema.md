---
name: DB schema and data layout
description: Single app_data JSONB table; friends and notifications structure
---
Single `app_data` table with JSONB. Keys used:
- `auth` — users dict, each user has: friends[], friend_requests_in[], friend_requests_out[]
- `dms` — threads{thread_key: [messages]}, notifications{username: [{id,type,from,thread_key,preview,timestamp,read}]}
- `servers`, `analytics`, `beat_battles`, `profiles`
**Why:** Avoids multi-table migrations; everything lives in one JSONB blob.
