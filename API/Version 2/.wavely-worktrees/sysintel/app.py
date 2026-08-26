import os
import json
import uuid
import time
import secrets
import datetime
import traceback
import struct
import concurrent.futures
from functools import wraps
import requests
import psycopg2
import psycopg2.extras
from flask import Flask, request, jsonify, render_template, session, redirect, url_for, Response
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

# --- Version 2: Updated paths ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)

app = Flask(__name__,
            template_folder=os.path.join(BASE_DIR, 'templates'),
            static_folder=os.path.join(BASE_DIR, 'static'))

def custom_send_static_file(filename):
    base_path = os.path.join(app.static_folder, filename)
    if os.path.isfile(base_path):
        return Flask.send_static_file(app, filename)
    parent_static_dir = os.path.join(PARENT_DIR, 'static')
    parent_path = os.path.join(parent_static_dir, filename)
    if os.path.isfile(parent_path):
        from flask import send_from_directory
        return send_from_directory(parent_static_dir, filename)
    return Flask.send_static_file(app, filename)

app.send_static_file = custom_send_static_file


# Flask session-signing key. It MUST be identical across restarts AND across
# every deployed instance, or session cookies are rejected and users get
# silently logged out (and appear unable to log back in). A file on disk is the
# wrong place: in production the filesystem is ephemeral/per-instance, and a
# committed file leaks the key (anyone could forge any user's session). We set
# a temporary key here so app.secret_key is always defined, then resolve the
# real, stable key below once the DB is reachable: SESSION_SECRET env var if
# provided, otherwise a value persisted once in the shared database.
app.secret_key = os.environ.get('SESSION_SECRET') or secrets.token_hex(32)

# Session cookie security
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max upload

@app.after_request
def add_static_cache_headers(response):
    # Let browsers cache static assets so full-page navigations (the nav tabs
    # do real page loads) don't re-fetch the 200KB JS + 86KB CSS every time.
    # ETags still allow revalidation, so updates aren't served stale for long.
    try:
        if request.path.startswith('/static/cache/'):
            # Decrypted/licensed media — never cache in shared/intermediary caches.
            response.headers['Cache-Control'] = 'private, no-store'
        elif request.path.startswith('/static/'):
            response.headers['Cache-Control'] = 'public, max-age=600'
    except Exception:
        pass
    return response

def require_login(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'username' not in session:
            if request.path.startswith('/api/'):
                return jsonify({"error": "Unauthorized. Login required."}), 401
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated

# --- Simple rate limiter for auth endpoints ---
_auth_attempts = {}  # ip -> [timestamps]
def check_rate_limit(ip, max_attempts=10, window_seconds=60):
    now = datetime.datetime.now().timestamp()
    attempts = _auth_attempts.get(ip, [])
    attempts = [t for t in attempts if now - t < window_seconds]
    _auth_attempts[ip] = attempts
    if len(attempts) >= max_attempts:
        return False
    attempts.append(now)
    _auth_attempts[ip] = attempts
    return True

_banned_ips_cache = {"ips": set(), "expires_at": 0}
_BANNED_IPS_TTL = 30  # seconds


def get_banned_ips():
    """Return the set of banned IPs, cached for a short window to avoid a DB
    read on every single request (including static assets and polling)."""
    now = time.time()
    if now >= _banned_ips_cache["expires_at"]:
        try:
            _banned_ips_cache["ips"] = set(load_auth().get("banned_ips", []))
        except Exception:
            pass
        _banned_ips_cache["expires_at"] = now + _BANNED_IPS_TTL
    return _banned_ips_cache["ips"]


def invalidate_banned_ips_cache():
    """Force the next ban check to re-read from the DB so admin ban/unban
    actions take effect immediately instead of after the TTL window."""
    _banned_ips_cache["expires_at"] = 0


@app.before_request
def enforce_banned_ips():
    # Static assets are public and high-volume — never gate them on a DB lookup.
    if request.path.startswith('/static/'):
        return
    banned = get_banned_ips()
    if not banned:
        return
    ip_addr = request.headers.get('X-Forwarded-For', request.remote_addr or '127.0.0.1').split(',')[0].strip()
    if ip_addr in banned:
        return jsonify({"error": "Forbidden. Your IP address has been banned by the administrator."}), 403


# Data files live in the PARENT directory (shared with V1)
AUTH_FILE = os.path.join(PARENT_DIR, 'AUTH.json')
ANALYTICS_FILE = os.path.join(PARENT_DIR, 'ANALYTICS.json')
BEAT_BATTLES_FILE = os.path.join(PARENT_DIR, 'BEAT_BATTLES.json')
SERVERS_FILE = os.path.join(PARENT_DIR, 'SERVERS.json')
DMS_FILE = os.path.join(PARENT_DIR, 'DMS.json')
PROFILES_FILE = os.path.join(PARENT_DIR, 'PROFILES.json')

# Password hashing cost. scrypt:16384:8:1 is the OWASP-recommended minimum
# (memory-hard, still strong) and verifies in ~40ms vs ~90ms for werkzeug's
# default scrypt:32768 — roughly 2x more login/signup throughput per core.
HASH_METHOD = "scrypt:16384:8:1"

api_keys_cache = {}
samples_metadata_cache = {}

# --- DATABASE HELPERS (PostgreSQL-backed) ---
# Use a thread-safe connection pool so we don't pay the ~11ms TCP+TLS+auth cost
# of a brand-new Postgres connection on every read/write. Connections are reused
# (a query on a warm connection is ~0.5ms) and returned to the pool when done.
from psycopg2 import pool as _pg_pool
from contextlib import contextmanager

_DB_POOL = _pg_pool.ThreadedConnectionPool(
    2, 30,
    os.environ['DATABASE_URL'],
    cursor_factory=psycopg2.extras.RealDictCursor,
)

@contextmanager
def _get_db_conn():
    conn = _DB_POOL.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        _DB_POOL.putconn(conn)

def _filepath_to_key(filepath):
    return os.path.splitext(os.path.basename(filepath))[0].lower()

def _ensure_table():
    try:
        with _get_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS app_data (
                        key TEXT PRIMARY KEY,
                        data JSONB NOT NULL,
                        updated_at TIMESTAMP DEFAULT NOW()
                    )
                """)
            conn.commit()
    except Exception as e:
        print(f"Error ensuring DB table: {e}")

def load_json(filepath, default):
    key = _filepath_to_key(filepath)
    try:
        with _get_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT data FROM app_data WHERE key = %s", (key,))
                row = cur.fetchone()
                if row:
                    return dict(row['data']) if isinstance(row['data'], dict) else row['data']
    except Exception as e:
        print(f"Error loading {key} from DB: {e}")
    return default

def save_json(filepath, data):
    key = _filepath_to_key(filepath)
    try:
        with _get_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO app_data (key, data, updated_at)
                    VALUES (%s, %s::jsonb, NOW())
                    ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
                """, (key, json.dumps(data)))
            conn.commit()
    except Exception as e:
        print(f"Error saving {key} to DB: {e}")

def _get_or_create_secret_key():
    """Return a session-signing key that is stable across restarts and shared by
    every instance. Stored once in the shared DB; the INSERT ... ON CONFLICT DO
    NOTHING makes concurrent instances converge on a single value. Retries on
    transient DB errors and FAILS CLOSED (raises) rather than silently using a
    per-process ephemeral key -- an ephemeral key would invalidate sessions
    across instances/restarts, which is the exact bug this function prevents."""
    last_err = None
    for attempt in range(5):
        try:
            with _get_db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO app_data (key, data) VALUES ('secret_key', %s::jsonb) ON CONFLICT (key) DO NOTHING",
                        (json.dumps({"value": secrets.token_hex(32)}),),
                    )
                    cur.execute("SELECT data->>'value' AS v FROM app_data WHERE key = 'secret_key'")
                    row = cur.fetchone()
                    if row and row.get('v'):
                        return row['v']
                    last_err = "secret_key row missing/empty after upsert"
        except Exception as e:
            last_err = e
            print(f"Error resolving secret key from DB (attempt {attempt + 1}/5): {e}")
        time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"Could not resolve a stable session secret key from DB: {last_err}")

def load_auth():
    data = load_json(AUTH_FILE, {"users": {}})
    if "users" not in data:
        data["users"] = {}
    if "banned_ips" not in data:
        data["banned_ips"] = []
    return data

def save_auth(data):
    save_json(AUTH_FILE, data)
    rebuild_key_cache()

def load_user(username):
    """Fetch a single user record straight from the JSONB column without
    deserializing the entire auth blob. Keeps the login path cheap and frees
    the pooled DB connection in ~1ms so worker threads aren't tied up while
    the (CPU-heavy) password hash runs."""
    try:
        with _get_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT data->'users'->%s AS u FROM app_data WHERE key = %s", (username, 'auth'))
                row = cur.fetchone()
                if row and row['u']:
                    return row['u']
    except Exception as e:
        print(f"Error loading user {username}: {e}")
    return None

def db_create_user(username, record):
    """Atomically insert a new user server-side. The old read-modify-write of
    the whole auth blob dropped users under concurrent signups (last write
    wins); this conditional UPDATE is race-safe. Returns True if created,
    False if the username is already taken."""
    try:
        with _get_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO app_data (key, data) VALUES (%s, %s::jsonb) ON CONFLICT (key) DO NOTHING",
                    ('auth', json.dumps({"users": {}, "banned_ips": []})),
                )
                cur.execute(
                    """
                    UPDATE app_data
                    SET data = jsonb_set(
                            jsonb_set(data, '{users}', COALESCE(data->'users', '{}'::jsonb)),
                            ARRAY['users', %s], %s::jsonb, true),
                        updated_at = NOW()
                    WHERE key = 'auth' AND NOT COALESCE(data->'users' ? %s, false)
                    """,
                    (username, json.dumps(record), username),
                )
                return cur.rowcount == 1
    except Exception as e:
        print(f"Error creating user {username}: {e}")
        return False

def update_user_password_hash(username, new_hash):
    """Persist a single user's re-hashed password without rewriting the whole
    blob (used by upgrade-on-login to migrate old hash costs)."""
    try:
        with _get_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE app_data SET data = jsonb_set(data, ARRAY['users', %s, 'password_hash'], %s::jsonb), updated_at = NOW() WHERE key = 'auth'",
                    (username, json.dumps(new_hash)),
                )
    except Exception as e:
        print(f"Error updating password hash for {username}: {e}")

def load_analytics():
    return load_json(ANALYTICS_FILE, {"requests": [], "errors": []})

def save_analytics(data):
    save_json(ANALYTICS_FILE, data)

def load_beat_battles():
    data = load_json(BEAT_BATTLES_FILE, {"battles": []})
    if "battles" not in data:
        data["battles"] = []
    return data

def save_beat_battles(data):
    save_json(BEAT_BATTLES_FILE, data)

def load_servers():
    data = load_json(SERVERS_FILE, {"servers": []})
    if "servers" not in data:
        data["servers"] = []
    return data

def save_servers(data):
    save_json(SERVERS_FILE, data)

def load_dms():
    data = load_json(DMS_FILE, {"threads": {}, "active_calls": {}})
    if "threads" not in data:
        data["threads"] = {}
    if "active_calls" not in data:
        data["active_calls"] = {}
    return data

def save_dms(data):
    save_json(DMS_FILE, data)

def load_profiles():
    data = load_json(PROFILES_FILE, {"profiles": {}, "acknowledgements": {}})
    if "profiles" not in data:
        data["profiles"] = {}
    if "acknowledgements" not in data:
        data["acknowledgements"] = {}
    return data

def save_profiles(data):
    save_json(PROFILES_FILE, data)

def init_admin():
    auth_data = load_auth()
    if "admin" not in auth_data["users"]:
        auth_data["users"]["admin"] = {
            "email": "admin@wavely.io",
            "password_hash": generate_password_hash("Reapxr!", method=HASH_METHOD),
            "role": "admin",
            "banned": False,
            "api_keys": []
        }
        save_auth(auth_data)
    else:
        admin_changed = False
        if auth_data["users"]["admin"].get("role") != "admin":
            auth_data["users"]["admin"]["role"] = "admin"
            admin_changed = True
        if auth_data["users"]["admin"].get("banned"):
            auth_data["users"]["admin"]["banned"] = False
            admin_changed = True
        if admin_changed:
            save_auth(auth_data)

def save_analytics(data):
    save_json(ANALYTICS_FILE, data)

