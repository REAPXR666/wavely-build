import os
import json
import uuid
import secrets
import datetime
import traceback
import struct
import concurrent.futures
from functools import wraps
import requests
from flask import Flask, request, jsonify, render_template, session, redirect, url_for, Response
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)

@app.before_request
def enforce_banned_ips():
    # Resolve client IP supporting reverse proxies
    ip_addr = request.headers.get('X-Forwarded-For', request.remote_addr or '127.0.0.1').split(',')[0].strip()
    auth_data = load_auth()
    if ip_addr in auth_data.get("banned_ips", []):
        return jsonify({"error": "Forbidden. Your IP address has been banned by the administrator."}), 403


AUTH_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'AUTH.json')
ANALYTICS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ANALYTICS.json')
BEAT_BATTLES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'BEAT_BATTLES.json')
SERVERS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'SERVERS.json')
DMS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'DMS.json')
PROFILES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'PROFILES.json')

api_keys_cache = {} # Fast in-memory mapping of key -> username
samples_metadata_cache = {} # In-memory cache mapping sample UUID -> formatted metadata item


# --- DATABASE HELPERS ---
def load_json(filepath, default):
    try:
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"Error loading {filepath}: {e}")
    return default

def save_json(filepath, data):
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Error saving {filepath}: {e}")

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

def load_analytics():
    return load_json(ANALYTICS_FILE, {"requests": [], "errors": []})

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
            "password_hash": generate_password_hash("Reapxr!"),
            "role": "admin",
            "banned": False,
            "api_keys": []
        }
        save_auth(auth_data)
    else:
        # Ensure admin role is set correctly
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
    global api_keys_cache
    api_keys_cache.clear()
    auth_data = load_auth()
    for username, user_info in auth_data.get("users", {}).items():
        for key_item in user_info.get("api_keys", []):
            api_keys_cache[key_item["key"]] = username

