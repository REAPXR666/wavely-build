import os
import uuid
import sqlite3
import requests
from datetime import datetime
from flask import Flask, request, jsonify, render_template, redirect, url_for, session
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.config['SECRET_KEY'] = 'splice_clone_secret_key_1298471928'
CORS(app, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*")

DB_FILE = os.path.join(os.path.dirname(__file__), 'database.db')

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Create tables
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS app_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL,
        changelog TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS bug_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        steps_to_reproduce TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS ticket_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        sender_name TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ticket_id) REFERENCES tickets (id),
        FOREIGN KEY (sender_id) REFERENCES users (id)
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    ''')
    
    # Pre-seed Admin Account
    cursor.execute("SELECT * FROM users WHERE username = 'Admin'")
    admin = cursor.fetchone()
    if not admin:
        admin_pass_hash = generate_password_hash('Reapxr!')
        cursor.execute("INSERT INTO users (username, password_hash, is_admin) VALUES ('Admin', ?, 1)", (admin_pass_hash,))
    
    # Default settings
    cursor.execute("SELECT * FROM settings WHERE key = 'discord_webhook'")
    if not cursor.fetchone():
        cursor.execute("INSERT INTO settings (key, value) VALUES ('discord_webhook', '')")
        
    conn.commit()
    conn.close()

# Initialize DB on load
init_db()

# --- HELPER FUNCTIONS ---
def get_user_from_token(token_str):
    if not token_str:
        return None
    
    # Remove 'Bearer ' prefix if present
    if token_str.startswith('Bearer '):
        token_str = token_str[7:]
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT users.* FROM tokens 
        JOIN users ON tokens.user_id = users.id 
        WHERE tokens.token = ?
    ''', (token_str,))
    user = cursor.fetchone()
    conn.close()
    return user

def generate_session_token(user_id):
    token = uuid.uuid4().hex
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO tokens (user_id, token) VALUES (?, ?)", (user_id, token))
    conn.commit()
    conn.close()
    return token

def send_discord_webhook(username, title, description, steps):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = 'discord_webhook'")
    row = cursor.fetchone()
    conn.close()
    
    webhook_url = row['value'] if row else ''
    if not webhook_url or not webhook_url.startswith('http'):
        print("[Discord Webhook] Webhook URL not set or invalid.")
        return False
        
    payload = {
        "embeds": [
            {
                "title": "🐛 New Bug Report Submitted",
                "color": 15158332, # Red
                "fields": [
                    {"name": "Reporter", "value": f"`{username}`", "inline": True},
                    {"name": "Bug Title", "value": title, "inline": False},
                    {"name": "Description", "value": description, "inline": False},
                    {"name": "Steps to Reproduce", "value": steps, "inline": False}
                ],
                "timestamp": datetime.utcnow().isoformat()
            }
        ]
    }
    
    try:
        r = requests.post(webhook_url, json=payload, timeout=5)
        return r.status_code == 204 or r.status_code == 200
    except Exception as e:
        print("[Discord Webhook] Error sending report:", e)
        return False


# --- API ENDPOINTS ---

@app.route('/api/register', methods=['POST'])
def api_register():
    data = request.json or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400
        
    if len(username) < 3 or len(password) < 4:
        return jsonify({"error": "Username must be >= 3 chars, password >= 4 chars"}), 400
        
    conn = get_db()
    cursor = conn.cursor()
    try:
        # Check if username exists
        cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
        if cursor.fetchone():
            conn.close()
            return jsonify({"error": "Username already taken"}), 409
            
        pass_hash = generate_password_hash(password)
        cursor.execute("INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 0)", (username, pass_hash))
        conn.commit()
        
        # Get new user details
        cursor.execute("SELECT id, username, is_admin FROM users WHERE username = ?", (username,))
        user = cursor.fetchone()
        
        # Generate token for auto-login
        token = generate_session_token(user['id'])
        
        conn.close()
        return jsonify({
            "message": "Registered successfully",
            "token": token,
            "user": {
                "id": user['id'],
                "username": user['username'],
                "is_admin": bool(user['is_admin'])
            }
        }), 201
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 500

