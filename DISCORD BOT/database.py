import sqlite3
import time
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "bot_database.db")

def get_db_connection():
    """Returns a connection to the SQLite database with dict factory enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initializes database tables if they do not exist."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Levels Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS levels (
        user_id INTEGER,
        guild_id INTEGER,
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 0,
        last_xp_time REAL DEFAULT 0,
        PRIMARY KEY (user_id, guild_id)
    )
    """)
    
    # Warnings Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS warnings (
        warning_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        guild_id INTEGER,
        moderator_id INTEGER,
        reason TEXT,
        timestamp REAL
    )
    """)
    
    # Tickets Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tickets (
        channel_id INTEGER PRIMARY KEY,
        user_id INTEGER,
        guild_id INTEGER,
        claimed_by INTEGER DEFAULT NULL,
        status TEXT DEFAULT 'open',
        created_at REAL
    )
    """)
    
    conn.commit()
    conn.close()

# --- LEVELING SYSTEM FUNCTIONS ---

def get_xp_needed(level):
    """Calculates XP needed to clear the current level and reach the next level."""
    # Level 0 -> 1: 100 XP
    # Level 1 -> 2: 200 XP
    # Level 2 -> 3: 300 XP etc.
    return 100 * level + 100

def add_xp(user_id, guild_id, xp_amount, cooldown=60):
    """
    Adds XP to a user with a cooldown.
    Returns: (leveled_up: bool, new_level: int, new_xp: int) or None if on cooldown.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    current_time = time.time()
    
    # Retrieve user's current level and XP
    cursor.execute(
        "SELECT xp, level, last_xp_time FROM levels WHERE user_id = ? AND guild_id = ?",
        (user_id, guild_id)
    )
    row = cursor.fetchone()
    
    if row:
        xp = row['xp']
        level = row['level']
        last_xp_time = row['last_xp_time']
        
        # Check cooldown
        if current_time - last_xp_time < cooldown:
            conn.close()
            return None
            
        new_xp = xp + xp_amount
        new_level = level
        leveled_up = False
        
        # Check if user has leveled up
        # A user can level up multiple times in a single large XP drop (though rare with normal chat XP)
        while True:
            xp_needed = get_xp_needed(new_level)
            if new_xp >= xp_needed:
                new_xp -= xp_needed
                new_level += 1
                leveled_up = True
            else:
                break
                
        cursor.execute(
            "UPDATE levels SET xp = ?, level = ?, last_xp_time = ? WHERE user_id = ? AND guild_id = ?",
            (new_xp, new_level, current_time, user_id, guild_id)
        )
    else:
        # User is not in database yet
        new_xp = xp_amount
        new_level = 0
        leveled_up = False
        
        xp_needed = get_xp_needed(0)
        if new_xp >= xp_needed:
            new_xp -= xp_needed
            new_level = 1
            leveled_up = True
            
        cursor.execute(
            "INSERT INTO levels (user_id, guild_id, xp, level, last_xp_time) VALUES (?, ?, ?, ?, ?)",
            (user_id, guild_id, new_xp, new_level, current_time)
        )
        
    conn.commit()
    conn.close()
    return leveled_up, new_level, new_xp

def get_user_stats(user_id, guild_id):
    """
    Retrieves a user's level, xp, rank, and total users in the guild.
    Returns: (level, xp, rank, total_users) or (0, 0, None, 0) if not found.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Retrieve all users sorted by level (descending) then xp (descending)
    cursor.execute(
        "SELECT user_id, level, xp FROM levels WHERE guild_id = ? ORDER BY level DESC, xp DESC",
        (guild_id,)
    )
    rows = cursor.fetchall()
    conn.close()
    
    total_users = len(rows)
    if total_users == 0:
        return 0, 0, None, 0
        
    for index, row in enumerate(rows):
        if row['user_id'] == user_id:
            return row['level'], row['xp'], index + 1, total_users
            
    return 0, 0, None, total_users

def get_leaderboard(guild_id, limit=10):
    """Returns the top users in the guild sorted by level and xp."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT user_id, level, xp FROM levels WHERE guild_id = ? ORDER BY level DESC, xp DESC LIMIT ?",
        (guild_id, limit)
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def admin_set_level(user_id, guild_id, level, xp=0):
    """Forced overwrite of a user's leveling metrics by a moderator."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO levels (user_id, guild_id, level, xp, last_xp_time) VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(user_id, guild_id) DO UPDATE SET level = ?, xp = ?",
        (user_id, guild_id, level, xp, 0, level, xp)
    )
    conn.commit()
    conn.close()