# --- CREDENTIALS HANDLING ---
def get_hardcoded_fallback():
    cookie = "__cf_bm=UjTM4ilSXrQ8B8ws02iD6Q_1Uxo5R5uQEjvdYDdQvgc-1779233856.588109-1.0.1.1-8AJePy_wM5_hjD3fr4dxMuQtOX2zk6.mWcAAtgsA9zHa5_S1sgt8Vcedh1n50.IOMl8FVO.A0AP_kmAk_nT23cGsGPsfgoNI0pek2SuLKsPClX.nEQ.PwzpShAvAtCb2wxZqdutiPofjoG7QLC0wVA; _cfuvid=qQDv9YEwZrCZajgtP_5UnGxWY6OXG_qDAjWp5SLv7OE-1779233855.0497885-1.0.1.1-gkLgkAYeZhB6MxFCQ.eQrxjHZYz97ZfBmew5X0OWlQg; _ga=GA1.1.1181044113.1779145033; _ga_HJGSPPPM1E=GS2.1.s1779145032$o1$g1$t1779150655$j60$l0$h0; _gcl_au=1.1.122971771.1779145033; _splice_token_prod=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjR0NDJqSk1mV1YwaDk0eU9nTy1lQiJ9.eyJodHRwczovL3NwbGljZS5jb20vdXNlcl91dWlkIjoiMDg1YmQ0MjItYmY0Ny00MTQ0LTljOWQtYTc0ZWU1MDJjMzY4IiwiaXNzIjoiaHR0cHM6Ly9hdXRoLnNwbGljZS5jb20vIiwic3ViIjoiZ29vZ2xlLW9hdXRoMnwxMDQ2Mjg4MjEwOTg5NTI2Mzc4MTMiLCJhdWQiOlsiaHR0cHM6Ly9zcGxpY2UuY29tIiwiaHR0cHM6Ly9zcGxpY2UtcHJvZHVjdGlvbi51cy5hdXRoMC5jb20vdXNlcmluZm8iXSwiaWF0IjoxNzc5MjMzODU3LCJleHAiOjE3NzkyMzc0NTcsInNjb3BlIjoib3BlbmlkIHByb2ZpbGUgZW1haWwgb2ZmbGluZV9hY2Nlc3MiLCJhenAiOiJKNUpWQ0drSm10b001ZWlJOExHa1B1bWE5M2V4UVY4SCJ9.oKtiaeBRgUBcRv16FbKEthbPr94GvGmbWjE3eaib1wctAvM9_zBzH1TiNhbBrbCvvdmWquq_YadEjSyQbUUObWLk3Pirvqw1aowipSpYA5zmSyvu3BcG0s1k3uoWE_sSUr29jjm2_HD53Y56PBKe_9JcPflXEPWJs8OkL-UOEZ9mros_PqvXRAowUEyKZsehv9H_fXtwBHM89dPuAsX6_mefb53ZLD0KRD1oBqKTVu910B2P1TjFY__HOT3DgRR5_IAzLiz0fuO18R4LMLypL1ksnZ6DaWheYNqq6noGW-5U-d1RFGFezx_afmwdG0r-CTIBvduFFduwfwfXlKHXTw; _tt_enable_cookie=1; _ttp=01KRYMXK5KF1TJK6MVWPZRRJN5_.tt.1; _uetsid=e6ea8200530c11f1add0d7af8bd38240; _uetvid=e6eab220530c11f18958db2995524e5b; ajs_anonymous_id=f4c29de7-9f9e-46e4-8405-eb4d971193e0; ajs_user_id=9469038; cf_clearance=iy2RKjfmzlV1baO9A69B.AhcYaJJ_Trs0EYpZNuXRQU-1779233856-1.2.1.1-gU6kO16I.B3CJtqJhiiA_7TK9Q75wSsgbzM.t.n4fDocp1LBOBaor_QwlWdlH4QxJtIo_jCDIqXc6qrz6pLgGkV0mmJ.oaBq4rR_XeWRLztPYBRX0ZWCDtm_J8iNSKuVoJkYkoFEoVhIkuOLO6W5pUwLlRIhmPFnScHDwruOv2QR1mXswH3DOjdDx1Bf7bfGrjosk_i_fII7QE3ul.Se3y6R_sV9kv34qecKD7WWR7OYpnPWZLjkZriSkL0.oUbeJFmlhtGr5tKZzsQ4OdscA7OQunaycy63Fd0STmUV077LKHkyXvpUUDzrNAMpmrw.unrnM_ECigxh5SqRyWGGow; CookieScriptConsent=%7B%22googleconsentmap%22%3A%7B%22ad_storage%22%3A%22targeting%22%2C%22analytics_storage%22%3A%22performance%22%2C%22ad_personalization%22%3A%22targeting%22%2C%22ad_user_data%22%3A%22targeting%22%2C%22functionality_storage%22%3A%22functionality%22%2C%22personalization_storage%22%3A%22functionality%22%2C%22security_storage%22%3A%22functionality%22%7D%2C%22bannershown%22%3A1%2C%22action%22%3A%22accept%22%2C%22consenttime%22%3A1759848972%2C%22categories%22%3A%22%5B%5C%22functionality%5C%22%2C%5C%22targeting%5C%22%2C%5C%22performance%5C%22%5D%22%7D; ttcsid=1779145034935::HChpsyqTDJTU1xH88XXm.1.1779149541282.0::1.4500657.4506348::0.0.0.0::0.0.0; ttcsid_C66KDT0QCDCUAMIVFI90=1779145034934::LGjnVhqwCUFIKxqVuJJR.1.1779149541281.1; XSRF-TOKEN=703Gi4H75OPBvFLT4jfOXdlwNgI%3A1779233857806"
    authorization = "Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjR0NDJqSk1mV1YwaDk0eU9nTy1lQiJ9.eyJodHRwczovL3NwbGljZS5jb20vdXNlcl91dWlkIjoiMDg1YmQ0MjItYmY0Ny00MTQ0LTljOWQtYTc0ZWU1MDJjMzY4IiwiaXNzIjoiaHR0cHM6Ly9hdXRoLnNwbGljZS5jb20vIiwic3ViIjoiZ29vZ2xlLW9hdXRoMnwxMDQ2Mjg4MjEwOTg5NTI2Mzc4MTMiLCJhdWQiOlsiaHR0cHM6Ly9zcGxpY2UuY29tIiwiaHR0cHM6Ly9zcGxpY2UtcHJvZHVjdGlvbi51cy5hdXRoMC5jb20vdXNlcmluZm8iXSwiaWF0IjoxNzc5MjMzODU3LCJleHAiOjE3NzkyMzc0NTcsInNjb3BlIjoib3BlbmlkIHByb2ZpbGUgZW1haWwgb2ZmbGluZV9hY2Nlc3MiLCJhenAiOiJKNUpWQ0drSm10b001ZWlJOExHa1B1bWE5M2V4UVY4SCJ9.oKtiaeBRgUBcRv16FbKEthbPr94GvGmbWjE3eaib1wctAvM9_zBzH1TiNhbBrbCvvdmWquq_YadEjSyQbUUObWLk3Pirvqw1aowipSpYA5zmSyvu3BcG0s1k3uoWE_sSUr29jjm2_HD53Y56PBKe_9JcPflXEPWJs8OkL-UOEZ9mros_PqvXRAowUEyKZsehv9H_fXtwBHM89dPuAsX6_mefb53ZLD0KRD1oBqKTVu910B2P1TjFY__HOT3DgRR5_IAzLiz0fuO18R4LMLypL1ksnZ6DaWheYNqq6noGW-5U-d1RFGFezx_afmwdG0r-CTIBvduFFduwfwfXlKHXTw"
    return {"cookie": cookie, "authorization": authorization}

