import random
import hmac
import hashlib
import time
import base64

CAPTCHA_SECRET = 'wavely_secure_captcha_secret_298471928'

def generate_captcha():
    """
    Generates a custom anti-bot challenge:
    Mix of simple math operations (e.g. '14 + 7 = ?') and 5-character distorted alphanumeric codes.
    Returns { token, svg_data_uri, type }
    """
    is_math = random.choice([True, False])
    
    if is_math:
        a = random.randint(3, 35)
        b = random.randint(2, 18)
        op = random.choice(['+', '-', '*'])
        if op == '+':
            answer = str(a + b)
            display_text = f"{a} + {b} = ?"
        elif op == '-':
            if a < b: a, b = b, a
            answer = str(a - b)
            display_text = f"{a} - {b} = ?"
        else:
            a = random.randint(2, 9)
            b = random.randint(2, 9)
            answer = str(a * b)
            display_text = f"{a} × {b} = ?"
    else:
        chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
        answer = ''.join(random.choices(chars, k=5))
        display_text = ' '.join(answer)

    # Generate custom SVG image with distortion, wave lines, and noise dots
    width, height = 220, 70
    bg_color = random.choice(['#0f172a', '#0b0f19', '#131b2e'])
    text_colors = ['#38bdf8', '#a855f7', '#ec4899', '#22c55e', '#eab308', '#06b6d4']
    
    # SVG Background & Border
    svg_elements = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" style="background:{bg_color}; border-radius:8px; border:1px solid rgba(255,255,255,0.12);">'
    ]

    # Random noise lines
    for _ in range(6):
        x1 = random.randint(0, width)
        y1 = random.randint(0, height)
        x2 = random.randint(0, width)
        y2 = random.randint(0, height)
        c = random.choice(text_colors)
        svg_elements.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c}" stroke-width="1.5" stroke-opacity="0.35" />')

    # Random noise dots
    for _ in range(25):
        cx = random.randint(0, width)
        cy = random.randint(0, height)
        r = random.uniform(1.0, 2.5)
        c = random.choice(text_colors)
        svg_elements.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{c}" fill-opacity="0.4" />')

    # Render each character with rotation & vertical offset
    chars_to_render = list(display_text)
    char_spacing = (width - 40) / max(len(chars_to_render), 1)
    start_x = 22

    for idx, ch in enumerate(chars_to_render):
        char_x = int(start_x + (idx * char_spacing))
        char_y = int(45 + random.randint(-6, 6))
        rot = random.randint(-18, 18)
        color = random.choice(text_colors)
        font_size = random.randint(22, 28)
        
        svg_elements.append(
            f'<text x="{char_x}" y="{char_y}" font-family="monospace, sans-serif" font-weight="bold" font-size="{font_size}" fill="{color}" transform="rotate({rot}, {char_x}, {char_y})">{ch}</text>'
        )

    svg_elements.append('</svg>')
    svg_content = ''.join(svg_elements)
    data_uri = f"data:image/svg+xml;base64,{base64.b64encode(svg_content.encode('utf-8')).decode('utf-8')}"

    # Generate HMAC Token: timestamp:answer_hash:signature
    timestamp = str(int(time.time()))
    clean_ans = answer.strip().upper()
    ans_hash = hashlib.sha256(clean_ans.encode('utf-8')).hexdigest()
    
    payload = f"{timestamp}:{ans_hash}"
    signature = hmac.new(CAPTCHA_SECRET.encode('utf-8'), payload.encode('utf-8'), hashlib.sha256).hexdigest()
    token = f"{payload}:{signature}"

    return {
        'token': token,
        'image': data_uri,
        'is_math': is_math
    }

def verify_captcha(token, user_answer, max_age_seconds=300):
    """
    Verifies the user's captcha answer against the HMAC token.
    Valid for 5 minutes (300 seconds).
    """
    if not token or not user_answer:
        return False

    try:
        parts = token.split(':')
        if len(parts) != 3:
            return False

        timestamp_str, ans_hash, signature = parts
        timestamp = int(timestamp_str)

        # Check expiration
        if time.time() - timestamp > max_age_seconds:
            return False

        # Verify signature
        payload = f"{timestamp_str}:{ans_hash}"
        expected_sig = hmac.new(CAPTCHA_SECRET.encode('utf-8'), payload.encode('utf-8'), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return False

        # Verify user answer
        clean_user = str(user_answer).strip().upper()
        user_hash = hashlib.sha256(clean_user.encode('utf-8')).hexdigest()
        
        return hmac.compare_digest(ans_hash, user_hash)
    except Exception:
        return False