@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.json or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()
    conn.close()
    
    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({"error": "Invalid username or password"}), 401
        
    token = generate_session_token(user['id'])
    
    return jsonify({
        "message": "Logged in successfully",
        "token": token,
        "user": {
            "id": user['id'],
            "username": user['username'],
            "is_admin": bool(user['is_admin'])
        }
    }), 200

@app.route('/api/verify', methods=['GET'])
def api_verify():
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user:
        return jsonify({"error": "Invalid or expired token"}), 401
        
    return jsonify({
        "valid": True,
        "user": {
            "id": user['id'],
            "username": user['username'],
            "is_admin": bool(user['is_admin'])
        }
    }), 200

# Announcements
@app.route('/api/announcements', methods=['GET'])
def api_get_announcements():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM announcements ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    
    result = [dict(row) for row in rows]
    return jsonify(result), 200

@app.route('/api/announcements', methods=['POST'])
def api_post_announcement():
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user or not user['is_admin']:
        return jsonify({"error": "Admin authorization required"}), 403
        
    data = request.json or {}
    title = data.get('title', '').strip()
    content = data.get('content', '').strip()
    
    if not title or not content:
        return jsonify({"error": "Title and content are required"}), 400
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO announcements (title, content) VALUES (?, ?)", (title, content))
    conn.commit()
    conn.close()
    
    return jsonify({"message": "Announcement posted successfully"}), 201

@app.route('/api/announcements/<int:ann_id>', methods=['DELETE'])
def api_delete_announcement(ann_id):
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user or not user['is_admin']:
        return jsonify({"error": "Admin authorization required"}), 403
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM announcements WHERE id = ?", (ann_id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Announcement deleted successfully"}), 200

# App Version Updates
@app.route('/api/updates', methods=['GET'])
def api_get_updates():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM app_updates ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    
    result = [dict(row) for row in rows]
    return jsonify(result), 200

@app.route('/api/updates', methods=['POST'])
def api_post_update():
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user or not user['is_admin']:
        return jsonify({"error": "Admin authorization required"}), 403
        
    data = request.json or {}
    version = data.get('version', '').strip()
    changelog = data.get('changelog', '').strip()
    
    if not version or not changelog:
        return jsonify({"error": "Version and changelog are required"}), 400
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO app_updates (version, changelog) VALUES (?, ?)", (version, changelog))
    conn.commit()
    conn.close()
    
    return jsonify({"message": "App version update posted successfully"}), 201

@app.route('/api/updates/<int:up_id>', methods=['DELETE'])
def api_delete_update(up_id):
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user or not user['is_admin']:
        return jsonify({"error": "Admin authorization required"}), 403
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM app_updates WHERE id = ?", (up_id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Version update deleted successfully"}), 200

# Bug Reporting
@app.route('/api/bugs', methods=['POST'])
def api_post_bug():
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user:
        return jsonify({"error": "Authentication required"}), 401
        
    data = request.json or {}
    title = data.get('title', '').strip()
    description = data.get('description', '').strip()
    steps = data.get('steps', '').strip()
    
    if not title or not description:
        return jsonify({"error": "Title and description are required"}), 400
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO bug_reports (user_id, username, title, description, steps_to_reproduce) VALUES (?, ?, ?, ?, ?)",
        (user['id'], user['username'], title, description, steps)
    )
    conn.commit()
    conn.close()
    
    # Send to Discord Webhook async-ish (in request)
    sent_webhook = send_discord_webhook(user['username'], title, description, steps)
    
    return jsonify({
        "message": "Bug reported successfully",
        "discord_sent": sent_webhook
    }), 201

@app.route('/api/bugs', methods=['GET'])
def api_get_bugs():
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user or not user['is_admin']:
        return jsonify({"error": "Admin authorization required"}), 403
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM bug_reports ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return jsonify([dict(row) for row in rows]), 200

