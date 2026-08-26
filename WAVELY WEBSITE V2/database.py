import os
import sqlite3
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash

DB_FILE = os.path.join(os.path.dirname(__file__), 'wavely.db')

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # 1. Users Table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin BOOLEAN DEFAULT 0,
        is_banned BOOLEAN DEFAULT 0,
        ban_reason TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    # 2. Subscriptions Table ($4.99/mo, $45/yr, lifetime_vip)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        plan TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        amount REAL NOT NULL,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        auto_renew BOOLEAN DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    ''')

    # Stripe linkage columns are added in place for existing installations.
    subscription_columns = {
        row['name'] for row in cursor.execute("PRAGMA table_info(subscriptions)").fetchall()
    }
    if 'stripe_customer_id' not in subscription_columns:
        cursor.execute("ALTER TABLE subscriptions ADD COLUMN stripe_customer_id TEXT")
    if 'stripe_subscription_id' not in subscription_columns:
        cursor.execute("ALTER TABLE subscriptions ADD COLUMN stripe_subscription_id TEXT")
    cursor.execute('''
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription
    ON subscriptions(stripe_subscription_id)
    WHERE stripe_subscription_id IS NOT NULL
    ''')

    # 3. Payments / Transactions Table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        plan TEXT NOT NULL,
        payment_id TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'completed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    ''')

    # Processed Stripe event IDs make webhook delivery idempotent.
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS stripe_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    # 4. Registered HWID Devices Table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        hwid TEXT UNIQUE NOT NULL,
        pc_name TEXT DEFAULT 'Unknown PC',
        os_info TEXT DEFAULT 'Windows',
        cpu_model TEXT DEFAULT '',
        ram_gb TEXT DEFAULT '',
        app_version TEXT DEFAULT '1.0.5',
        is_banned BOOLEAN DEFAULT 0,
        ban_reason TEXT DEFAULT '',
        last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    ''')

    # 5. Login Security & Audit Logs Table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS login_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        ip_address TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        status TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    ''')

    # 6. Banned IPs Table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS banned_ips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT UNIQUE NOT NULL,
        reason TEXT DEFAULT 'Violation of Terms',
        banned_by TEXT DEFAULT 'Admin',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    # 7. Support & Issue Tracker Tickets Table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        priority TEXT DEFAULT 'normal',
        status TEXT DEFAULT 'open',
        is_locked BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    ''')

    # 8. Issue Message Thread Table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS issue_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        sender_name TEXT NOT NULL,
        is_admin BOOLEAN DEFAULT 0,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (issue_id) REFERENCES issues (id),
        FOREIGN KEY (sender_id) REFERENCES users (id)
    )
    ''')

    # 9. System Global Settings Table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    ''')

    # Seed Master Admin Account
    cursor.execute("SELECT id FROM users WHERE username = 'Admin' OR is_admin = 1")
    admin = cursor.fetchone()
    if not admin:
        admin_pass_hash = generate_password_hash('Reapxr!')
        cursor.execute('''
        INSERT INTO users (username, email, password_hash, is_admin)
        VALUES ('Admin', 'admin@wavely.lol', ?, 1)
        ''', (admin_pass_hash,))
        admin_user_id = cursor.lastrowid
        # Give Admin Lifetime VIP Subscription
        cursor.execute('''
        INSERT INTO subscriptions (user_id, plan, status, amount, expires_at)
        VALUES (?, 'lifetime_vip', 'active', 0.0, ?)
        ''', (admin_user_id, (datetime.utcnow() + timedelta(days=3650)).strftime('%Y-%m-%d %H:%M:%S')))

    # Seed Default System Settings
    defaults = {
        'discord_webhook': '',
        'maintenance_mode': '0',
        'app_download_url_win': 'https://wavely.lol/download/Wavely-Setup.exe',
        'app_download_url_portable': 'https://wavely.lol/download/Wavely-Portable.zip',
        'monthly_price': '4.99',
        'annual_price': '45.00'
    }
    for k, v in defaults.items():
        cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)", (k, v))

    conn.commit()
    conn.close()

# --- HELPER DATABASE UTILITIES ---

def get_user_by_id(user_id):
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return user

def get_user_by_username(username):
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,)).fetchone()
    conn.close()
    return user

def get_user_by_email(email):
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE email = ? COLLATE NOCASE", (email,)).fetchone()
    conn.close()
    return user