def get_splice_credentials():
    parent_dir = os.path.dirname(os.path.abspath(__file__))
    paths_to_try = [
        os.path.join(os.path.dirname(parent_dir), 'splice queries.txt'),
        os.path.join(parent_dir, 'splice queries.txt')
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
                
        # Fallback to key-value format parsing
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
        
        # Resolve client IP
        ip_addr = "127.0.0.1"
        if request:
            ip_addr = request.headers.get('X-Forwarded-For', request.remote_addr or '127.0.0.1').split(',')[0].strip()

        # Log request
        new_req = {
            "timestamp": datetime.datetime.now().isoformat(),
            "username": username,
            "endpoint": endpoint,
            "status_code": status_code,
            "api_key_label": key_label,
            "ip_address": ip_addr
        }
        analytics["requests"].append(new_req)
        
        # Prune old request records
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
        
        # Resolve client IP
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
        
        # Prune old error records
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
        # API key from headers or query parameters
        api_key = request.headers.get('X-API-Key') or request.args.get('api_key')
        if not api_key:
            return jsonify({"error": "Unauthorized. Missing API key."}), 401
            
        username = api_keys_cache.get(api_key)
        if not username:
            return jsonify({"error": "Unauthorized. Invalid API key."}), 401
            
        # Check if user is banned
        auth_data = load_auth()
        user_info = auth_data["users"].get(username, {})
        if user_info.get("banned"):
            return jsonify({"error": "Unauthorized. This account has been banned."}), 403

        # Get Key Label for tracking
        key_label = "Unknown"
        for k in user_info.get("api_keys", []):
            if k["key"] == api_key:
                key_label = k["label"]
                break
                
        request.username = username
        request.key_label = key_label
        
        # Execute routing logic
        response = f(*args, **kwargs)
        
        # Log request dynamically
        status_code = response.status_code if isinstance(response, Response) else 200
        log_request(username, request.path, status_code, key_label)
        
        return response
    return decorated_function

# --- SPLICE XOR DESCRAMBLER ALGORITHM ---
def descramble_splice_mp3(scrambled_bytes: bytes) -> bytes:
    if len(scrambled_bytes) < 28:
        raise ValueError("Invalid scrambled file size (too short)")
        
    # If the file is already a clean MP3 (starts with ID3 or standard sync word), do not descramble
    if scrambled_bytes.startswith(b'ID3') or (scrambled_bytes[0] == 0xFF and (scrambled_bytes[1] & 0xE0) == 0xE0):
        return scrambled_bytes
        
    # Read e (bytes 2-9) safely as a 64-bit unsigned little-endian integer
    e = struct.unpack_from('<Q', scrambled_bytes, 2)[0]
    
    # Read XOR key s (bytes 10-27, length 18)
    key_bytes = bytearray(scrambled_bytes[10:28])
    
    # Scrambled payload starts at byte 28
    payload = bytearray(scrambled_bytes[28:])
    payload_length = len(payload)
    
    # Descramble Block 1: index 0 to e
    block1_end = min(e, payload_length)
    for i in range(block1_end):
        payload[i] ^= key_bytes[i % 18]
        
    # Descramble Block 3: index 2*e to 3*e
    block3_start = 2 * e
    block3_end = min(3 * e, payload_length)
    if block3_start < payload_length:
        for i in range(block3_start, block3_end):
            key_index = (i - block3_start) % 18
            payload[i] ^= key_bytes[key_index]
            
    return bytes(payload)

# --- DYNAMIC WAV TRANSCODER ---
def convert_mp3_to_wav_py(mp3_bytes: bytes):
    # Try importing torchaudio (since it is installed in the system)
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
        
    # Try importing pydub (as fallback)
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
            "order": "DESC",
            "sort": "popularity",
            "limit": 50,
            "page": page,
            "tags": [],
            "key": key or None,
            "chord_type": None,
            "bpm": str(bpm) if bpm else None,
            "min_bpm": None,
            "max_bpm": None,
            "asset_category_slug": category or None,
            "random_seed": None,
            "attributes": [],
            "filepath": None if is_preset else query_text,
            "query": query_text if is_preset else None,
            "ac_uuid": None,
            "parent_asset_uuid": None
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
    # Fetch 20 pages (50 results/page) in parallel using ThreadPoolExecutor for 1000+ results
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
                
    # Deduplicate raw outputs and format
    formatted_results = []
    seen_uuids = set()
    
    for item in all_raw_items:
        if not item or 'uuid' not in item:
            continue
        uuid_val = item['uuid']
        if uuid_val in seen_uuids:
            continue
        seen_uuids.add(uuid_val)
        
        # Format the item
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
            
            # Fallback extension detection from the asset name or query string
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

# --- ACCOUNT AND ANALYTICS VIEWS / ROUTING ---
@app.route('/')
def home():
    return render_template('home.html', tab='home')

@app.route('/browser')
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
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip()
    password = data.get('password') or ''
    
    if not username or not email or not password:
        return jsonify({"error": "All fields are required"}), 400
        
    auth_data = load_auth()
    if username in auth_data["users"]:
        return jsonify({"error": "Username already exists"}), 400
        
    # Create user
    auth_data["users"][username] = {
        "email": email,
        "password_hash": generate_password_hash(password),
        "api_keys": []
    }
    save_auth(auth_data)
    
    session['username'] = username
    return jsonify({"success": True})

@app.route('/api/auth/login', methods=['POST'])
def action_login():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    
    if not username or not password:
        return jsonify({"error": "All fields are required"}), 400
        
    auth_data = load_auth()
    user = auth_data["users"].get(username)
    
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid username or password"}), 401
        
    session['username'] = username
    return jsonify({"success": True})

@app.route('/api/auth/logout', methods=['POST'])
def action_logout():
    session.pop('username', None)
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
    
    # Filter requests and errors for this specific user
    user_requests = [r for r in analytics["requests"] if r["username"] == username]
    user_errors = [e for e in analytics["errors"] if e["username"] == username]
    
    # Calculations
    total_reqs = len(user_requests)
    errors_count = len(user_errors)
    success_rate = 100.0 if total_reqs == 0 else ((total_reqs - errors_count) / total_reqs) * 100.0
    
    # Endpoint counts
    endpoints = {}
    for r in user_requests:
        endpoints[r["endpoint"]] = endpoints.get(r["endpoint"], 0) + 1
    most_used = max(endpoints, key=endpoints.get) if endpoints else "--"
    
    # Daily requests data (last 30 days)
    today = datetime.date.today()
    days_30 = [today - datetime.timedelta(days=i) for i in range(29, -1, -1)]
    days_labels = [d.strftime('%b %d') for d in days_30]
    
    daily_counts = [0] * 30
    for r in user_requests:
        req_date = datetime.datetime.fromisoformat(r["timestamp"]).date()
        if req_date in days_30:
            idx = days_30.index(req_date)
            daily_counts[idx] += 1
            
    # Traceback Log Archiving (last 90 days log history)
    # Gather logs combining successful requests and traceback logs
    history_logs = []
    for r in user_requests:
        history_logs.append({
            "timestamp": r["timestamp"],
            "type": "SUCCESS",
            "endpoint": r["endpoint"],
            "details": f"Status: {r['status_code']} | Key: {r['api_key_label']}"
        })
    for e in user_errors:
        history_logs.append({
            "timestamp": e["timestamp"],
            "type": "ERROR",
            "endpoint": e["endpoint"],
            "details": f"Err: {e['error']} | Trace: {e['traceback'][:150]}..."
        })
        
    # Sort history logs newest first
    history_logs.sort(key=lambda x: x["timestamp"], reverse=True)
    
    # Return user keys as well
    auth_data = load_auth()
    user_keys = auth_data["users"][username].get("api_keys", [])
    is_admin = auth_data["users"][username].get("role") == "admin"
    
    return jsonify({
        "username": username,
        "stats": {
            "totalRequests": total_reqs,
            "successRate": f"{success_rate:.1f}%",
            "mostUsed": most_used,
            "errorCount": errors_count
        },
        "chart": {
            "labels": days_labels,
            "data": daily_counts
        },
        "endpoints": endpoints,
        "logs": history_logs[:100], # Limit output list size to 100 for safety
        "keys": user_keys,
        "isAdmin": is_admin
    })

# --- ADMIN PANEL ENDPOINTS ---
@app.route('/api/admin/users')
@require_admin_login
def admin_get_users():
    auth_data = load_auth()
    users_list = []
    for username, info in auth_data.get("users", {}).items():
        users_list.append({
            "username": username,
            "email": info.get("email"),
            "role": info.get("role", "developer"),
            "banned": info.get("banned", False),
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
        
    return jsonify({"success": True})

@app.route('/api/admin/ips/<ip>', methods=['DELETE'])
@require_admin_login
def admin_unban_ip(ip):
    auth_data = load_auth()
    if "banned_ips" in auth_data and ip in auth_data["banned_ips"]:
        auth_data["banned_ips"].remove(ip)
        save_auth(auth_data)
    return jsonify({"success": True})

@app.route('/api/admin/logs')
@require_admin_login
def admin_get_logs():
    analytics = load_analytics()
    global_logs = []
    
    for r in analytics.get("requests", []):
        global_logs.append({
            "timestamp": r.get("timestamp"),
            "username": r.get("username"),
            "type": "SUCCESS",
            "endpoint": r.get("endpoint"),
            "ip_address": r.get("ip_address", "127.0.0.1"),
            "details": f"Status: {r.get('status_code')} | Key: {r.get('api_key_label')}"
        })
        
    for e in analytics.get("errors", []):
        global_logs.append({
            "timestamp": e.get("timestamp"),
            "username": e.get("username", "anonymous"),
            "type": "ERROR",
            "endpoint": e.get("endpoint"),
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
        # Check in-memory metadata cache first
        sample = samples_metadata_cache.get(uuid_val)
        if not sample:
            search_splice_max(uuid_val)
            sample = samples_metadata_cache.get(uuid_val)
            
        if not sample:
            return jsonify({"error": f"Sample with UUID {uuid_val} not found. Please search for it first to cache the signed preview URL."}), 404
            
        return jsonify(sample)
    except Exception as e:
        tb = traceback.format_exc()
        log_error(request.path, str(e), tb, username=request.username)
        return jsonify({"error": f"Failed to get metadata: {str(e)}"}), 500

@app.route('/api/decrypted-audio/<uuid_val>')
@require_api_key
def api_decrypted_audio(uuid_val):
    fmt = request.args.get('format', 'mp3').lower()
    
    # 1. Load metadata to extract scrambled URL from S3
    try:
        sample = samples_metadata_cache.get(uuid_val)
        if not sample:
            search_splice_max(uuid_val)
            sample = samples_metadata_cache.get(uuid_val)
            
        if not sample:
            return jsonify({"error": "Sample not found. Please search for it first to cache the signed preview URL."}), 404
            
        import urllib.parse
        base_name = sample.get('name', uuid_val)
        for ext_to_strip in ['.wav', '.mp3']:
            if base_name.lower().endswith(ext_to_strip):
                base_name = base_name[:-len(ext_to_strip)]

        is_preset_download = (sample.get('isPreset') or bool(sample.get('presetUrl'))) and fmt not in ['mp3', 'wav']
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://splice.com/',
            'Origin': 'https://splice.com'
        }
        
        if is_preset_download:
            preset_url = sample.get('presetUrl')
            if not preset_url:
                scrambled_url = sample.get('previewUrl')
                if not scrambled_url:
                    return jsonify({"error": "No preview URL available for fallback"}), 400
                res = requests.get(scrambled_url, headers=headers, timeout=10)
                if res.status_code != 200:
                    return jsonify({"error": "Failed to load preview for fallback"}), 502
                clean_mp3 = descramble_splice_mp3(res.content)
                filename = f"{base_name}.mp3"
                safe_filename = filename.replace('"', '\\"')
                encoded_filename = urllib.parse.quote(filename)
                return Response(clean_mp3, mimetype="audio/mpeg", headers={
                    "Content-Disposition": f'attachment; filename="{safe_filename}"; filename*=UTF-8\'\'{encoded_filename}'
                })
            res = requests.get(preset_url, headers=headers, timeout=10)
            if res.status_code != 200:
                return jsonify({"error": f"Failed to load preset source file: HTTP {res.status_code}"}), 502
            preset_ext = sample.get('presetExt', 'preset')
            filename = f"{base_name}.{preset_ext}"
            safe_filename = filename.replace('"', '\\"')
            encoded_filename = urllib.parse.quote(filename)
            return Response(res.content, mimetype="application/octet-stream", headers={
                "Content-Disposition": f'attachment; filename="{safe_filename}"; filename*=UTF-8\'\'{encoded_filename}'
            })

        scrambled_url = sample['previewUrl']
        if not scrambled_url:
            return jsonify({"error": "No preview URL available"}), 400
        res = requests.get(scrambled_url, headers=headers, timeout=10)
        if res.status_code != 200:
            return jsonify({"error": f"Failed to load scrambled source file: HTTP {res.status_code}"}), 502
            
        # 2. Descramble on the fly in memory
        clean_mp3 = descramble_splice_mp3(res.content)
        
        # 3. Dynamic formatting
        if fmt == 'wav':
            wav_bytes = convert_mp3_to_wav_py(clean_mp3)
            if not wav_bytes:
                return jsonify({"error": "WAV conversion failed. Please download MP3 instead."}), 500
            filename = f"{base_name}.wav"
            safe_filename = filename.replace('"', '\\"')
            encoded_filename = urllib.parse.quote(filename)
            return Response(wav_bytes, mimetype="audio/wav", headers={
                "Content-Disposition": f'attachment; filename="{safe_filename}"; filename*=UTF-8\'\'{encoded_filename}'
            })
        else:
            filename = f"{base_name}.mp3"
            safe_filename = filename.replace('"', '\\"')
            encoded_filename = urllib.parse.quote(filename)
            return Response(clean_mp3, mimetype="audio/mpeg", headers={
                "Content-Disposition": f'attachment; filename="{safe_filename}"; filename*=UTF-8\'\'{encoded_filename}'
            })
            
    except Exception as e:
        tb = traceback.format_exc()
        log_error(request.path, str(e), tb, username=request.username)
        return jsonify({"error": f"Failed to decrypt audio file: {str(e)}"}), 500

# --- WEB APP FRONTEND ENDPOINTS ---
@app.route('/api/web/search')
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

        is_preset_download = (sample.get('isPreset') or bool(sample.get('presetUrl'))) and fmt not in ['mp3', 'wav']
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://splice.com/',
            'Origin': 'https://splice.com'
        }
        
        if is_preset_download:
            preset_url = sample.get('presetUrl')
            if not preset_url:
                scrambled_url = sample.get('previewUrl')
                if not scrambled_url:
                    return jsonify({"error": "No preview URL available for fallback"}), 400
                res = requests.get(scrambled_url, headers=headers, timeout=10)
                if res.status_code != 200:
                    return jsonify({"error": "Failed to load preview for fallback"}), 502
                clean_mp3 = descramble_splice_mp3(res.content)
                filename = f"{base_name}.mp3"
                safe_filename = filename.replace('"', '\\"')
                encoded_filename = urllib.parse.quote(filename)
                return Response(clean_mp3, mimetype="audio/mpeg", headers={
                    "Content-Disposition": f'attachment; filename="{safe_filename}"; filename*=UTF-8\'\'{encoded_filename}'
                })
            res = requests.get(preset_url, headers=headers, timeout=10)
            if res.status_code != 200:
                return jsonify({"error": f"Failed to load preset source file"}), 502
            preset_ext = sample.get('presetExt', 'preset')
            filename = f"{base_name}.{preset_ext}"
            safe_filename = filename.replace('"', '\\"')
            encoded_filename = urllib.parse.quote(filename)
            return Response(res.content, mimetype="application/octet-stream", headers={
                "Content-Disposition": f'attachment; filename="{safe_filename}"; filename*=UTF-8\'\'{encoded_filename}'
            })

        scrambled_url = sample['previewUrl']
        if not scrambled_url:
            return jsonify({"error": "No preview URL available"}), 400
        res = requests.get(scrambled_url, headers=headers, timeout=10)
        if res.status_code != 200:
            return jsonify({"error": f"Failed to load scrambled source file"}), 502
            
        clean_mp3 = descramble_splice_mp3(res.content)
        
        if fmt == 'wav':
            wav_bytes = convert_mp3_to_wav_py(clean_mp3)
            if not wav_bytes:
                return jsonify({"error": "WAV conversion failed"}), 500
            filename = f"{base_name}.wav"
            safe_filename = filename.replace('"', '\\"')
            encoded_filename = urllib.parse.quote(filename)
            return Response(wav_bytes, mimetype="audio/wav", headers={
                "Content-Disposition": f'attachment; filename="{safe_filename}"; filename*=UTF-8\'\'{encoded_filename}'
            })
        else:
            filename = f"{base_name}.mp3"
            safe_filename = filename.replace('"', '\\"')
            encoded_filename = urllib.parse.quote(filename)
            return Response(clean_mp3, mimetype="audio/mpeg", headers={
                "Content-Disposition": f'attachment; filename="{safe_filename}"; filename*=UTF-8\'\'{encoded_filename}'
            })
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
        
        leaderboard.append({
            "username": username,
            "elo": stats["elo"],
            "wins": stats["wins"],
            "upvotes": stats["upvotes"],
            "downvotes": stats["downvotes"]
        })
        
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
                        "id": str(uuid.uuid4()),
                        "battle_id": battle["id"],
                        "battle_title": battle["title"],
                        "acknowledged": False
                    })
                    
    if modified:
        save_beat_battles(battles_data)
        save_profiles(profiles_data)
        recalculate_elo()


# --- COMMUNITY PORTAL ENDPOINTS ---

def require_login(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'username' not in session:
            return jsonify({"error": "Please sign in to access this feature"}), 401
        return f(*args, **kwargs)
    return decorated

UPLOAD_FOLDER_BATTLES = os.path.join(app.root_path, 'static', 'uploads', 'battles')
UPLOAD_FOLDER_PFPS = os.path.join(app.root_path, 'static', 'uploads', 'pfps')
UPLOAD_FOLDER_SERVERS = os.path.join(app.root_path, 'static', 'uploads', 'servers')
os.makedirs(UPLOAD_FOLDER_BATTLES, exist_ok=True)
os.makedirs(UPLOAD_FOLDER_PFPS, exist_ok=True)
os.makedirs(UPLOAD_FOLDER_SERVERS, exist_ok=True)

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
    
    profile = profiles_data["profiles"].get(username, {
        "elo": 0,
        "wins": 0,
        "upvotes": 0,
        "downvotes": 0,
        "global_rank": 999,
        "bio": "",
        "socials": {},
        "pfp": ""
    })
    
    return jsonify({
        "username": username,
        "email": user_auth.get("email"),
        "role": user_auth.get("role", "user"),
        "profile": profile
    })

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
            profiles_data["profiles"][username] = {
                "elo": 0,
                "wins": 0,
                "upvotes": 0,
                "downvotes": 0,
                "global_rank": 999,
                "pfp": ""
            }
            
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
        
        # Validate file type
        ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else 'png'
        allowed_exts = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        if ext not in allowed_exts:
            return jsonify({"error": f"Unsupported file type: .{ext}. Use PNG, JPEG, GIF, or WebP."}), 400
            
        # Ensure upload directory exists
        os.makedirs(UPLOAD_FOLDER_PFPS, exist_ok=True)
        
        filename = secure_filename(f"pfp_{username}_{secrets.token_hex(4)}.{ext}")
        file.save(os.path.join(UPLOAD_FOLDER_PFPS, filename))
        
        profiles_data = load_profiles()
        if username not in profiles_data["profiles"]:
            profiles_data["profiles"][username] = {
                "elo": 0,
                "wins": 0,
                "upvotes": 0,
                "downvotes": 0,
                "global_rank": 999
            }
        profiles_data["profiles"][username]["pfp"] = f"/static/uploads/pfps/{filename}"
        save_profiles(profiles_data)
        return jsonify({"success": True, "pfp_url": f"/static/uploads/pfps/{filename}"})
    except Exception as e:
        tb = traceback.format_exc()
        log_error(request.path, str(e), tb, username=session.get('username'))
        return jsonify({"error": f"Upload failed: {str(e)}"}), 500

@app.route('/api/profile/hovercard/<target_user>')
def api_profile_hovercard(target_user):
    profiles_data = load_profiles()
    auth_data = load_auth()
    
    if target_user not in auth_data["users"]:
        return jsonify({"error": "User not found"}), 404
        
    profile = profiles_data["profiles"].get(target_user, {
        "elo": 0,
        "wins": 0,
        "upvotes": 0,
        "downvotes": 0,
        "global_rank": 999,
        "bio": "",
        "socials": {},
        "pfp": ""
    })
    return jsonify({
        "username": target_user,
        "profile": profile
    })

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
def api_get_battles():
    check_and_finalize_battles()
    battles_data = load_beat_battles()
    
    username = session.get('username')
    visible_battles = []
    for b in battles_data.get("battles", []):
        is_creator = username and b.get("creator") == username
        is_member = username and any(t.get("username") == username for t in b.get("tracks", []))
        if b.get("is_public") or is_creator or is_member:
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
        "id": battle_id,
        "title": title,
        "description": description,
        "creator": username,
        "sample_url": f"/static/uploads/battles/{sample_filename}",
        "key": key,
        "style": style,
        "deadline": deadline + ":00Z",
        "is_public": is_public,
        "invite_code": invite_code,
        "status": "active",
        "winner": None,
        "tracks": []
    }
    
    battles_data["battles"].append(new_battle)
    save_beat_battles(battles_data)
    return jsonify({"success": True, "battle_id": battle_id, "invite_code": invite_code})

@app.route('/api/battles/join/<code>')
@require_login
def api_join_battle(code):
    username = session['username']
    battles_data = load_beat_battles()
    found_battle = None
    for b in battles_data.get("battles", []):
        if b.get("invite_code") == code:
            found_battle = b
            break
            
    if not found_battle:
        return jsonify({"error": "Invalid battle invite code"}), 404
        
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
    
    new_track = {
        "id": str(uuid.uuid4()),
        "username": username,
        "audio_url": f"/static/uploads/battles/{track_filename}",
        "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
        "votes": {},
        "comments": []
    }
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
        
    new_comment = {
        "username": username,
        "comment": comment_text,
        "created_at": datetime.datetime.utcnow().isoformat() + 'Z'
    }
    track["comments"].append(new_comment)
    save_beat_battles(battles_data)
    return jsonify({"success": True, "comment": new_comment})

@app.route('/api/battles/leaderboard')
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
            my_servers.append(s)
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
            "id": server_id,
            "name": name,
            "icon_url": icon_url,
            "owner": username,
            "invite_code": invite_code,
            "roles": [
                {
                    "id": "role-mod",
                    "name": "Moderator",
                    "color": "#e74c3c",
                    "permissions": ["manage_channels", "kick_members", "ban_members"]
                }
            ],
            "members": {
                username: ["role-mod"]
            },
            "banned_users": [],
            "categories": [
                {"id": "cat-general", "name": "Text Channels"}
            ],
            "channels": [
                {
                    "id": "chan-general",
                    "category_id": "cat-general",
                    "name": "general",
                    "slowmode": 0,
                    "locked": False,
                    "allowed_roles": []
                }
            ],
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
        server["categories"].append({"id": item_id, "name": name})
    else:
        server["channels"].append({
            "id": item_id,
            "category_id": category_id,
            "name": name.lower().replace(" ", "-"),
            "slowmode": 0,
            "locked": False,
            "allowed_roles": []
        })
        
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
    channel["allowed_roles"] = allowed_roles
    
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
        
    if channel["allowed_roles"]:
        user_roles = server["members"].get(username, [])
        is_owner = server["owner"] == username
        has_role = is_owner or any(rid in channel["allowed_roles"] for rid in user_roles)
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
        return jsonify({"error": "This channel is locked. Only moderators can send messages."}), 403
        
    slowmode = channel.get("slowmode", 0)
    if slowmode > 0 and not is_mod:
        now = datetime.datetime.utcnow()
        last_msg = next((m for m in reversed(server.get("messages", [])) if m.get("channel_id") == channel_id and m.get("username") == username), None)
        if last_msg:
            try:
                last_time = datetime.datetime.fromisoformat(last_msg["created_at"].replace('Z', ''))
                diff = (now - last_time).total_seconds()
                if diff < slowmode:
                    return jsonify({"error": f"Slowmode active. Please wait {int(slowmode - diff)}s before sending another message."}), 429
            except Exception:
                pass
                
    new_message = {
        "id": str(uuid.uuid4()),
        "channel_id": channel_id,
        "username": username,
        "content": content,
        "created_at": datetime.datetime.utcnow().isoformat() + 'Z'
    }
    
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
    server["roles"].append({
        "id": role_id,
        "name": name,
        "color": color,
        "permissions": permissions
    })
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
        return jsonify({"error": "User is not a member of the server"}), 404
        
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
    
    new_msg = {
        "id": str(uuid.uuid4()),
        "sender": username,
        "content": content,
        "created_at": datetime.datetime.utcnow().isoformat() + 'Z'
    }
    
    dms_data.setdefault("threads", {}).setdefault(thread_key, []).append(new_msg)
    save_dms(dms_data)
    return jsonify({"success": True, "message": new_msg})

# 5. WEBRTC CALLING ENDPOINTS
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
        "id": call_id,
        "caller": username,
        "receiver": receiver,
        "type": call_type,
        "state": "initiated",
        "sdp_offer": sdp_offer,
        "sdp_answer": None,
        "caller_candidates": [],
        "receiver_candidates": [],
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
                incoming_call = {
                    "id": call_id,
                    "caller": call["caller"],
                    "type": call["type"]
                }
            break
            
    if active_call:
        active_call["last_seen"] = now
        save_dms(dms_data)
        
    return jsonify({
        "announcements": announcements,
        "incoming_call": incoming_call,
        "active_call": active_call
    })

# Initialize Cache
init_admin()
rebuild_key_cache()

if __name__ == '__main__':
    # Make sure static and template directories exist
    os.makedirs(os.path.join(os.path.dirname(__file__), 'templates'), exist_ok=True)
    os.makedirs(os.path.join(os.path.dirname(__file__), 'static'), exist_ok=True)
    print("Wavely Flask API Server running on http://127.0.0.1:5000")
    app.run(host='127.0.0.1', port=5000, debug=True, use_reloader=False)