# Support Tickets (User Views)
@app.route('/api/tickets', methods=['POST'])
def api_create_ticket():
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user:
        return jsonify({"error": "Authentication required"}), 401
        
    data = request.json or {}
    title = data.get('title', '').strip()
    message = data.get('message', '').strip()
    
    if not title or not message:
        return jsonify({"error": "Title and initial message are required"}), 400
        
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute(
        "INSERT INTO tickets (user_id, username, title, status) VALUES (?, ?, ?, 'open')",
        (user['id'], user['username'], title)
    )
    ticket_id = cursor.lastrowid
    
    cursor.execute(
        "INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, message) VALUES (?, ?, ?, ?)",
        (ticket_id, user['id'], user['username'], message)
    )
    
    conn.commit()
    conn.close()
    
    return jsonify({"message": "Ticket opened successfully", "ticket_id": ticket_id}), 201

@app.route('/api/tickets', methods=['GET'])
def api_get_user_tickets():
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user:
        return jsonify({"error": "Authentication required"}), 401
        
    conn = get_db()
    cursor = conn.cursor()
    if user['is_admin']:
        cursor.execute("SELECT * FROM tickets ORDER BY created_at DESC")
    else:
        cursor.execute("SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC", (user['id'],))
    rows = cursor.fetchall()
    conn.close()
    return jsonify([dict(row) for row in rows]), 200

@app.route('/api/tickets/<int:ticket_id>', methods=['GET'])
def api_get_ticket_details(ticket_id):
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user:
        return jsonify({"error": "Authentication required"}), 401
        
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,))
    ticket = cursor.fetchone()
    
    if not ticket:
        conn.close()
        return jsonify({"error": "Ticket not found"}), 404
        
    # Verify access
    if not user['is_admin'] and ticket['user_id'] != user['id']:
        conn.close()
        return jsonify({"error": "Unauthorized to view this ticket"}), 403
        
    cursor.execute("SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC", (ticket_id,))
    messages = cursor.fetchall()
    conn.close()
    
    return jsonify({
        "ticket": dict(ticket),
        "messages": [dict(m) for m in messages]
    }), 200

@app.route('/api/tickets/<int:ticket_id>/messages', methods=['POST'])
def api_add_ticket_message(ticket_id):
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user:
        return jsonify({"error": "Authentication required"}), 401
        
    data = request.json or {}
    message = data.get('message', '').strip()
    
    if not message:
        return jsonify({"error": "Message is required"}), 400
        
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,))
    ticket = cursor.fetchone()
    
    if not ticket:
        conn.close()
        return jsonify({"error": "Ticket not found"}), 404
        
    # Verify access
    if not user['is_admin'] and ticket['user_id'] != user['id']:
        conn.close()
        return jsonify({"error": "Unauthorized to view this ticket"}), 403
        
    cursor.execute(
        "INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, message) VALUES (?, ?, ?, ?)",
        (ticket_id, user['id'], user['username'], message)
    )
    
    # If ticket was closed, reopen it when user messages
    if ticket['status'] == 'closed' and not user['is_admin']:
        cursor.execute("UPDATE tickets SET status = 'open' WHERE id = ?", (ticket_id,))
        
    conn.commit()
    conn.close()
    
    return jsonify({"message": "Message sent successfully"}), 201

# Support Tickets (Admin Actions)
@app.route('/api/admin/tickets', methods=['GET'])
def api_admin_get_all_tickets():
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user or not user['is_admin']:
        return jsonify({"error": "Admin authorization required"}), 403
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tickets ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return jsonify([dict(row) for row in rows]), 200

@app.route('/api/admin/tickets/<int:ticket_id>/status', methods=['POST'])
def api_admin_toggle_ticket_status(ticket_id):
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user or not user['is_admin']:
        return jsonify({"error": "Admin authorization required"}), 403
        
    data = request.json or {}
    status = data.get('status', 'open').strip()
    
    if status not in ['open', 'closed']:
        return jsonify({"error": "Invalid status value"}), 400
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE tickets SET status = ? WHERE id = ?", (status, ticket_id))
    conn.commit()
    conn.close()
    
    return jsonify({"message": f"Ticket status set to {status}"}), 200