def rebuild_key_cache():
    # Build into a new dict and swap atomically. Under the gthread worker,
    # clearing the live dict before refilling it would expose a window where
    # valid API keys momentarily resolve to None and return false 401s.
    global api_keys_cache
    new_cache = {}
    auth_data = load_auth()
    for username, user_info in auth_data.get("users", {}).items():
        for key_item in user_info.get("api_keys", []):
            new_cache[key_item["key"]] = username
    api_keys_cache = new_cache

# --- CREDENTIALS HANDLING ---
def get_hardcoded_fallback():
    cookie = os.environ.get("SPLICE_COOKIE", "")
    authorization = os.environ.get("SPLICE_AUTHORIZATION", "")
    return {"cookie": cookie, "authorization": authorization}

def get_splice_credentials():
    parent_dir = os.path.dirname(os.path.abspath(__file__))
    paths_to_try = [
        os.path.join(os.path.dirname(parent_dir), 'splice queries.txt'),
        os.path.join(parent_dir, 'splice queries.txt'),
        os.path.join(PARENT_DIR, 'splice queries.txt')
    ]
    queries_path = None
    for p in paths_to_try:
        if os.path.exists(p):
            queries_path = p
            break

    content = ""
    if queries_path:
        try:
            with open(queries_path, 'r', encoding='utf16') as f:
                content = f.read()
        except Exception:
            try:
                with open(queries_path, 'r', encoding='utf8') as f:
                    content = f.read()
            except Exception:
                pass

    cookie = ""
    authorization = ""
    if content:
        lines = content.splitlines()
        for i, line in enumerate(lines):
            line_strip = line.strip()
            if line_strip.lower() == 'cookie':
                cookie = lines[i+1].strip() if i+1 < len(lines) else ""
            elif line_strip.lower() == 'authorization':
                authorization = lines[i+1].strip() if i+1 < len(lines) else ""

        if not cookie or not authorization:
            for line in lines:
                if ' - ' in line:
                    parts = line.split(' - ')
                    key = parts[0].strip().lower()
                    val = parts[1].strip()
                    if key == 'cookie': cookie = val
                    elif key == 'authorization': authorization = val

    if not authorization:
        return get_hardcoded_fallback()
    return {"cookie": cookie, "authorization": authorization}

# --- ANALYTICS AND DECORATORS ---
def log_request(username, endpoint, status_code, key_label):
    try:
        analytics = load_analytics()
        cutoff_90d = datetime.datetime.now() - datetime.timedelta(days=90)
        ip_addr = "127.0.0.1"
        if request:
            ip_addr = request.headers.get('X-Forwarded-For', request.remote_addr or '127.0.0.1').split(',')[0].strip()
        new_req = {
            "timestamp": datetime.datetime.now().isoformat(),
            "username": username,
            "endpoint": endpoint,
            "status_code": status_code,
            "api_key_label": key_label,
            "ip_address": ip_addr
        }
        analytics["requests"].append(new_req)
        analytics["requests"] = [
            r for r in analytics["requests"]
            if datetime.datetime.fromisoformat(r["timestamp"]) >= cutoff_90d
        ]
        save_analytics(analytics)
    except Exception as e:
        print(f"Error logging request analytics: {e}")

def log_error(endpoint, error_msg, tb_str, username=None):
    try:
        analytics = load_analytics()
        cutoff_90d = datetime.datetime.now() - datetime.timedelta(days=90)
        ip_addr = "127.0.0.1"
        if request:
            ip_addr = request.headers.get('X-Forwarded-For', request.remote_addr or '127.0.0.1').split(',')[0].strip()
        new_err = {
            "timestamp": datetime.datetime.now().isoformat(),
            "username": username or "anonymous",
            "endpoint": endpoint,
            "error": error_msg,
            "traceback": tb_str,
            "ip_address": ip_addr
        }
        analytics["errors"].append(new_err)
        analytics["errors"] = [
            e for e in analytics["errors"]
            if datetime.datetime.fromisoformat(e["timestamp"]) >= cutoff_90d
        ]
        save_analytics(analytics)
    except Exception as e:
        print(f"Error logging error trace: {e}")

