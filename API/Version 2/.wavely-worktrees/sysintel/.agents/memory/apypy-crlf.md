---
name: app.py CRLF editing
description: app.py uses Windows CRLF line endings; must use Python scripts to edit
---
app.py has Windows CRLF line endings. Using the write or edit tools directly causes issues.
**Why:** The file was originally created on Windows or with a Windows-style editor.
**How to apply:** All edits to app.py must be done via Python scripts: `python3 << 'PYEOF' ... PYEOF`.
Use `text.replace(old, new)` and write back with `open('app.py', 'w', encoding='utf-8')`.
