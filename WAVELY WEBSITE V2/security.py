import time
import jwt
import hmac
import hashlib
from collections import defaultdict
from werkzeug.security import generate_password_hash, check_password_hash

JWT_SECRET = 'wavely_jwt_master_production_secret_849201948291'
JWT_ALGORITHM = 'HS256'
HMAC_LICENSE_SECRET = 'wavely_desktop_hmac_integrity_key_91823719'

# In-memory IP rate limiter: { ip: [timestamp1, timestamp2, ...] }
rate_limit_store = defaultdict(list)

def create_jwt_token(user_id, username, is_admin=False, expires_in_days=30):
    payload = {
        'user_id': user_id,
        'username': username,
        'is_admin': is_admin,
        'iat': int(time.time()),
        'exp': int(time.time()) + (expires_in_days * 86400)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_jwt_token(token_str):
    if not token_str:
        return None
    if token_str.startswith('Bearer '):
        token_str = token_str[7:].strip()
    try:
        payload = jwt.decode(token_str, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except Exception:
        return None

def verify_desktop_integrity(payload, signature):
    """
    Verifies the cryptographic HMAC signature sent by the Wavely Desktop Client.
    """
    if not signature:
        return False
    try:
        expected = hmac.new(HMAC_LICENSE_SECRET.encode('utf-8'), payload.encode('utf-8'), hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature, expected)
    except Exception:
        return False

def check_rate_limit(ip, max_requests=60, window_seconds=60):
    """
    Sliding window rate limiter per IP address.
    """
    now = time.time()
    timestamps = rate_limit_store[ip]
    # Filter out old requests
    timestamps = [t for t in timestamps if now - t < window_seconds]
    rate_limit_store[ip] = timestamps
    
    if len(timestamps) >= max_requests:
        return False
    
    rate_limit_store[ip].append(now)
    return True