def get_active_subscription(user_id):
    conn = get_db()
    now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    sub = conn.execute('''
    SELECT * FROM subscriptions 
    WHERE user_id = ? AND status = 'active' AND expires_at > ?
    ORDER BY id DESC LIMIT 1
    ''', (user_id, now_str)).fetchone()
    conn.close()
    return sub

def get_financial_analytics():
    conn = get_db()
    now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')

    # Total Gross Revenue
    row_rev = conn.execute("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'completed'").fetchone()
    total_revenue = row_rev['total'] if row_rev else 0.0

    # Active Subscriptions Breakdown
    active_subs = conn.execute('''
    SELECT plan, COUNT(*) as cnt, SUM(amount) as plan_rev
    FROM subscriptions 
    WHERE status = 'active' AND expires_at > ?
    GROUP BY plan
    ''', (now_str,)).fetchall()

    total_active_subscribers = 0
    mrr = 0.0
    for s in active_subs:
        plan = s['plan']
        cnt = s['cnt']
        total_active_subscribers += cnt
        if plan == 'monthly_499':
            mrr += cnt * 4.99
        elif plan == 'annual_45':
            mrr += cnt * (45.0 / 12.0)

    arr = mrr * 12.0

    # Total Users
    row_users = conn.execute("SELECT COUNT(*) AS total FROM users").fetchone()
    total_users = row_users['total'] if row_users else 0

    # Total Devices
    row_dev = conn.execute("SELECT COUNT(*) AS total FROM devices").fetchone()
    total_devices = row_dev['total'] if row_dev else 0

    # Conversion Rate
    conversion_rate = (total_active_subscribers / total_users * 100) if total_users > 0 else 0.0

    # Recent Transactions
    recent_payments = conn.execute('''
    SELECT p.*, u.username, u.email
    FROM payments p
    JOIN users u ON p.user_id = u.id
    ORDER BY p.id DESC LIMIT 10
    ''').fetchall()

    conn.close()
    return {
        'total_revenue': round(total_revenue, 2),
        'mrr': round(mrr, 2),
        'arr': round(arr, 2),
        'total_active_subscribers': total_active_subscribers,
        'total_users': total_users,
        'total_devices': total_devices,
        'conversion_rate': round(conversion_rate, 1),
        'recent_payments': recent_payments
    }

def is_ip_banned(ip):
    if not ip: return False
    conn = get_db()
    row = conn.execute("SELECT id, reason FROM banned_ips WHERE ip_address = ?", (ip,)).fetchone()
    conn.close()
    return row

def is_device_banned(hwid):
    if not hwid: return False
    conn = get_db()
    row = conn.execute("SELECT id, is_banned, ban_reason FROM devices WHERE hwid = ?", (hwid,)).fetchone()
    conn.close()
    if row and row['is_banned']:
        return row['ban_reason'] or 'Device is banned by administrator.'
    return None

def register_or_heartbeat_device(user_id, hwid_data):
    conn = get_db()
    hwid = hwid_data.get('hwid')
    if not hwid:
        conn.close()
        return False

    now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    existing = conn.execute("SELECT id, is_banned, ban_reason FROM devices WHERE hwid = ?", (hwid,)).fetchone()

    if existing:
        conn.execute('''
        UPDATE devices SET 
            user_id = ?,
            pc_name = ?,
            os_info = ?,
            cpu_model = ?,
            ram_gb = ?,
            app_version = ?,
            last_heartbeat = ?
        WHERE hwid = ?
        ''', (
            user_id,
            hwid_data.get('pc_name', 'Unknown PC'),
            hwid_data.get('os_info', 'Windows'),
            hwid_data.get('cpu_model', ''),
            hwid_data.get('ram_gb', ''),
            hwid_data.get('app_version', '1.0.5'),
            now_str,
            hwid
        ))
        conn.commit()
        conn.close()
        return {'is_banned': bool(existing['is_banned']), 'ban_reason': existing['ban_reason']}
    else:
        conn.execute('''
        INSERT INTO devices (user_id, hwid, pc_name, os_info, cpu_model, ram_gb, app_version, last_heartbeat)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            user_id,
            hwid,
            hwid_data.get('pc_name', 'Unknown PC'),
            hwid_data.get('os_info', 'Windows'),
            hwid_data.get('cpu_model', ''),
            hwid_data.get('ram_gb', ''),
            hwid_data.get('app_version', '1.0.5'),
            now_str
        ))
        conn.commit()
        conn.close()
        return {'is_banned': False, 'ban_reason': ''}