def admin_add_xp(user_id, guild_id, xp_amount):
    """Directly adds XP (bypassing cooldown) and handles level calculations."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        "SELECT xp, level FROM levels WHERE user_id = ? AND guild_id = ?",
        (user_id, guild_id)
    )
    row = cursor.fetchone()
    
    if row:
        xp = row['xp']
        level = row['level']
        new_xp = xp + xp_amount
        new_level = level
        leveled_up = False
        
        while True:
            xp_needed = get_xp_needed(new_level)
            if new_xp >= xp_needed:
                new_xp -= xp_needed
                new_level += 1
                leveled_up = True
            else:
                break
                
        cursor.execute(
            "UPDATE levels SET xp = ?, level = ? WHERE user_id = ? AND guild_id = ?",
            (new_xp, new_level, user_id, guild_id)
        )
    else:
        new_xp = xp_amount
        new_level = 0
        leveled_up = False
        
        xp_needed = get_xp_needed(0)
        if new_xp >= xp_needed:
            new_xp -= xp_needed
            new_level = 1
            leveled_up = True
            
        cursor.execute(
            "INSERT INTO levels (user_id, guild_id, xp, level, last_xp_time) VALUES (?, ?, ?, ?, ?)",
            (user_id, guild_id, new_xp, new_level, 0)
        )
        
    conn.commit()
    conn.close()
    return leveled_up, new_level, new_xp

def admin_reset_level(user_id, guild_id):
    """Resets user's leveling metrics to 0."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "DELETE FROM levels WHERE user_id = ? AND guild_id = ?",
        (user_id, guild_id)
    )
    conn.commit()
    conn.close()

# --- WARNINGS FUNCTIONS ---

def add_warning(user_id, guild_id, moderator_id, reason):
    """Registers a warning for a user. Returns total warnings count."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        "INSERT INTO warnings (user_id, guild_id, moderator_id, reason, timestamp) VALUES (?, ?, ?, ?, ?)",
        (user_id, guild_id, moderator_id, reason, time.time())
    )
    
    cursor.execute(
        "SELECT COUNT(*) as count FROM warnings WHERE user_id = ? AND guild_id = ?",
        (user_id, guild_id)
    )
    row = cursor.fetchone()
    count = row['count']
    
    conn.commit()
    conn.close()
    return count

def get_warnings(user_id, guild_id):
    """Retrieves all warning details for a user."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT warning_id, moderator_id, reason, timestamp FROM warnings WHERE user_id = ? AND guild_id = ? ORDER BY timestamp DESC",
        (user_id, guild_id)
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def clear_warnings(user_id, guild_id):
    """Deletes all warnings for a user. Returns count of warnings deleted."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "DELETE FROM warnings WHERE user_id = ? AND guild_id = ?",
        (user_id, guild_id)
    )
    deleted_count = cursor.rowcount
    conn.commit()
    conn.close()
    return deleted_count

# --- TICKET SYSTEM FUNCTIONS ---

def create_ticket(channel_id, user_id, guild_id):
    """Registers a new open ticket."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO tickets (channel_id, user_id, guild_id, status, created_at) VALUES (?, ?, ?, 'open', ?)",
        (channel_id, user_id, guild_id, time.time())
    )
    conn.commit()
    conn.close()

def claim_ticket(channel_id, moderator_id):
    """Updates a ticket status as claimed by a staff member."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE tickets SET claimed_by = ? WHERE channel_id = ?",
        (moderator_id, channel_id)
    )
    conn.commit()
    conn.close()

def close_ticket(channel_id):
    """Updates a ticket status as closed."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE tickets SET status = 'closed' WHERE channel_id = ?",
        (channel_id,)
    )
    conn.commit()
    conn.close()

def get_ticket(channel_id):
    """Fetches details of a registered ticket channel."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tickets WHERE channel_id = ?", (channel_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_user_open_ticket(user_id, guild_id):
    """Checks if a user currently has an open ticket. Returns channel_id or None."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT channel_id FROM tickets WHERE user_id = ? AND guild_id = ? AND status = 'open'",
        (user_id, guild_id)
    )
    row = cursor.fetchone()
    conn.close()
    return row['channel_id'] if row else None