def require_session_login(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            # API calls must get a clean 401 (JSON) so the front-end can detect
            # "logged out" reliably. Redirecting /api/* to the login HTML page
            # makes fetch() follow the 302, receive HTML, and misread the auth
            # state -- which previously caused an infinite dashboard reload loop.
            if request.path.startswith('/api/'):
                return jsonify({"error": "Unauthorized. Login required."}), 401
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated_function

def require_admin_login(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            return jsonify({"error": "Unauthorized. Sign in required."}), 401
        username = session['username']
        auth_data = load_auth()
        user_info = auth_data["users"].get(username, {})
        if user_info.get("role") != "admin":
            return jsonify({"error": "Forbidden. Admin access required."}), 403
        return f(*args, **kwargs)
    return decorated_function

def require_api_key(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        api_key = request.headers.get('X-API-Key') or request.args.get('api_key')
        if not api_key:
            return jsonify({"error": "Unauthorized. Missing API key."}), 401
        username = api_keys_cache.get(api_key)
        if not username:
            return jsonify({"error": "Unauthorized. Invalid API key."}), 401
        auth_data = load_auth()
        user_info = auth_data["users"].get(username, {})
        if user_info.get("banned"):
            return jsonify({"error": "Unauthorized. This account has been banned."}), 403
        key_label = "Unknown"
        for k in user_info.get("api_keys", []):
            if k["key"] == api_key:
                key_label = k["label"]
                break
        request.username = username
        request.key_label = key_label
        response = f(*args, **kwargs)
        status_code = response.status_code if isinstance(response, Response) else 200
        log_request(username, request.path, status_code, key_label)
        return response
    return decorated_function

# --- SPLICE XOR DESCRAMBLER ALGORITHM ---
def descramble_splice_mp3(scrambled_bytes: bytes) -> bytes:
    if len(scrambled_bytes) < 28:
        raise ValueError("Invalid scrambled file size (too short)")
    if scrambled_bytes.startswith(b'ID3') or (scrambled_bytes[0] == 0xFF and (scrambled_bytes[1] & 0xE0) == 0xE0):
        return scrambled_bytes
    e = struct.unpack_from('<Q', scrambled_bytes, 2)[0]
    key_bytes = bytearray(scrambled_bytes[10:28])
    payload = bytearray(scrambled_bytes[28:])
    payload_length = len(payload)
    block1_end = min(e, payload_length)
    for i in range(block1_end):
        payload[i] ^= key_bytes[i % 18]
    block3_start = 2 * e
    block3_end = min(3 * e, payload_length)
    if block3_start < payload_length:
        for i in range(block3_start, block3_end):
            key_index = (i - block3_start) % 18
            payload[i] ^= key_bytes[key_index]
    return bytes(payload)

# --- DYNAMIC WAV TRANSCODER ---
def convert_mp3_to_wav_py(mp3_bytes: bytes):
    try:
        import io
        import torch
        import torchaudio
        buffer = io.BytesIO(mp3_bytes)
        waveform, sample_rate = torchaudio.load(buffer, format="mp3")
        out_buffer = io.BytesIO()
        torchaudio.save(out_buffer, waveform, sample_rate, format="wav")
        return out_buffer.getvalue()
    except Exception as e:
        print(f"torchaudio MP3 to WAV conversion failed: {e}")
    try:
        from pydub import AudioSegment
        import io
        buffer = io.BytesIO(mp3_bytes)
        sound = AudioSegment.from_file(buffer, format="mp3")
        out_buffer = io.BytesIO()
        sound.export(out_buffer, format="wav")
        return out_buffer.getvalue()
    except Exception as e:
        print(f"pydub MP3 to WAV conversion failed: {e}")
    return None

# --- AUDIO DECRYPTION CACHE ---
CACHE_DIR = os.path.join(BASE_DIR, 'static', 'cache', 'decrypted')
os.makedirs(CACHE_DIR, exist_ok=True)

def get_cached_or_decrypt(sample, fmt):
    uuid_val = sample['uuid']
    is_preset_download = (sample.get('isPreset') or bool(sample.get('presetUrl'))) and fmt not in ['mp3', 'wav']
    
    if is_preset_download:
        preset_ext = sample.get('presetExt', 'preset')
        cache_filename = f"{uuid_val}.{preset_ext}"
        mimetype = "application/octet-stream"
    else:
        cache_filename = f"{uuid_val}.{fmt}"
        mimetype = "audio/wav" if fmt == 'wav' else "audio/mpeg"
        
    cache_path = os.path.join(CACHE_DIR, cache_filename)
    
    if os.path.exists(cache_path):
        with open(cache_path, 'rb') as f:
            content = f.read()
        return content, mimetype, cache_filename

    # If not cached, perform download and decryption
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://splice.com/', 'Origin': 'https://splice.com'}
    if is_preset_download:
        preset_url = sample.get('presetUrl')
        if not preset_url:
            scrambled_url = sample.get('previewUrl')
            if not scrambled_url:
                raise ValueError("No preview URL available")
            res = requests.get(scrambled_url, headers=headers, timeout=10)
            if res.status_code != 200:
                raise IOError("Failed to load preview")
            clean_bytes = descramble_splice_mp3(res.content)
            cache_filename = f"{uuid_val}.mp3"
            mimetype = "audio/mpeg"
            cache_path = os.path.join(CACHE_DIR, cache_filename)
        else:
            res = requests.get(preset_url, headers=headers, timeout=10)
            if res.status_code != 200:
                raise IOError(f"Failed to load preset: HTTP {res.status_code}")
            clean_bytes = res.content
    else:
        scrambled_url = sample.get('previewUrl')
        if not scrambled_url:
            raise ValueError("No preview URL available")
        res = requests.get(scrambled_url, headers=headers, timeout=10)
        if res.status_code != 200:
            raise IOError(f"Failed to load scrambled file: HTTP {res.status_code}")
        clean_mp3 = descramble_splice_mp3(res.content)
        if fmt == 'wav':
            wav_bytes = convert_mp3_to_wav_py(clean_mp3)
            if not wav_bytes:
                raise RuntimeError("WAV conversion failed")
            clean_bytes = wav_bytes
        else:
            clean_bytes = clean_mp3

    # Save to cache
    try:
        with open(cache_path, 'wb') as f:
            f.write(clean_bytes)
    except Exception as e:
        print(f"Failed to write cache file: {e}")
        
    return clean_bytes, mimetype, cache_filename

# --- MULTI-THREADED SEARCH ENGINE ---
def query_splice_page(query_text, page, category, bpm, key, is_preset):
    credentials = get_splice_credentials()
    graphql_query = f"""query SamplesSearch($attributes: [AssetAttributeSlug!], $parent_asset_uuid: GUID, $query: String, $order: SortOrder = DESC, $sort: AssetSortType = popularity, $random_seed: String, $tags: [ID], $key: String, $chord_type: String, $bpm: String, $min_bpm: Int, $max_bpm: Int, $limit: Int = 50, $asset_category_slug: AssetCategorySlug, $page: Int = 1, $ac_uuid: String, $parent_asset_type: AssetTypeSlug, $licensed: Boolean, $liked: Boolean, $filepath: String) {{
      assetsSearch(
        filter: {{attributes: $attributes, legacy: true, published: true, asset_type_slug: {'preset' if is_preset else 'sample'}, query: $query, filepath: $filepath, tag_ids: $tags, key: $key, chord_type: $chord_type, bpm: $bpm, min_bpm: $min_bpm, max_bpm: $max_bpm, asset_category_slug: $asset_category_slug, ac_uuid: $ac_uuid, licensed: $licensed, liked: $liked}}
        children: {{parent_asset_uuid: $parent_asset_uuid}}
        pagination: {{page: $page, limit: $limit}}
        sort: {{sort: $sort, order: $order, random_seed: $random_seed}}
        legacy: {{parent_asset_type: $parent_asset_type}}
      ) {{
        items {{
          ... on IAsset {{
            asset_type_slug
            liked
            licensed
            uuid
            name
            tags {{
              uuid
              label
            }}
            files {{
              uuid
              name
              hash
              path
              asset_file_type_slug
              url
            }}
          }}
          ... on IAssetChild {{
            parents(filter: {{asset_type_slug: pack}}) {{
              items {{
                ... on PackAsset {{
                  uuid
                  name
                  files {{
                    uuid
                    path
                    asset_file_type_slug
                    url
                  }}
                }}
              }}
            }}
          }}
          ... on SampleAsset {{
            bpm
            chord_type
            key
            duration
            uuid
            name
          }}
        }}
      }}
    }}"""
    payload = {
        "operationName": "SamplesSearch",
        "variables": {
            "order": "DESC", "sort": "popularity", "limit": 50, "page": page,
            "tags": [], "key": key or None, "chord_type": None,
            "bpm": str(bpm) if bpm else None, "min_bpm": None, "max_bpm": None,
            "asset_category_slug": category or None, "random_seed": None,
            "attributes": [],
            "filepath": None if is_preset else query_text,
            "query": query_text if is_preset else None,
            "ac_uuid": None, "parent_asset_uuid": None
        },
        "query": graphql_query
    }
    headers = {
        "content-type": "application/json",
        "authorization": credentials["authorization"],
        "cookie": credentials["cookie"],
        "origin": "https://splice.com",
        "referer": "https://splice.com/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    try:
        res = requests.post("https://surfaces-graphql.splice.com/graphql", json=payload, headers=headers, timeout=6)
        if res.status_code == 200:
            res_json = res.json()
            items = res_json.get("data", {}).get("assetsSearch", {}).get("items", [])
            return items
    except Exception as e:
        print(f"Error querying page {page}: {e}")
    return []

def search_splice_max(query_text, category=None, bpm=None, key=None, is_preset=False):
    all_raw_items = []
    pages = list(range(1, 21))
    with concurrent.futures.ThreadPoolExecutor(max_workers=15) as executor:
        futures = {
            executor.submit(query_splice_page, query_text, p, category, bpm, key, is_preset): p
            for p in pages
        }
        for fut in concurrent.futures.as_completed(futures):
            page_results = fut.result()
            if page_results:
                all_raw_items.extend(page_results)

    formatted_results = []
    seen_uuids = set()

    for item in all_raw_items:
        if not item or 'uuid' not in item:
            continue
        uuid_val = item['uuid']
        if uuid_val in seen_uuids:
            continue
        seen_uuids.add(uuid_val)

        files = item.get('files', [])
        preview_file = next((f for f in files if f.get('asset_file_type_slug') == 'preview_mp3' or '.mp3' in f.get('url', '') or '.wav' in f.get('url', '')), None)
        if not preview_file:
            continue

        mp3_url = preview_file.get('url')
        pack_name = 'Splice Catalog'
        cover_art_url = ''

        parents = item.get('parents', {}).get('items', [])
        parent_pack = parents[0] if parents else None
        if parent_pack:
            pack_name = parent_pack.get('name', pack_name)
            pack_files = parent_pack.get('files', [])
            cover_image_file = next((f for f in pack_files if f.get('asset_file_type_slug') == 'cover_image'), None)
            if cover_image_file:
                cover_art_url = cover_image_file.get('url', '')

        name = item.get('name', f'Splice_Sample_{uuid_val}')
        name = name.split('/')[-1]

        tags = ['splice', 'premium'] + (query_text.split() if query_text else [])
        if item.get('tags'):
            tags += [t.get('label') for t in item.get('tags') if t.get('label')]

        duration = '--'
        if item.get('duration'):
            duration = f"{item.get('duration') / 1000:.1f}s"

        has_preset_file = any(
            f.get('asset_file_type_slug') == 'preset' or
            any(f.get('url', '').lower().endswith('.' + ext) for ext in ['serumpreset', 'vital', 'fxp', 'nmsv', 'preset']) or
            any(f.get('name', '').lower().endswith('.' + ext) for ext in ['serumpreset', 'vital', 'fxp', 'nmsv', 'preset'])
            for f in files
        )
        is_preset_item = is_preset or (item.get('asset_type_slug') == 'preset') or has_preset_file
        preset_url = ''
        preset_ext = 'preset'
        if is_preset_item:
            preset_file = next((f for f in files if f.get('asset_file_type_slug') != 'preview_mp3' and not f.get('url', '').endswith('.mp3') and not f.get('url', '').endswith('.wav')), None)
            if preset_file:
                preset_url = preset_file.get('url', '')
                file_name = preset_file.get('name') or preset_file.get('path') or ''
                if '.' in file_name:
                    preset_ext = file_name.split('.')[-1].lower()
            if preset_ext == 'preset' or not preset_ext:
                if '.' in name:
                    ext_part = name.split('.')[-1].lower()
                    if ext_part not in ['mp3', 'wav']:
                        preset_ext = ext_part
                if preset_ext == 'preset':
                    lower_name = name.lower()
                    lower_query = (query_text or '').lower()
                    if 'serum' in lower_name or 'serum' in lower_query:
                        preset_ext = 'serumpreset'
                    elif 'vital' in lower_name or 'vital' in lower_query:
                        preset_ext = 'vital'
                    elif 'massive' in lower_name or 'massive' in lower_query:
                        preset_ext = 'nmsv'

        formatted_results.append({
            "id": f"splice-{uuid_val}",
            "name": name,
            "uuid": uuid_val,
            "pack": pack_name,
            "duration": duration,
            "key": item.get('key', '--'),
            "bpm": item.get('bpm', '--'),
            "tags": tags,
            "source": "Splice",
            "previewUrl": mp3_url,
            "coverArt": cover_art_url,
            "decryptedAudioUrl": f"/api/decrypted-audio/{uuid_val}",
            "isPreset": is_preset_item,
            "presetUrl": preset_url,
            "presetExt": preset_ext
        })

    for r in formatted_results:
        samples_metadata_cache[r["uuid"]] = r
    return formatted_results


# =============================================
# VERSION 2: SINGLE-PAGE ROUTING
# All page routes render the same unified template
# =============================================

@app.route('/')
def home():
    return render_template('home.html', tab='home')

@app.route('/browser')
@require_session_login
def browser_page():
    return render_template('browser.html', tab='browser')

@app.route('/docs')
def docs_page():
    return render_template('docs.html', tab='docs')

@app.route('/dashboard')
@require_session_login
def dashboard_page():
    return render_template('dashboard.html', tab='dashboard', username=session['username'])

@app.route('/community')
@require_session_login
def community_page():
    return render_template('community.html', tab='community', username=session['username'])

@app.route('/login')
def login_page():
    if 'username' in session:
        return redirect(url_for('dashboard_page'))
    return render_template('login.html', tab='login')

@app.route('/signup')
def signup_page():
    if 'username' in session:
        return redirect(url_for('dashboard_page'))
    return render_template('signup.html', tab='signup')

@app.route('/admin')
def admin_page():
    if 'username' not in session:
        return redirect(url_for('login_page'))
    username = session['username']
    auth_data = load_auth()
    user_info = auth_data["users"].get(username, {})
    if user_info.get("role") != "admin":
        return redirect(url_for('home'))
    return render_template('admin.html', tab='admin', username=username)

# --- AUTH BACKEND ACTIONS ---
@app.route('/api/auth/signup', methods=['POST'])
def action_signup():
    # Rate limit check
    ip = request.headers.get('X-Forwarded-For', request.remote_addr or '127.0.0.1').split(',')[0].strip()
    if not check_rate_limit(ip):
        return jsonify({"error": "Too many attempts. Please try again later."}), 429
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip()
    password = data.get('password') or ''
    if not username or not email or not password:
        return jsonify({"error": "All fields are required"}), 400
    # Input validation
    if len(username) < 3 or len(username) > 32:
        return jsonify({"error": "Username must be 3-32 characters"}), 400
    if not username.replace('_', '').replace('-', '').isalnum():
        return jsonify({"error": "Username can only contain letters, numbers, underscores, hyphens"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    record = {
        "email": email,
        "password_hash": generate_password_hash(password, method=HASH_METHOD),
        "api_keys": []
    }
    if not db_create_user(username, record):
        return jsonify({"error": "Username already exists"}), 400
    session['username'] = username
    return jsonify({"success": True})

@app.route('/api/auth/login', methods=['POST'])
def action_login():
    # Rate limit check
    ip = request.headers.get('X-Forwarded-For', request.remote_addr or '127.0.0.1').split(',')[0].strip()
    if not check_rate_limit(ip):
        return jsonify({"error": "Too many login attempts. Please try again later."}), 429
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    if not username or not password:
        return jsonify({"error": "All fields are required"}), 400
    user = load_user(username)
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid username or password"}), 401
    # Upgrade-on-login: migrate older/heavier hashes to the current cost so
    # repeat logins get the faster path. One-time cost per user.
    if not str(user.get("password_hash", "")).startswith(HASH_METHOD):
        try:
            update_user_password_hash(username, generate_password_hash(password, method=HASH_METHOD))
        except Exception:
            pass
    session['username'] = username
    return jsonify({"success": True})

@app.route('/api/auth/logout', methods=['POST'])
def action_logout():
    session.pop('username', None)
    return jsonify({"success": True})

@app.route('/api/auth/change-password', methods=['POST'])
@require_session_login
def action_change_password():
    data = request.get_json() or {}
    old_password = data.get('old_password', '')
    new_password = data.get('new_password', '')
    if not old_password or not new_password:
        return jsonify({"error": "All fields are required"}), 400
    if len(new_password) < 6:
        return jsonify({"error": "New password must be at least 6 characters"}), 400
    username = session['username']
    auth_data = load_auth()
    user = auth_data["users"].get(username)
    if not user or not check_password_hash(user["password_hash"], old_password):
        return jsonify({"error": "Current password is incorrect"}), 401
    user["password_hash"] = generate_password_hash(new_password, method=HASH_METHOD)
    save_auth(auth_data)
    return jsonify({"success": True})

# --- API KEY MANAGEMENT ACTIONS ---
@app.route('/api/keys/generate', methods=['POST'])
@require_session_login
def generate_key():
    data = request.get_json() or {}
    label = (data.get('label') or '').strip() or "Default Key"
    username = session['username']
    auth_data = load_auth()
    user = auth_data["users"][username]
    if len(user["api_keys"]) >= 3:
        return jsonify({"error": "Maximum limit of 3 API keys reached"}), 400
    new_key = f"wv_{secrets.token_hex(20)}"
    new_key_item = {
        "id": str(uuid.uuid4()),
        "key": new_key,
        "label": label,
        "created_at": datetime.datetime.now().isoformat()
    }
    user["api_keys"].append(new_key_item)
    save_auth(auth_data)
    return jsonify({"success": True, "key": new_key_item})

@app.route('/api/keys/<key_id>', methods=['DELETE'])
@require_session_login
def delete_key(key_id):
    username = session['username']
    auth_data = load_auth()
    user = auth_data["users"][username]
    user["api_keys"] = [k for k in user["api_keys"] if k["id"] != key_id]
    save_auth(auth_data)
    return jsonify({"success": True})

# --- DEVELOPER ANALYTICS ACTIONS ---
@app.route('/api/dashboard/analytics')
@require_session_login
def get_dashboard_analytics():
    username = session['username']
    analytics = load_analytics()
    user_requests = [r for r in analytics["requests"] if r["username"] == username]
    user_errors = [e for e in analytics["errors"] if e["username"] == username]
    total_reqs = len(user_requests)
    errors_count = len(user_errors)
    success_rate = 100.0 if total_reqs == 0 else ((total_reqs - errors_count) / total_reqs) * 100.0
    endpoints = {}
    for r in user_requests:
        endpoints[r["endpoint"]] = endpoints.get(r["endpoint"], 0) + 1
    most_used = max(endpoints, key=endpoints.get) if endpoints else "--"
    today = datetime.date.today()
    days_30 = [today - datetime.timedelta(days=i) for i in range(29, -1, -1)]
    days_labels = [d.strftime('%b %d') for d in days_30]
    daily_counts = [0] * 30
    for r in user_requests:
        req_date = datetime.datetime.fromisoformat(r["timestamp"]).date()
        if req_date in days_30:
            idx = days_30.index(req_date)
            daily_counts[idx] += 1
    history_logs = []
    for r in user_requests:
        history_logs.append({
            "timestamp": r["timestamp"], "type": "SUCCESS", "endpoint": r["endpoint"],
            "details": f"Status: {r['status_code']} | Key: {r['api_key_label']}"
        })
    for e in user_errors:
        history_logs.append({
            "timestamp": e["timestamp"], "type": "ERROR", "endpoint": e["endpoint"],
            "details": f"Err: {e['error']} | Trace: {e['traceback'][:150]}..."
        })
    history_logs.sort(key=lambda x: x["timestamp"], reverse=True)
    auth_data = load_auth()
    user_keys = auth_data["users"][username].get("api_keys", [])
    is_admin = auth_data["users"][username].get("role") == "admin"
    return jsonify({
        "username": username,
        "stats": {"totalRequests": total_reqs, "successRate": f"{success_rate:.1f}%", "mostUsed": most_used, "errorCount": errors_count},
        "chart": {"labels": days_labels, "data": daily_counts},
        "endpoints": endpoints, "logs": history_logs[:100], "keys": user_keys, "isAdmin": is_admin
    })

# --- ADMIN PANEL ENDPOINTS ---
@app.route('/api/admin/users')
@require_admin_login
def admin_get_users():
    auth_data = load_auth()
    users_list = []
    for username, info in auth_data.get("users", {}).items():
        users_list.append({
            "username": username, "email": info.get("email"),
            "role": info.get("role", "developer"), "banned": info.get("banned", False),
            "keys_count": len(info.get("api_keys", []))
        })
    return jsonify({"users": users_list})

@app.route('/api/admin/users/<username>/ban', methods=['POST'])
@require_admin_login
def admin_ban_user(username):
    if username == 'admin':
        return jsonify({"error": "Cannot ban the main administrator account"}), 400
    auth_data = load_auth()
    if username not in auth_data["users"]:
        return jsonify({"error": "User not found"}), 404
    auth_data["users"][username]["banned"] = True
    save_auth(auth_data)
    return jsonify({"success": True})

@app.route('/api/admin/users/<username>/unban', methods=['POST'])
@require_admin_login
def admin_unban_user(username):
    auth_data = load_auth()
    if username not in auth_data["users"]:
        return jsonify({"error": "User not found"}), 404
    auth_data["users"][username]["banned"] = False
    save_auth(auth_data)
    return jsonify({"success": True})

@app.route('/api/admin/users/<username>', methods=['DELETE'])
@require_admin_login
def admin_delete_user(username):
    if username == 'admin':
        return jsonify({"error": "Cannot delete the main administrator account"}), 400
    auth_data = load_auth()
    if username not in auth_data["users"]:
        return jsonify({"error": "User not found"}), 404
    del auth_data["users"][username]
    save_auth(auth_data)
    return jsonify({"success": True})

@app.route('/api/admin/ips')
@require_admin_login
def admin_get_ips():
    auth_data = load_auth()
    return jsonify({"banned_ips": auth_data.get("banned_ips", [])})

@app.route('/api/admin/ips/ban', methods=['POST'])
@require_admin_login
def admin_ban_ip():
    data = request.get_json() or {}
    ip = (data.get('ip') or '').strip()
    if not ip:
        return jsonify({"error": "IP address is required"}), 400
    auth_data = load_auth()
    if "banned_ips" not in auth_data:
        auth_data["banned_ips"] = []
    if ip not in auth_data["banned_ips"]:
        auth_data["banned_ips"].append(ip)
        save_auth(auth_data)
        invalidate_banned_ips_cache()
    return jsonify({"success": True})

@app.route('/api/admin/ips/<ip>', methods=['DELETE'])
@require_admin_login
def admin_unban_ip(ip):
    auth_data = load_auth()
    if "banned_ips" in auth_data and ip in auth_data["banned_ips"]:
        auth_data["banned_ips"].remove(ip)
        save_auth(auth_data)
        invalidate_banned_ips_cache()
    return jsonify({"success": True})

@app.route('/api/admin/logs')
@require_admin_login
def admin_get_logs():
    analytics = load_analytics()
    global_logs = []
    for r in analytics.get("requests", []):
        global_logs.append({
            "timestamp": r.get("timestamp"), "username": r.get("username"),
            "type": "SUCCESS", "endpoint": r.get("endpoint"),
            "ip_address": r.get("ip_address", "127.0.0.1"),
            "details": f"Status: {r.get('status_code')} | Key: {r.get('api_key_label')}"
        })
    for e in analytics.get("errors", []):
        global_logs.append({
            "timestamp": e.get("timestamp"), "username": e.get("username", "anonymous"),
            "type": "ERROR", "endpoint": e.get("endpoint"),
            "ip_address": e.get("ip_address", "127.0.0.1"),
            "details": f"Err: {e.get('error')} | Trace: {e.get('traceback', '')[:100]}..."
        })
    global_logs.sort(key=lambda x: x["timestamp"] or "", reverse=True)
    return jsonify({"logs": global_logs[:200]})


# --- DATA API ENDPOINTS (KEY REQUIREMENT) ---
@app.route('/api/search')
@require_api_key
def api_search():
    query = request.args.get('q', '').strip()
    category = request.args.get('category', '').strip() or None
    bpm = request.args.get('bpm', '').strip() or None
    key = request.args.get('key', '').strip() or None
    is_preset = request.args.get('type', '').strip().lower() == 'preset'
    if not query:
        return jsonify({"error": "Missing search query parameter 'q'"}), 400
    try:
        results = search_splice_max(query, category, bpm, key, is_preset)
        return jsonify({"count": len(results), "results": results})
    except Exception as e:
        tb = traceback.format_exc()
        log_error(request.path, str(e), tb, username=request.username)
        return jsonify({"error": f"Search failed: {str(e)}"}), 500

@app.route('/api/sample/<uuid_val>')
@require_api_key
def api_sample_metadata(uuid_val):
    try:
        sample = samples_metadata_cache.get(uuid_val)
        if not sample:
            search_splice_max(uuid_val)
            sample = samples_metadata_cache.get(uuid_val)
        if not sample:
            return jsonify({"error": f"Sample with UUID {uuid_val} not found."}), 404
        return jsonify(sample)
    except Exception as e:
        tb = traceback.format_exc()
        log_error(request.path, str(e), tb, username=request.username)
        return jsonify({"error": f"Failed to get metadata: {str(e)}"}), 500

@app.route('/api/decrypted-audio/<uuid_val>')
@require_api_key
def api_decrypted_audio(uuid_val):
    fmt = request.args.get('format', 'mp3').lower()
    try:
        sample = samples_metadata_cache.get(uuid_val)
        if not sample:
            search_splice_max(uuid_val)
            sample = samples_metadata_cache.get(uuid_val)
        if not sample:
            return jsonify({"error": "Sample not found. Please search for it first."}), 404
        import urllib.parse
        base_name = sample.get('name', uuid_val)
        for ext_to_strip in ['.wav', '.mp3']:
            if base_name.lower().endswith(ext_to_strip):
                base_name = base_name[:-len(ext_to_strip)]
        content_bytes, mimetype, cache_filename = get_cached_or_decrypt(sample, fmt)
        ext = cache_filename.rsplit('.', 1)[-1]
        filename = f"{base_name}.{ext}"
        safe_filename = filename.replace('"', '\\"')
        encoded_filename = urllib.parse.quote(filename)
        return Response(content_bytes, mimetype=mimetype, headers={"Content-Disposition": f'attachment; filename="{safe_filename}"; filename*=UTF-8\'\'{encoded_filename}'})
    except Exception as e:
        tb = traceback.format_exc()
        log_error(request.path, str(e), tb, username=request.username)
        return jsonify({"error": f"Failed to decrypt audio: {str(e)}"}), 500

# --- WEB APP FRONTEND ENDPOINTS ---
@app.route('/api/web/search')
@require_login
def api_web_search():
    query = request.args.get('q', '').strip()
    category = request.args.get('category', '').strip() or None
    bpm = request.args.get('bpm', '').strip() or None
    key = request.args.get('key', '').strip() or None
    is_preset = request.args.get('type', '').strip().lower() == 'preset'
    plugin = request.args.get('plugin', '').strip() or None
    if not query:
        return jsonify({"error": "Missing search query parameter 'q'"}), 400
    try:
        search_query = query
        if is_preset and plugin:
            search_query = f"{plugin} {query}"
        results = search_splice_max(search_query, category, bpm, key, is_preset)
        return jsonify({"count": len(results), "results": results})
    except Exception as e:
        tb = traceback.format_exc()
        log_error(request.path, str(e), tb, username=session.get('username'))
        return jsonify({"error": f"Search failed: {str(e)}"}), 500

@app.route('/api/web/decrypted-audio/<uuid_val>')
@require_login
def api_web_decrypted_audio(uuid_val):
    fmt = request.args.get('format', 'mp3').lower()
    try:
        sample = samples_metadata_cache.get(uuid_val)
        if not sample:
            search_splice_max(uuid_val)
            sample = samples_metadata_cache.get(uuid_val)
        if not sample:
            return jsonify({"error": "Sample not found."}), 404
        import urllib.parse
        base_name = sample.get('name', uuid_val)
        for ext_to_strip in ['.wav', '.mp3']:
            if base_name.lower().endswith(ext_to_strip):
                base_name = base_name[:-len(ext_to_strip)]
        content_bytes, mimetype, cache_filename = get_cached_or_decrypt(sample, fmt)
        ext = cache_filename.rsplit('.', 1)[-1]
        filename = f"{base_name}.{ext}"
        safe_filename = filename.replace('"', '\\"')
        encoded_filename = urllib.parse.quote(filename)
        return Response(content_bytes, mimetype=mimetype, headers={"Content-Disposition": f'attachment; filename="{safe_filename}"; filename*=UTF-8\'\'{encoded_filename}'})
    except Exception as e:
        tb = traceback.format_exc()
        log_error(request.path, str(e), tb, username=session.get('username'))
        return jsonify({"error": str(e)}), 500

@app.route('/api/web/favorites', methods=['GET'])
def get_web_favorites():
    if 'username' not in session:
        return jsonify({"favorites": []})
    username = session['username']
    auth_data = load_auth()
    user = auth_data["users"].get(username, {})
    favorites = user.get("favorites", [])
    return jsonify({"favorites": favorites})

@app.route('/api/web/favorites/toggle', methods=['POST'])
def toggle_web_favorite():
    if 'username' not in session:
        return jsonify({"error": "Please sign in to favorite sounds"}), 401
    data = request.get_json() or {}
    sample = data.get('sample')
    if not sample or 'uuid' not in sample:
        return jsonify({"error": "Invalid sample metadata"}), 400
    username = session['username']
    auth_data = load_auth()
    user = auth_data["users"].get(username)
    if not user:
        return jsonify({"error": "User not found"}), 404
    if "favorites" not in user:
        user["favorites"] = []
    uuid_val = sample['uuid']
    existing = next((f for f in user["favorites"] if f.get('uuid') == uuid_val), None)
    if existing:
        user["favorites"] = [f for f in user["favorites"] if f.get('uuid') != uuid_val]
        action = "removed"
    else:
        user["favorites"].append(sample)
        action = "added"
    save_auth(auth_data)
    return jsonify({"success": True, "action": action, "favorites": user["favorites"]})


# --- COMMUNITY SYSTEM UTILITIES & ELO LOGIC ---
def recalculate_elo():
    battles_data = load_beat_battles()
    profiles_data = load_profiles()
    auth_data = load_auth()
    user_stats = {}
    for username in auth_data.get("users", {}).keys():
        user_stats[username] = {"elo": 0, "wins": 0, "upvotes": 0, "downvotes": 0}
    for battle in battles_data.get("battles", []):
        winner = battle.get("winner")
        if winner and winner in user_stats:
            user_stats[winner]["wins"] += 1
        for track in battle.get("tracks", []):
            author = track.get("username")
            if not author or author not in user_stats:
                continue
            votes = track.get("votes", {})
            for voter, val in votes.items():
                if val == 1:
                    user_stats[author]["upvotes"] += 1
                elif val == -1:
                    user_stats[author]["downvotes"] += 1
    leaderboard = []
    for username, stats in user_stats.items():
        stats["elo"] = (stats["wins"] * 50) + (stats["upvotes"] * 10)
        if username not in profiles_data["profiles"]:
            profiles_data["profiles"][username] = {}
        profiles_data["profiles"][username]["elo"] = stats["elo"]
        profiles_data["profiles"][username]["wins"] = stats["wins"]
        profiles_data["profiles"][username]["upvotes"] = stats["upvotes"]
        profiles_data["profiles"][username]["downvotes"] = stats["downvotes"]
        leaderboard.append({"username": username, "elo": stats["elo"], "wins": stats["wins"], "upvotes": stats["upvotes"], "downvotes": stats["downvotes"]})
    leaderboard.sort(key=lambda x: (x["elo"], x["upvotes"], x["wins"]), reverse=True)
    for rank_idx, entry in enumerate(leaderboard):
        uname = entry["username"]
        profiles_data["profiles"][uname]["global_rank"] = rank_idx + 1
        entry["global_rank"] = rank_idx + 1
    save_profiles(profiles_data)
    return leaderboard

def check_and_finalize_battles():
    battles_data = load_beat_battles()
    profiles_data = load_profiles()
    now_str = datetime.datetime.utcnow().isoformat() + 'Z'
    modified = False
    for battle in battles_data.get("battles", []):
        if battle.get("status") == "active":
            deadline = battle.get("deadline")
            if deadline and now_str > deadline:
                battle["status"] = "completed"
                modified = True
                best_score = -999999
                winner = None
                earliest_submission = None
                for track in battle.get("tracks", []):
                    votes = track.get("votes", {})
                    net_score = sum(1 if v == 1 else -1 for v in votes.values())
                    created_at = track.get("created_at", "")
                    if net_score > best_score:
                        best_score = net_score
                        winner = track.get("username")
                        earliest_submission = created_at
                    elif net_score == best_score:
                        if not earliest_submission or (created_at and created_at < earliest_submission):
                            winner = track.get("username")
                            earliest_submission = created_at
                battle["winner"] = winner
                if winner:
                    if "acknowledgements" not in profiles_data:
                        profiles_data["acknowledgements"] = {}
                    if winner not in profiles_data["acknowledgements"]:
                        profiles_data["acknowledgements"][winner] = []
                    profiles_data["acknowledgements"][winner].append({
                        "id": str(uuid.uuid4()), "battle_id": battle["id"],
                        "battle_title": battle["title"], "acknowledged": False
                    })
    if modified:
        save_beat_battles(battles_data)
        save_profiles(profiles_data)
        recalculate_elo()


# --- COMMUNITY PORTAL ENDPOINTS ---

# Upload folders use PARENT directory static for shared access
UPLOAD_FOLDER_BATTLES = os.path.join(PARENT_DIR, 'static', 'uploads', 'battles')
UPLOAD_FOLDER_PFPS = os.path.join(PARENT_DIR, 'static', 'uploads', 'pfps')
UPLOAD_FOLDER_SERVERS = os.path.join(PARENT_DIR, 'static', 'uploads', 'servers')
os.makedirs(UPLOAD_FOLDER_BATTLES, exist_ok=True)
os.makedirs(UPLOAD_FOLDER_PFPS, exist_ok=True)
os.makedirs(UPLOAD_FOLDER_SERVERS, exist_ok=True)

# Serve parent static files for uploads — with path traversal protection
@app.route('/parent-static/<path:filename>')
def parent_static(filename):
    import mimetypes
    from flask import safe_join
    target_dir = os.path.normpath(os.path.join(PARENT_DIR, 'static'))
    try:
        full_path = safe_join(target_dir, filename)
    except Exception:
        full_path = None
    if not full_path or not os.path.isfile(full_path):
        return jsonify({"error": "Forbidden or Not Found"}), 404
    mime_type = mimetypes.guess_type(full_path)[0] or 'application/octet-stream'
    with open(full_path, 'rb') as f:
        return Response(f.read(), mimetype=mime_type)


# 1. PROFILE ENDPOINTS
@app.route('/api/profile', methods=['GET'])
@require_login
def api_get_profile():
    username = session['username']
    profiles_data = load_profiles()
    auth_data = load_auth()
    user_auth = auth_data["users"].get(username, {})
    recalculate_elo()
    profiles_data = load_profiles()
    profile = profiles_data["profiles"].get(username, {"elo": 0, "wins": 0, "upvotes": 0, "downvotes": 0, "global_rank": 999, "bio": "", "socials": {}, "pfp": ""})
    return jsonify({"username": username, "email": user_auth.get("email"), "role": user_auth.get("role", "user"), "profile": profile})

@app.route('/api/profile/update', methods=['POST'])
@require_login
def api_update_profile():
    try:
        username = session['username']
        data = request.get_json() or {}
        bio = data.get('bio', '')
        socials = data.get('socials', {})
        profiles_data = load_profiles()
        if username not in profiles_data["profiles"]:
            profiles_data["profiles"][username] = {"elo": 0, "wins": 0, "upvotes": 0, "downvotes": 0, "global_rank": 999, "pfp": ""}
        profiles_data["profiles"][username]["bio"] = bio
        profiles_data["profiles"][username]["socials"] = socials
        save_profiles(profiles_data)
        return jsonify({"success": True})
    except Exception as e:
        tb = traceback.format_exc()
        log_error(request.path, str(e), tb, username=session.get('username'))
        return jsonify({"error": f"Failed to update profile: {str(e)}"}), 500

@app.route('/api/profile/pfp', methods=['POST'])
@require_login
def api_upload_pfp():
    try:
        username = session['username']
        if 'pfp' not in request.files:
            return jsonify({"error": "No file uploaded"}), 400
        file = request.files['pfp']
        if file.filename == '':
            return jsonify({"error": "Empty filename"}), 400
        ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else 'png'
        allowed_exts = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        if ext not in allowed_exts:
            return jsonify({"error": f"Unsupported file type: .{ext}"}), 400
        # MIME type validation
        allowed_mimes = {'image/png', 'image/jpeg', 'image/gif', 'image/webp'}
        if file.content_type not in allowed_mimes:
            return jsonify({"error": "Invalid image file type"}), 400
        os.makedirs(UPLOAD_FOLDER_PFPS, exist_ok=True)
        filename = secure_filename(f"pfp_{username}_{secrets.token_hex(4)}.{ext}")
        file.save(os.path.join(UPLOAD_FOLDER_PFPS, filename))
        profiles_data = load_profiles()
        if username not in profiles_data["profiles"]:
            profiles_data["profiles"][username] = {"elo": 0, "wins": 0, "upvotes": 0, "downvotes": 0, "global_rank": 999}
        profiles_data["profiles"][username]["pfp"] = f"/static/uploads/pfps/{filename}"
        save_profiles(profiles_data)
        return jsonify({"success": True, "pfp_url": f"/static/uploads/pfps/{filename}"})
    except Exception as e:
        tb = traceback.format_exc()
        log_error(request.path, str(e), tb, username=session.get('username'))
        return jsonify({"error": f"Upload failed: {str(e)}"}), 500

@app.route('/api/profile/hovercard/<target_user>')
@require_login
def api_profile_hovercard(target_user):
    profiles_data = load_profiles()
    auth_data = load_auth()
    if target_user not in auth_data["users"]:
        return jsonify({"error": "User not found"}), 404
    profile = profiles_data["profiles"].get(target_user, {"elo": 0, "wins": 0, "upvotes": 0, "downvotes": 0, "global_rank": 999, "bio": "", "socials": {}, "pfp": ""})
    return jsonify({"username": target_user, "profile": profile})

@app.route('/api/profile/announcement/acknowledge', methods=['POST'])
@require_login
def api_ack_announcement():
    username = session['username']
    data = request.get_json() or {}
    ann_id = data.get('id')
    profiles_data = load_profiles()
    modified = False
    if "acknowledgements" in profiles_data and username in profiles_data["acknowledgements"]:
        for ack in profiles_data["acknowledgements"][username]:
            if ack["id"] == ann_id:
                ack["acknowledged"] = True
                modified = True
    if modified:
        save_profiles(profiles_data)
    return jsonify({"success": True})

# 2. BEAT BATTLES ENDPOINTS
@app.route('/api/battles', methods=['GET'])
@require_login
def api_get_battles():
    check_and_finalize_battles()
    battles_data = load_beat_battles()
    username = session.get('username')
    visible_battles = []
    for b in battles_data.get("battles", []):
        is_creator = username and b.get("creator") == username
        is_member = username and any(t.get("username") == username for t in b.get("tracks", []))
        is_participant = username and username in b.get("participants", [])
        if b.get("is_public") or is_creator or is_member or is_participant:
            visible_battles.append(b)
    return jsonify({"battles": visible_battles})

@app.route('/api/battles/create', methods=['POST'])
@require_login
def api_create_battle():
    username = session['username']
    title = request.form.get('title', '').strip()
    description = request.form.get('description', '').strip()
    key = request.form.get('key', 'Cmaj').strip()
    style = request.form.get('style', 'Lofi').strip()
    deadline = request.form.get('deadline', '').strip()
    is_public = request.form.get('is_public', 'true').lower() == 'true'
    if not title or not deadline:
        return jsonify({"error": "Title and deadline are required"}), 400
    if 'sample' not in request.files:
        return jsonify({"error": "Reference sample is required"}), 400
    file = request.files['sample']
    if file.filename == '':
        return jsonify({"error": "Empty reference sample filename"}), 400
    ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else 'mp3'
    sample_filename = secure_filename(f"battle_ref_{username}_{secrets.token_hex(4)}.{ext}")
    file.save(os.path.join(UPLOAD_FOLDER_BATTLES, sample_filename))
    battles_data = load_beat_battles()
    battle_id = str(uuid.uuid4())
    invite_code = f"invite_{secrets.token_urlsafe(8)}"
    new_battle = {
        "id": battle_id, "title": title, "description": description, "creator": username,
        "sample_url": f"/static/uploads/battles/{sample_filename}", "key": key, "style": style,
        "deadline": deadline + ":00Z", "is_public": is_public, "invite_code": invite_code,
        "status": "active", "winner": None, "tracks": [], "participants": [username]
    }
    battles_data["battles"].append(new_battle)
    save_beat_battles(battles_data)
    return jsonify({"success": True, "battle_id": battle_id, "invite_code": invite_code})

@app.route('/api/battles/join/<code>')
@require_login
def api_join_battle(code):
    username = session['username']
    battles_data = load_beat_battles()
    found_battle = next((b for b in battles_data.get("battles", []) if b.get("invite_code") == code), None)
    if not found_battle:
        return jsonify({"error": "Invalid battle invite code"}), 404
    if "participants" not in found_battle:
        found_battle["participants"] = []
    if username not in found_battle["participants"]:
        found_battle["participants"].append(username)
    save_beat_battles(battles_data)
    return jsonify({"success": True, "battle_id": found_battle["id"], "title": found_battle["title"]})

@app.route('/api/battles/submit', methods=['POST'])
@require_login
def api_submit_track():
    username = session['username']
    battle_id = request.form.get('battle_id')
    if 'track' not in request.files:
        return jsonify({"error": "No track file uploaded"}), 400
    file = request.files['track']
    if file.filename == '':
        return jsonify({"error": "Empty filename"}), 400
    battles_data = load_beat_battles()
    battle = next((b for b in battles_data.get("battles", []) if b["id"] == battle_id), None)
    if not battle:
        return jsonify({"error": "Battle not found"}), 404
    if battle["status"] != "active":
        return jsonify({"error": "This battle is already completed"}), 400
    battle["tracks"] = [t for t in battle["tracks"] if t.get("username") != username]
    ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else 'mp3'
    track_filename = secure_filename(f"entry_{battle_id}_{username}_{secrets.token_hex(4)}.{ext}")
    file.save(os.path.join(UPLOAD_FOLDER_BATTLES, track_filename))
    new_track = {"id": str(uuid.uuid4()), "username": username, "audio_url": f"/static/uploads/battles/{track_filename}", "created_at": datetime.datetime.utcnow().isoformat() + 'Z', "votes": {}, "comments": []}
    battle["tracks"].append(new_track)
    save_beat_battles(battles_data)
    recalculate_elo()
    return jsonify({"success": True})

@app.route('/api/battles/vote', methods=['POST'])
@require_login
def api_vote_track():
    username = session['username']
    data = request.get_json() or {}
    battle_id = data.get('battle_id')
    track_id = data.get('track_id')
    vote_val = data.get('vote')
    if vote_val not in [1, -1, 0]:
        return jsonify({"error": "Invalid vote value"}), 400
    battles_data = load_beat_battles()
    battle = next((b for b in battles_data.get("battles", []) if b["id"] == battle_id), None)
    if not battle:
        return jsonify({"error": "Battle not found"}), 404
    track = next((t for t in battle.get("tracks", []) if t["id"] == track_id), None)
    if not track:
        return jsonify({"error": "Track not found"}), 404
    if vote_val == 0:
        if username in track["votes"]:
            del track["votes"][username]
    else:
        track["votes"][username] = vote_val
    save_beat_battles(battles_data)
    recalculate_elo()
    return jsonify({"success": True})

@app.route('/api/battles/comment', methods=['POST'])
@require_login
def api_comment_track():
    username = session['username']
    data = request.get_json() or {}
    battle_id = data.get('battle_id')
    track_id = data.get('track_id')
    comment_text = data.get('comment', '').strip()
    if not comment_text:
        return jsonify({"error": "Comment text cannot be empty"}), 400
    battles_data = load_beat_battles()
    battle = next((b for b in battles_data.get("battles", []) if b["id"] == battle_id), None)
    if not battle:
        return jsonify({"error": "Battle not found"}), 404
    track = next((t for t in battle.get("tracks", []) if t["id"] == track_id), None)
    if not track:
        return jsonify({"error": "Track not found"}), 404
    new_comment = {"username": username, "comment": comment_text, "created_at": datetime.datetime.utcnow().isoformat() + 'Z'}
    track["comments"].append(new_comment)
    save_beat_battles(battles_data)
    return jsonify({"success": True, "comment": new_comment})

@app.route('/api/battles/leaderboard')
@require_login
def api_get_leaderboard():
    leaderboard = recalculate_elo()
    return jsonify({"leaderboard": leaderboard})

# 3. DISCORD-LIKE SERVERS ENDPOINTS
@app.route('/api/servers', methods=['GET'])
@require_login
def api_get_servers():
    username = session['username']
    servers_data = load_servers()
    my_servers = []
    
    for s in servers_data.get("servers", []):
        if username in s.get("members", {}):
            s_copy = dict(s)
            if "messages" in s_copy:
                s_copy.pop("messages")
                
            user_roles = s.get("members", {}).get(username, [])
            is_owner = s.get("owner") == username
            
            # Filter categories
            allowed_categories = []
            for cat in s.get("categories", []):
                cat_roles = cat.get("allowed_roles", [])
                if not cat_roles or is_owner or any(rid in cat_roles for rid in user_roles):
                    allowed_categories.append(cat)
            s_copy["categories"] = allowed_categories
            
            # Filter channels
            allowed_channels = []
            for chan in s.get("channels", []):
                chan_roles = chan.get("allowed_roles", [])
                if not chan_roles and chan.get("permission_synced") and chan.get("category_id"):
                    parent_cat = next((c for c in s.get("categories", []) if c["id"] == chan["category_id"]), None)
                    if parent_cat:
                        chan_roles = parent_cat.get("allowed_roles", [])
                        
                if not chan_roles or is_owner or any(rid in chan_roles for rid in user_roles):
                    parent_cat_id = chan.get("category_id")
                    parent_visible = True
                    if parent_cat_id:
                        parent_cat = next((c for c in s.get("categories", []) if c["id"] == parent_cat_id), None)
                        if parent_cat:
                            cat_roles = parent_cat.get("allowed_roles", [])
                            if cat_roles and not is_owner and not any(rid in cat_roles for rid in user_roles):
                                parent_visible = False
                    if parent_visible:
                        allowed_channels.append(chan)
            s_copy["channels"] = allowed_channels
            my_servers.append(s_copy)
            
    return jsonify({"servers": my_servers})

@app.route('/api/servers/create', methods=['POST'])
@require_login
def api_create_server():
    try:
        username = session['username']
        name = request.form.get('name', '').strip()
        if not name:
            return jsonify({"error": "Server name is required"}), 400
        icon_url = "/static/placeholder-art.png"
        if 'icon' in request.files:
            file = request.files['icon']
            if file.filename != '':
                ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else 'png'
                os.makedirs(UPLOAD_FOLDER_SERVERS, exist_ok=True)
                icon_filename = secure_filename(f"server_{secrets.token_hex(4)}.{ext}")
                file.save(os.path.join(UPLOAD_FOLDER_SERVERS, icon_filename))
                icon_url = f"/static/uploads/servers/{icon_filename}"
        servers_data = load_servers()
        server_id = str(uuid.uuid4())
        invite_code = f"srv_{secrets.token_urlsafe(8)}"
        new_server = {
            "id": server_id, "name": name, "icon_url": icon_url, "owner": username,
            "invite_code": invite_code,
            "roles": [{"id": "role-mod", "name": "Moderator", "color": "#e74c3c", "position": 0, "show_separately": True, "permissions": ["manage_channels", "kick_members", "ban_members", "view_channels", "send_messages", "manage_messages", "manage_server"]}],
            "members": {username: ["role-mod"]}, "banned_users": [],
            "categories": [{"id": "cat-general", "name": "Text Channels", "position": 0, "allowed_roles": []}],
            "channels": [{"id": "chan-general", "category_id": "cat-general", "name": "general", "position": 0, "slowmode": 0, "locked": False, "allowed_roles": [], "permission_synced": True}],
            "messages": []
        }
        servers_data["servers"].append(new_server)
        save_servers(servers_data)
        return jsonify({"success": True, "server_id": server_id})
    except Exception as e:
        tb = traceback.format_exc()
        log_error(request.path, str(e), tb, username=session.get('username'))
        return jsonify({"error": f"Failed to create server: {str(e)}"}), 500

@app.route('/api/servers/join/<code>', methods=['POST'])
@require_login
def api_join_server(code):
    username = session['username']
    servers_data = load_servers()
    server = next((s for s in servers_data.get("servers", []) if s.get("invite_code") == code), None)
    if not server:
        return jsonify({"error": "Invalid server invite code"}), 404
    if username in server.get("banned_users", []):
        return jsonify({"error": "You have been banned from this server"}), 403
    if username not in server["members"]:
        server["members"][username] = []
        save_servers(servers_data)
    return jsonify({"success": True, "server_id": server["id"], "name": server["name"]})

@app.route('/api/servers/channels/create', methods=['POST'])
@require_login
def api_create_channel():
    username = session['username']
    data = request.get_json() or {}
    server_id = data.get('server_id')
    item_type = data.get('type')
    name = data.get('name', '').strip()
    category_id = data.get('category_id')
    if not name:
        return jsonify({"error": "Name is required"}), 400
    servers_data = load_servers()
    server = next((s for s in servers_data.get("servers", []) if s["id"] == server_id), None)
    if not server:
        return jsonify({"error": "Server not found"}), 404
    is_owner = server["owner"] == username
    user_roles = server["members"].get(username, [])
    has_perm = is_owner or any("manage_channels" in r.get("permissions", []) for r in server["roles"] if r["id"] in user_roles)
    if not has_perm:
        return jsonify({"error": "You do not have permission to manage channels"}), 403
    item_id = f"{item_type}-{str(uuid.uuid4())[:8]}"
    if item_type == "category":
        max_pos = max((c.get("position", 0) for c in server["categories"]), default=-1)
        server["categories"].append({"id": item_id, "name": name, "position": max_pos + 1, "allowed_roles": []})
    else:
        max_pos = max((c.get("position", 0) for c in server["channels"] if c.get("category_id") == category_id), default=-1)
        # Inherit permissions from parent category if synced
        parent_cat = next((c for c in server["categories"] if c["id"] == category_id), None)
        inherited_roles = parent_cat.get("allowed_roles", []) if parent_cat else []
        server["channels"].append({"id": item_id, "category_id": category_id, "name": name.lower().replace(" ", "-"), "position": max_pos + 1, "slowmode": 0, "locked": False, "allowed_roles": inherited_roles, "permission_synced": True})
    save_servers(servers_data)
    return jsonify({"success": True})

@app.route('/api/servers/channels/modify', methods=['POST'])
@require_login
def api_modify_channel():
    username = session['username']
    data = request.get_json() or {}
    server_id = data.get('server_id')
    channel_id = data.get('channel_id')
    slowmode = data.get('slowmode', 0)
    locked = data.get('locked', False)
    allowed_roles = data.get('allowed_roles', [])
    servers_data = load_servers()
    server = next((s for s in servers_data.get("servers", []) if s["id"] == server_id), None)
    if not server:
        return jsonify({"error": "Server not found"}), 404
    is_owner = server["owner"] == username
    user_roles = server["members"].get(username, [])
    has_perm = is_owner or any("manage_channels" in r.get("permissions", []) for r in server["roles"] if r["id"] in user_roles)
    if not has_perm:
        return jsonify({"error": "You do not have permission to modify channels"}), 403
    channel = next((c for c in server["channels"] if c["id"] == channel_id), None)
    if not channel:
        return jsonify({"error": "Channel not found"}), 404
    channel["slowmode"] = int(slowmode)
    channel["locked"] = bool(locked)
    # Ensure allowed roles actually exist on this server
    server_role_ids = {r["id"] for r in server.get("roles", [])}
    channel["allowed_roles"] = [rid for rid in allowed_roles if rid in server_role_ids]
    save_servers(servers_data)
    return jsonify({"success": True})

@app.route('/api/servers/messages/<server_id>/<channel_id>', methods=['GET'])
@require_login
def api_get_server_messages(server_id, channel_id):
    username = session['username']
    servers_data = load_servers()
    server = next((s for s in servers_data.get("servers", []) if s["id"] == server_id), None)
    if not server:
        return jsonify({"error": "Server not found"}), 404
    if username not in server["members"]:
        return jsonify({"error": "You are not a member of this server"}), 403
    channel = next((c for c in server["channels"] if c["id"] == channel_id), None)
    if not channel:
        return jsonify({"error": "Channel not found"}), 404
    # Check channel-level permissions, falling back to category-level
    effective_roles = channel.get("allowed_roles", [])
    if not effective_roles and channel.get("permission_synced") and channel.get("category_id"):
        parent_cat = next((c for c in server.get("categories", []) if c["id"] == channel["category_id"]), None)
        if parent_cat:
            effective_roles = parent_cat.get("allowed_roles", [])
    if effective_roles:
        user_roles = server["members"].get(username, [])
        is_owner = server["owner"] == username
        has_role = is_owner or any(rid in effective_roles for rid in user_roles)
        if not has_role:
            return jsonify({"error": "You do not have permission to view this channel"}), 403
    messages = [m for m in server.get("messages", []) if m.get("channel_id") == channel_id]
    return jsonify({"messages": messages})

@app.route('/api/servers/messages/send', methods=['POST'])
@require_login
def api_send_server_message():
    username = session['username']
    data = request.get_json() or {}
    server_id = data.get('server_id')
    channel_id = data.get('channel_id')
    content = data.get('content', '').strip()
    if not content:
        return jsonify({"error": "Message content cannot be empty"}), 400
    servers_data = load_servers()
    server = next((s for s in servers_data.get("servers", []) if s["id"] == server_id), None)
    if not server:
        return jsonify({"error": "Server not found"}), 404
    if username not in server["members"]:
        return jsonify({"error": "You are not a member of this server"}), 403
    channel = next((c for c in server["channels"] if c["id"] == channel_id), None)
    if not channel:
        return jsonify({"error": "Channel not found"}), 404
    is_owner = server["owner"] == username
    user_roles = server["members"].get(username, [])
    is_mod = is_owner or any("manage_channels" in r.get("permissions", []) for r in server["roles"] if r["id"] in user_roles)
    if channel.get("locked") and not is_mod:
        return jsonify({"error": "This channel is locked."}), 403
    slowmode = channel.get("slowmode", 0)
    if slowmode > 0 and not is_mod:
        now = datetime.datetime.utcnow()
        last_msg = next((m for m in reversed(server.get("messages", [])) if m.get("channel_id") == channel_id and m.get("username") == username), None)
        if last_msg:
            try:
                last_time = datetime.datetime.fromisoformat(last_msg["created_at"].replace('Z', ''))
                diff = (now - last_time).total_seconds()
                if diff < slowmode:
                    return jsonify({"error": f"Slowmode active. Wait {int(slowmode - diff)}s."}), 429
            except Exception:
                pass
    new_message = {"id": str(uuid.uuid4()), "channel_id": channel_id, "username": username, "content": content, "created_at": datetime.datetime.utcnow().isoformat() + 'Z'}
    server.setdefault("messages", []).append(new_message)
    save_servers(servers_data)
    return jsonify({"success": True, "message": new_message})

@app.route('/api/servers/roles/create', methods=['POST'])
@require_login
def api_create_server_role():
    username = session['username']
    data = request.get_json() or {}
    server_id = data.get('server_id')
    name = data.get('name', '').strip()
    color = data.get('color', '#9b59b6')
    permissions = data.get('permissions', [])
    if not name:
        return jsonify({"error": "Role name is required"}), 400
    servers_data = load_servers()
    server = next((s for s in servers_data.get("servers", []) if s["id"] == server_id), None)
    if not server:
        return jsonify({"error": "Server not found"}), 404
    if server["owner"] != username:
        return jsonify({"error": "Only the server owner can create roles"}), 403
    role_id = f"role-{str(uuid.uuid4())[:8]}"
    show_separately = data.get('show_separately', False)
    max_pos = max((r.get("position", 0) for r in server["roles"]), default=-1)
    server["roles"].append({"id": role_id, "name": name, "color": color, "permissions": permissions, "position": max_pos + 1, "show_separately": bool(show_separately)})
    save_servers(servers_data)
    return jsonify({"success": True})

@app.route('/api/servers/roles/assign', methods=['POST'])
@require_login
def api_assign_server_role():
    username = session['username']
    data = request.get_json() or {}
    server_id = data.get('server_id')
    target_username = data.get('username')
    role_id = data.get('role_id')
    action = data.get('action')
    servers_data = load_servers()
    server = next((s for s in servers_data.get("servers", []) if s["id"] == server_id), None)
    if not server:
        return jsonify({"error": "Server not found"}), 404
    if server["owner"] != username:
        return jsonify({"error": "Only the server owner can assign roles"}), 403
    if target_username not in server["members"]:
        return jsonify({"error": "User is not a member"}), 404
    if action == "add":
        if role_id not in server["members"][target_username]:
            server["members"][target_username].append(role_id)
    else:
        if role_id in server["members"][target_username]:
            server["members"][target_username].remove(role_id)
    save_servers(servers_data)
    return jsonify({"success": True})

@app.route('/api/servers/members/kick', methods=['POST'])
@require_login
def api_kick_server_member():
    username = session['username']
    data = request.get_json() or {}
    server_id = data.get('server_id')
    target_username = data.get('username')
    servers_data = load_servers()
    server = next((s for s in servers_data.get("servers", []) if s["id"] == server_id), None)
    if not server:
        return jsonify({"error": "Server not found"}), 404
    is_owner = server["owner"] == username
    user_roles = server["members"].get(username, [])
    has_perm = is_owner or any("kick_members" in r.get("permissions", []) for r in server["roles"] if r["id"] in user_roles)
    if not has_perm:
        return jsonify({"error": "You do not have permission to kick members"}), 403
    if target_username == server["owner"]:
        return jsonify({"error": "You cannot kick the owner"}), 400
    if target_username in server["members"]:
        del server["members"][target_username]
        save_servers(servers_data)
    return jsonify({"success": True})

@app.route('/api/servers/members/ban', methods=['POST'])
@require_login
def api_ban_server_member():
    username = session['username']
    data = request.get_json() or {}
    server_id = data.get('server_id')
    target_username = data.get('username')
    servers_data = load_servers()
    server = next((s for s in servers_data.get("servers", []) if s["id"] == server_id), None)
    if not server:
        return jsonify({"error": "Server not found"}), 404
    is_owner = server["owner"] == username
    user_roles = server["members"].get(username, [])
    has_perm = is_owner or any("ban_members" in r.get("permissions", []) for r in server["roles"] if r["id"] in user_roles)
    if not has_perm:
        return jsonify({"error": "You do not have permission to ban members"}), 403
    if target_username == server["owner"]:
        return jsonify({"error": "You cannot ban the owner"}), 400
    if target_username in server["members"]:
        del server["members"][target_username]
    if target_username not in server.get("banned_users", []):
        server.setdefault("banned_users", []).append(target_username)
    save_servers(servers_data)
    return jsonify({"success": True})

# --- SERVER REORDER/MOVE/INFO ENDPOINTS ---
@app.route('/api/servers/channels/reorder', methods=['POST'])
@require_login
def api_reorder_channels():
    username = session['username']
    data = request.get_json() or {}
    server_id = data.get('server_id')
    items = data.get('items', [])  # [{id, position, category_id}]
    servers_data = load_servers()
    server = next((s for s in servers_data.get("servers", []) if s["id"] == server_id), None)
    if not server:
        return jsonify({"error": "Server not found"}), 404
    is_owner = server["owner"] == username
    user_roles = server["members"].get(username, [])
    has_perm = is_owner or any("manage_channels" in r.get("permissions", []) for r in server["roles"] if r["id"] in user_roles)
    if not has_perm:
        return jsonify({"error": "Permission denied"}), 403
    for item in items:
        chan = next((c for c in server["channels"] if c["id"] == item["id"]), None)
        if chan:
            chan["position"] = item.get("position", 0)
            if "category_id" in item:
                chan["category_id"] = item["category_id"]
    save_servers(servers_data)
    return jsonify({"success": True})

@app.route('/api/servers/categories/reorder', methods=['POST'])
@require_login
def api_reorder_categories():
    username = session['username']
    data = request.get_json() or {}
    server_id = data.get('server_id')
    items = data.get('items', [])  # [{id, position}]
    servers_data = load_servers()
    server = next((s for s in servers_data.get("servers", []) if s["id"] == server_id), None)
    if not server:
        return jsonify({"error": "Server not found"}), 404
    is_owner = server["owner"] == username
    user_roles = server["members"].get(username, [])
    has_perm = is_owner or any("manage_channels" in r.get("permissions", []) for r in server["roles"] if r["id"] in user_roles)
    if not has_perm:
        return jsonify({"error": "Permission denied"}), 403
    for item in items:
        cat = next((c for c in server["categories"] if c["id"] == item["id"]), None)
        if cat:
            cat["position"] = item.get("position", 0)
    save_servers(servers_data)
    return jsonify({"success": True})

@app.route('/api/servers/categories/modify', methods=['POST'])
@require_login
def api_modify_category():
    username = session['username']
    data = request.get_json() or {}
    server_id = data.get('server_id')
    category_id = data.get('category_id')
    name = data.get('name', '').strip()
    allowed_roles = data.get('allowed_roles', [])
    sync_children = data.get('sync_children', True)
    servers_data = load_servers()
    server = next((s for s in servers_data.get("servers", []) if s["id"] == server_id), None)
    if not server:
        return jsonify({"error": "Server not found"}), 404
    is_owner = server["owner"] == username
    user_roles = server["members"].get(username, [])
    has_perm = is_owner or any("manage_channels" in r.get("permissions", []) for r in server["roles"] if r["id"] in user_roles)
    if not has_perm:
        return jsonify({"error": "Permission denied"}), 403
    cat = next((c for c in server["categories"] if c["id"] == category_id), None)
    if not cat:
        return jsonify({"error": "Category not found"}), 404
    if name:
        cat["name"] = name
    cat["allowed_roles"] = allowed_roles
    # Sync child channels that have permission_synced=True
    if sync_children:
        for chan in server["channels"]:
            if chan.get("category_id") == category_id and chan.get("permission_synced"):
                chan["allowed_roles"] = allowed_roles
    save_servers(servers_data)
    return jsonify({"success": True})

@app.route('/api/servers/channels/move', methods=['POST'])
@require_login
def api_move_channel():
    username = session['username']
    data = request.get_json() or {}
    server_id = data.get('server_id')
    channel_id = data.get('channel_id')
    new_category_id = data.get('category_id')  # None or '' for uncategorized
    servers_data = load_servers()
    server = next((s for s in servers_data.get("servers", []) if s["id"] == server_id), None)
    if not server:
        return jsonify({"error": "Server not found"}), 404
    is_owner = server["owner"] == username
    user_roles = server["members"].get(username, [])
    has_perm = is_owner or any("manage_channels" in r.get("permissions", []) for r in server["roles"] if r["id"] in user_roles)
    if not has_perm:
        return jsonify({"error": "Permission denied"}), 403
    chan = next((c for c in server["channels"] if c["id"] == channel_id), None)
    if not chan:
        return jsonify({"error": "Channel not found"}), 404
    chan["category_id"] = new_category_id or None
    # If moving to a category, auto-sync permissions if synced
    if new_category_id and chan.get("permission_synced"):
        parent_cat = next((c for c in server["categories"] if c["id"] == new_category_id), None)
        if parent_cat:
            chan["allowed_roles"] = parent_cat.get("allowed_roles", [])
    save_servers(servers_data)
    return jsonify({"success": True})

@app.route('/api/servers/<server_id>/info')
@app.route('/api/servers/invite-info/<server_id>')
def api_server_info(server_id):
    """Public info endpoint for invite link previews"""
    servers_data = load_servers()
    server = next((s for s in servers_data.get("servers", []) if s["id"] == server_id), None)
    if not server:
        # Try finding by invite code
        server = next((s for s in servers_data.get("servers", []) if s.get("invite_code") == server_id), None)
    if not server:
        return jsonify({"error": "Server not found"}), 404
    profiles_data = load_profiles()
    now = datetime.datetime.utcnow().timestamp()
    online_count = 0
    for member_username in server.get("members", {}).keys():
        profile = profiles_data["profiles"].get(member_username, {})
        last_active = profile.get("last_active", 0)
        if now - last_active < 30:
            online_count += 1
    return jsonify({
        "id": server["id"],
        "name": server["name"],
        "icon_url": server.get("icon_url", "/static/placeholder-art.png"),
        "member_count": len(server.get("members", {})),
        "online_count": max(1, online_count),
        "invite_code": server.get("invite_code")
    })

# 4. DIRECT MESSAGES ENDPOINTS
@app.route('/api/dms', methods=['GET'])
@require_login
def api_get_dms():
    username = session['username']
    dms_data = load_dms()
    active_dms = []
    for thread_key in dms_data.get("threads", {}).keys():
        if username in thread_key.split("<->"):
            partner = thread_key.split("<->")[1] if thread_key.split("<->")[0] == username else thread_key.split("<->")[0]
            active_dms.append(partner)
    return jsonify({"dms": list(set(active_dms))})

@app.route('/api/dms/messages/<partner>', methods=['GET'])
@require_login
def api_get_dm_messages(partner):
    username = session['username']
    dms_data = load_dms()
    thread_key = f"{min(username, partner)}<->{max(username, partner)}"
    messages = dms_data.get("threads", {}).get(thread_key, [])
    return jsonify({"messages": messages})

@app.route('/api/dms/send', methods=['POST'])
@require_login
def api_send_dm():
    username = session['username']
    data = request.get_json() or {}
    recipient = data.get('recipient')
    content = data.get('content', '').strip()
    if not recipient or not content:
        return jsonify({"error": "Recipient and content are required"}), 400
    dms_data = load_dms()
    thread_key = f"{min(username, recipient)}<->{max(username, recipient)}"
    new_msg = {"id": str(uuid.uuid4()), "sender": username, "content": content, "created_at": datetime.datetime.utcnow().isoformat() + 'Z'}
    dms_data.setdefault("threads", {}).setdefault(thread_key, []).append(new_msg)
    # Create notification for recipient
    notif = {
        "id": str(uuid.uuid4()), "type": "dm", "from": username,
        "thread_key": thread_key, "preview": content[:80],
        "timestamp": datetime.datetime.utcnow().isoformat() + 'Z', "read": False
    }
    dms_data.setdefault("notifications", {}).setdefault(recipient, []).append(notif)
    # Trim notifications to last 100
    dms_data["notifications"][recipient] = dms_data["notifications"][recipient][-100:]
    save_dms(dms_data)
    return jsonify({"success": True, "message": new_msg})

# 5. WEBRTC CALLING ENDPOINTS
# In-memory cache for dynamically-fetched TURN credentials so we don't call the
# provider on every page load. Metered credentials are time-limited, so we cache
# for a window well below their lifetime.
_turn_cache = {"servers": None, "expires_at": 0}
_TURN_CACHE_SECONDS = 6 * 60 * 60  # 6 hours


def _fetch_metered_ice_servers():
    """Fetch fresh STUN+TURN credentials from Metered's free TURN service.

    Returns a list of iceServers dicts, or None if not configured / unavailable.
    The API key stays server-side; only short-lived credentials reach the client.
    """
    api_key = os.environ.get('METERED_API_KEY')
    app_name = os.environ.get('METERED_APP_NAME')
    if not api_key or not app_name:
        return None
    # Serve cached credentials if still fresh.
    now = time.time()
    if _turn_cache["servers"] and now < _turn_cache["expires_at"]:
        return _turn_cache["servers"]
    app_name = app_name.strip()
    # Accept either a bare subdomain ("myapp") or a full host ("myapp.metered.live").
    host = app_name if '.' in app_name else f"{app_name}.metered.live"
    url = f"https://{host}/api/v1/turn/credentials"
    try:
        resp = requests.get(url, params={"apiKey": api_key}, timeout=6)
        resp.raise_for_status()
        servers = resp.json()
        if isinstance(servers, list) and servers:
            _turn_cache["servers"] = servers
            _turn_cache["expires_at"] = now + _TURN_CACHE_SECONDS
            return servers
        # Unexpected (non-list / empty) response shape.
        print(f"[ice-config] Metered returned unexpected response (status {resp.status_code}); using fallback relay.")
    except requests.exceptions.RequestException:
        # Never log the exception/URL — it can contain the API key. Log status only.
        resp_status = getattr(locals().get('resp', None), 'status_code', None)
        print(f"[ice-config] Metered TURN fetch failed (status={resp_status}); using fallback relay.")
    except Exception:
        print("[ice-config] Metered TURN fetch failed (unexpected error); using fallback relay.")
    return None


@app.route('/api/webrtc/ice-config', methods=['GET'])
@require_login
def api_webrtc_ice_config():
    # STUN servers (help most peers discover their public address)
    ice_servers = [
        {"urls": [
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302",
            "stun:stun2.l.google.com:19302",
            "stun:stun3.l.google.com:19302"
        ]}
    ]
    # 1. Preferred: Metered.ca free TURN with dynamically-issued, short-lived
    #    credentials fetched securely on the server.
    metered_servers = _fetch_metered_ice_servers()
    if metered_servers:
        ice_servers.extend(metered_servers)
        return jsonify({"iceServers": ice_servers})

    # 2. Static TURN credentials provided via environment secrets.
    #    Supports comma-separated TURN_URL for multiple transports.
    turn_url = os.environ.get('TURN_URL')
    turn_user = os.environ.get('TURN_USERNAME')
    turn_cred = os.environ.get('TURN_CREDENTIAL')
    if turn_url and turn_user and turn_cred:
        urls = [u.strip() for u in turn_url.split(',') if u.strip()]
        ice_servers.append({"urls": urls, "username": turn_user, "credential": turn_cred})
        return jsonify({"iceServers": ice_servers})

    # 3. Free fallback TURN relay (OpenRelay). Best-effort; relays media when
    #    direct/STUN connections fail (symmetric NAT, mobile, firewalls).
    ice_servers.append({
        "urls": [
            "turn:openrelay.metered.ca:80",
            "turn:openrelay.metered.ca:443",
            "turn:openrelay.metered.ca:443?transport=tcp"
        ],
        "username": "openrelayproject",
        "credential": "openrelayproject"
    })
    return jsonify({"iceServers": ice_servers})


@app.route('/api/webrtc/call/initiate', methods=['POST'])
@require_login
def api_webrtc_initiate():
    username = session['username']
    data = request.get_json() or {}
    receiver = data.get('receiver')
    call_type = data.get('type', 'voice')
    sdp_offer = data.get('sdp')
    if not receiver:
        return jsonify({"error": "Missing receiver"}), 400
    dms_data = load_dms()
    for call_id, call in list(dms_data.get("active_calls", {}).items()):
        if call.get("caller") in [username, receiver] or call.get("receiver") in [username, receiver]:
            del dms_data["active_calls"][call_id]
    call_id = str(uuid.uuid4())
    dms_data.setdefault("active_calls", {})[call_id] = {
        "id": call_id, "caller": username, "receiver": receiver, "type": call_type,
        "state": "initiated", "sdp_offer": sdp_offer, "sdp_answer": None,
        "caller_candidates": [], "receiver_candidates": [],
        "last_seen": datetime.datetime.utcnow().timestamp()
    }
    save_dms(dms_data)
    return jsonify({"success": True, "call_id": call_id})

@app.route('/api/webrtc/call/respond', methods=['POST'])
@require_login
def api_webrtc_respond():
    username = session['username']
    data = request.get_json() or {}
    call_id = data.get('call_id')
    action = data.get('action')
    sdp_answer = data.get('sdp')
    dms_data = load_dms()
    call = dms_data.get("active_calls", {}).get(call_id)
    if not call:
        return jsonify({"error": "Call session not found"}), 404
    if action == "accept":
        call["state"] = "accepted"
        call["sdp_answer"] = sdp_answer
    elif action == "reject":
        call["state"] = "rejected"
    elif action == "end":
        if call_id in dms_data.get("active_calls", {}):
            del dms_data["active_calls"][call_id]
        save_dms(dms_data)
        return jsonify({"success": True})
    call["last_seen"] = datetime.datetime.utcnow().timestamp()
    save_dms(dms_data)
    return jsonify({"success": True})

@app.route('/api/webrtc/call/candidate', methods=['POST'])
@require_login
def api_webrtc_candidate():
    username = session['username']
    data = request.get_json() or {}
    call_id = data.get('call_id')
    candidate = data.get('candidate')
    dms_data = load_dms()
    call = dms_data.get("active_calls", {}).get(call_id)
    if not call:
        return jsonify({"error": "Call session not found"}), 404
    if call["caller"] == username:
        call.setdefault("caller_candidates", []).append(candidate)
    elif call["receiver"] == username:
        call.setdefault("receiver_candidates", []).append(candidate)
    call["last_seen"] = datetime.datetime.utcnow().timestamp()
    save_dms(dms_data)
    return jsonify({"success": True})

@app.route('/api/community/poll')
@require_login
def api_community_poll():
    username = session['username']
    profiles_data = load_profiles()
    if username not in profiles_data["profiles"]:
        profiles_data["profiles"][username] = {"elo": 0, "wins": 0, "upvotes": 0, "downvotes": 0, "global_rank": 999, "bio": "", "socials": {}, "pfp": ""}
    profiles_data["profiles"][username]["last_active"] = datetime.datetime.utcnow().timestamp()
    save_profiles(profiles_data)
    
    announcements = []
    if "acknowledgements" in profiles_data:
        for ack in profiles_data["acknowledgements"].get(username, []):
            if not ack.get("acknowledged"):
                announcements.append(ack)
    dms_data = load_dms()
    incoming_call = None
    active_call = None
    now = datetime.datetime.utcnow().timestamp()
    calls_to_delete = []
    for call_id, call in dms_data.get("active_calls", {}).items():
        if now - call.get("last_seen", 0) > 15:
            calls_to_delete.append(call_id)
    if calls_to_delete:
        for cid in calls_to_delete:
            if cid in dms_data["active_calls"]:
                del dms_data["active_calls"][cid]
        save_dms(dms_data)
    for call_id, call in dms_data.get("active_calls", {}).items():
        if call.get("caller") == username or call.get("receiver") == username:
            active_call = call
            if call.get("receiver") == username and call.get("state") == "initiated":
                incoming_call = {"id": call_id, "caller": call["caller"], "type": call["type"]}
            break
    if active_call:
        active_call["last_seen"] = now
        save_dms(dms_data)
    # Friend requests count
    auth_data = load_auth()
    my_user = auth_data['users'].get(username, {})
    friend_requests_in = my_user.get('friend_requests_in', [])
    # Unread DM notifications count + recent unread notifications (for browser push)
    dms_notifs = load_dms().get('notifications', {}).get(username, [])
    unread_dm_count = sum(1 for n in dms_notifs if not n.get('read'))
    unread_notifs = [n for n in dms_notifs if not n.get('read')][-20:]
    return jsonify({
        "announcements": announcements,
        "incoming_call": incoming_call,
        "active_call": active_call,
        "friend_requests": friend_requests_in,
        "unread_dm_count": unread_dm_count,
        "notifications": unread_notifs,
        "server_time": datetime.datetime.utcnow().isoformat() + 'Z'
    })


# ==========================================
# FRIENDS & USER SEARCH
# ==========================================

@app.route('/api/users/search')
@require_login
def api_users_search():
    q = request.args.get('q', '').strip().lower()
    if len(q) < 1:
        return jsonify({"users": []})
    auth_data = load_auth()
    username = session['username']
    my_user = auth_data['users'].get(username, {})
    friends = my_user.get('friends', [])
    requests_out = my_user.get('friend_requests_out', [])
    requests_in = my_user.get('friend_requests_in', [])
    results = [u for u in auth_data['users'].keys() if q in u.lower() and u != username][:10]
    user_list = []
    for u in results:
        if u in friends: status = 'friend'
        elif u in requests_out: status = 'pending_out'
        elif u in requests_in: status = 'pending_in'
        else: status = 'none'
        user_list.append({"username": u, "status": status})
    return jsonify({"users": user_list})

@app.route('/api/friends', methods=['GET'])
@require_login
def api_get_friends():
    username = session['username']
    auth_data = load_auth()
    user_data = auth_data['users'].get(username, {})
    return jsonify({
        "friends": user_data.get("friends", []),
        "incoming_requests": user_data.get("friend_requests_in", []),
        "outgoing_requests": user_data.get("friend_requests_out", [])
    })

@app.route('/api/friends/request', methods=['POST'])
@require_login
def api_send_friend_request():
    username = session['username']
    data = request.get_json() or {}
    target = data.get('username', '').strip()
    auth_data = load_auth()
    if target not in auth_data['users']:
        return jsonify({"error": "User not found"}), 404
    if target == username:
        return jsonify({"error": "Cannot add yourself"}), 400
    target_user = auth_data['users'][target]
    sender_user = auth_data['users'][username]
    if username in target_user.get('friends', []):
        return jsonify({"error": "Already friends"}), 400
    if target in sender_user.get('friend_requests_out', []):
        return jsonify({"error": "Request already sent"}), 400
    if target in sender_user.get('friend_requests_in', []):
        sender_user.setdefault('friends', []).append(target)
        target_user.setdefault('friends', []).append(username)
        sender_user['friend_requests_in'] = [r for r in sender_user.get('friend_requests_in', []) if r != target]
        target_user['friend_requests_out'] = [r for r in target_user.get('friend_requests_out', []) if r != username]
        save_auth(auth_data)
        return jsonify({"success": True, "auto_accepted": True})
    target_user.setdefault('friend_requests_in', []).append(username)
    sender_user.setdefault('friend_requests_out', []).append(target)
    save_auth(auth_data)
    return jsonify({"success": True})

@app.route('/api/friends/respond', methods=['POST'])
@require_login
def api_respond_friend_request():
    username = session['username']
    data = request.get_json() or {}
    requester = data.get('username', '').strip()
    action = data.get('action')
    auth_data = load_auth()
    user = auth_data['users'].get(username, {})
    requester_user = auth_data['users'].get(requester, {})
    if not user or not requester_user:
        return jsonify({"error": "User not found"}), 404
    user['friend_requests_in'] = [r for r in user.get('friend_requests_in', []) if r != requester]
    requester_user['friend_requests_out'] = [r for r in requester_user.get('friend_requests_out', []) if r != username]
    if action == 'accept':
        if requester not in user.get('friends', []):
            user.setdefault('friends', []).append(requester)
        if username not in requester_user.get('friends', []):
            requester_user.setdefault('friends', []).append(username)
    save_auth(auth_data)
    return jsonify({"success": True})

@app.route('/api/friends/remove', methods=['POST'])
@require_login
def api_remove_friend():
    username = session['username']
    data = request.get_json() or {}
    target = data.get('username', '').strip()
    auth_data = load_auth()
    user = auth_data['users'].get(username, {})
    target_user = auth_data['users'].get(target, {})
    if user:
        user['friends'] = [f for f in user.get('friends', []) if f != target]
    if target_user:
        target_user['friends'] = [f for f in target_user.get('friends', []) if f != username]
    save_auth(auth_data)
    return jsonify({"success": True})

# ==========================================
# DM NOTIFICATIONS
# ==========================================

@app.route('/api/notifications', methods=['GET'])
@require_login
def api_get_notifications():
    username = session['username']
    dms_data = load_dms()
    notifs = dms_data.get('notifications', {}).get(username, [])
    return jsonify({"notifications": list(reversed(notifs[-50:]))})

@app.route('/api/notifications/read', methods=['POST'])
@require_login
def api_read_notification():
    username = session['username']
    data = request.get_json() or {}
    notif_id = data.get('id', 'all')
    dms_data = load_dms()
    notifs = dms_data.get('notifications', {}).get(username, [])
    for n in notifs:
        if notif_id == 'all' or n.get('id') == notif_id:
            n['read'] = True
    dms_data.setdefault('notifications', {})[username] = notifs
    save_dms(dms_data)
    return jsonify({"success": True})

# Initialize Cache
_ensure_table()
# Resolve the stable, DB-backed session-signing key now that the table exists
# (unless an explicit SESSION_SECRET was provided via the environment).
if not os.environ.get('SESSION_SECRET'):
    app.secret_key = _get_or_create_secret_key()
init_admin()
rebuild_key_cache()

if __name__ == '__main__':
    os.makedirs(os.path.join(BASE_DIR, 'templates'), exist_ok=True)
    os.makedirs(os.path.join(BASE_DIR, 'static'), exist_ok=True)
    print("Wavely V2 Flask API Server running on http://0.0.0.0:5000")
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False)