# Discord Settings (Admin-only)
@app.route('/api/admin/settings', methods=['GET', 'POST'])
def api_admin_settings():
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user or not user['is_admin']:
        return jsonify({"error": "Admin authorization required"}), 403
        
    conn = get_db()
    cursor = conn.cursor()
    
    if request.method == 'POST':
        data = request.json or {}
        webhook = data.get('discord_webhook', '').strip()
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('discord_webhook', ?)", (webhook,))
        conn.commit()
        conn.close()
        return jsonify({"message": "Settings updated successfully"}), 200
    else:
        cursor.execute("SELECT value FROM settings WHERE key = 'discord_webhook'")
        row = cursor.fetchone()
        conn.close()
        return jsonify({"discord_webhook": row['value'] if row else ''}), 200

# Chat (Polling / REST Endpoint fallback)
@app.route('/api/chat', methods=['GET'])
def api_get_chat_history():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 50")
    rows = cursor.fetchall()
    conn.close()
    
    # Return in chronological order
    result = [dict(row) for row in reversed(rows)]
    return jsonify(result), 200

@app.route('/api/chat', methods=['POST'])
def api_send_chat_message():
    auth_header = request.headers.get('Authorization', '')
    user = get_user_from_token(auth_header)
    if not user:
        return jsonify({"error": "Authentication required"}), 401
        
    data = request.json or {}
    message = data.get('message', '').strip()
    
    if not message:
        return jsonify({"error": "Message is required"}), 400
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO chat_messages (user_id, username, message) VALUES (?, ?, ?)",
        (user['id'], user['username'], message)
    )
    conn.commit()
    
    # Fetch inserted message for broadcasting
    cursor.execute("SELECT * FROM chat_messages WHERE id = ?", (cursor.lastrowid,))
    msg = cursor.fetchone()
    conn.close()
    
    msg_dict = dict(msg)
    # Broadcast to Socket.IO
    socketio.emit('new_message', msg_dict)
    
    return jsonify(msg_dict), 201


# --- WEBSOCKET EVENT HANDLERS ---

@socketio.on('join')
def handle_join(data):
    # Retrieve recent messages on connection
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 50")
    rows = cursor.fetchall()
    conn.close()
    history = [dict(row) for row in reversed(rows)]
    emit('history', history)

@socketio.on('message')
def handle_message(data):
    token = data.get('token')
    message = data.get('message', '').strip()
    user = get_user_from_token(token)
    
    if not user or not message:
        return
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO chat_messages (user_id, username, message) VALUES (?, ?, ?)",
        (user['id'], user['username'], message)
    )
    conn.commit()
    
    cursor.execute("SELECT * FROM chat_messages WHERE id = ?", (cursor.lastrowid,))
    msg = cursor.fetchone()
    conn.close()
    
    # Broadcast to all
    emit('new_message', dict(msg), broadcast=True)


# --- WEB ROUTING (Flask Web UI for Admin Panel) ---

@app.route('/')
def home():
    return redirect(url_for('admin_login'))

@app.route('/login', methods=['GET', 'POST'])
def admin_login():
    if session.get('is_admin'):
        return redirect(url_for('admin_panel'))
        
    error = None
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE username = ? AND is_admin = 1", (username,))
        user = cursor.fetchone()
        conn.close()
        
        if user and check_password_hash(user['password_hash'], password):
            session['is_admin'] = True
            session['username'] = user['username']
            session['user_id'] = user['id']
            return redirect(url_for('admin_panel'))
        else:
            error = "Invalid admin credentials."
            
    return render_template('admin_login.html', error=error)

@app.route('/logout')
def admin_logout():
    session.clear()
    return redirect(url_for('admin_login'))

