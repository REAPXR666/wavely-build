import os
import sys

sys.path.insert(0, os.path.join(r'g:\HARDRIVE DATA\SPLICE CLONE\WAVELY WEBSITE V2'))

from app import app
import database as db

db.init_db()
client = app.test_client()

routes = [
    ('/', 200),
    ('/pricing', 200),
    ('/download', 200),
    ('/login', 200),
    ('/register', 200),
    ('/issues', 200),
    ('/admin/login', 200),
    ('/api/captcha', 200)
]

for route, expected in routes:
    res = client.get(route)
    assert res.status_code == expected, f"Route {route} returned {res.status_code} (expected {expected})"
    print(f"[OK] {route} -> {res.status_code}")

print("\nALL ROUTES AND TEMPLATES PASSED CLEANLY!")