@app.route('/admin')
def admin_panel():
    if not session.get('is_admin'):
        return redirect(url_for('admin_login'))
        
    conn = get_db()
    cursor = conn.cursor()
    
    # Get Announcements
    cursor.execute("SELECT * FROM announcements ORDER BY created_at DESC")
    announcements = cursor.fetchall()
    
    # Get Updates
    cursor.execute("SELECT * FROM app_updates ORDER BY created_at DESC")
    updates = cursor.fetchall()
    
    # Get Bug Reports
    cursor.execute("SELECT * FROM bug_reports ORDER BY created_at DESC")
    bugs = cursor.fetchall()
    
    # Get Tickets
    cursor.execute("SELECT * FROM tickets ORDER BY created_at DESC")
    tickets = cursor.fetchall()
    
    # Get Discord Webhook Settings
    cursor.execute("SELECT value FROM settings WHERE key = 'discord_webhook'")
    webhook_row = cursor.fetchone()
    discord_webhook = webhook_row['value'] if webhook_row else ''
    
    conn.close()
    
    return render_template(
        'admin_dashboard.html',
        announcements=announcements,
        updates=updates,
        bugs=bugs,
        tickets=tickets,
        discord_webhook=discord_webhook,
        admin_username=session['username']
    )

# Form post routes for HTML actions (dashboard modifications)
@app.route('/admin/announcements/add', methods=['POST'])
def admin_add_announcement():
    if not session.get('is_admin'):
        return redirect(url_for('admin_login'))
        
    title = request.form.get('title', '').strip()
    content = request.form.get('content', '').strip()
    
    if title and content:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("INSERT INTO announcements (title, content) VALUES (?, ?)", (title, content))
        conn.commit()
        conn.close()
        
    return redirect(url_for('admin_panel'))

@app.route('/admin/announcements/delete/<int:ann_id>', methods=['POST'])
def admin_delete_announcement(ann_id):
    if not session.get('is_admin'):
        return redirect(url_for('admin_login'))
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM announcements WHERE id = ?", (ann_id,))
    conn.commit()
    conn.close()
    return redirect(url_for('admin_panel'))

@app.route('/admin/updates/add', methods=['POST'])
def admin_add_update():
    if not session.get('is_admin'):
        return redirect(url_for('admin_login'))
        
    version = request.form.get('version', '').strip()
    changelog = request.form.get('changelog', '').strip()
    
    if version and changelog:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("INSERT INTO app_updates (version, changelog) VALUES (?, ?)", (version, changelog))
        conn.commit()
        conn.close()
        
    return redirect(url_for('admin_panel'))

@app.route('/admin/updates/delete/<int:up_id>', methods=['POST'])
def admin_delete_update(up_id):
    if not session.get('is_admin'):
        return redirect(url_for('admin_login'))
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM app_updates WHERE id = ?", (up_id,))
    conn.commit()
    conn.close()
    return redirect(url_for('admin_panel'))

@app.route('/admin/webhook/save', methods=['POST'])
def admin_save_webhook():
    if not session.get('is_admin'):
        return redirect(url_for('admin_login'))
        
    webhook = request.form.get('discord_webhook', '').strip()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('discord_webhook', ?)", (webhook,))
    conn.commit()
    conn.close()
    return redirect(url_for('admin_panel'))

@app.route('/admin/tickets/<int:ticket_id>/reply', methods=['POST'])
def admin_reply_ticket(ticket_id):
    if not session.get('is_admin'):
        return redirect(url_for('admin_login'))
        
    message = request.form.get('message', '').strip()
    if message:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, message) VALUES (?, ?, ?, ?)",
            (ticket_id, session['user_id'], session['username'], message)
        )
        conn.commit()
        conn.close()
    return redirect(url_for('admin_panel') + f"#ticket-{ticket_id}")

@app.route('/admin/tickets/<int:ticket_id>/status/<string:status>', methods=['POST'])
def admin_status_ticket(ticket_id, status):
    if not session.get('is_admin'):
        return redirect(url_for('admin_login'))
        
    if status in ['open', 'closed']:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("UPDATE tickets SET status = ? WHERE id = ?", (status, ticket_id))
        conn.commit()
        conn.close()
    return redirect(url_for('admin_panel') + f"#ticket-{ticket_id}")


if __name__ == '__main__':
    # Run server on port 5000
    socketio.run(app, debug=True, port=5000)
