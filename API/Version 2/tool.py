import os
import sys
import uuid
import random
import string
import requests
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

# Global configuration
BASE_URL = "https://wavely.lol"
TOKENS_FILE = "tokens.txt"
print_lock = threading.Lock()
file_lock = threading.Lock()

def safe_print(message):
    with print_lock:
        print(message)

def get_input(prompt, default=None):
    if default is not None:
        val = input(f"{prompt} [{default}]: ").strip()
        return val if val else default
    else:
        while True:
            val = input(f"{prompt}: ").strip()
            if val:
                return val
            print("Input cannot be empty. Please try again.")

def generate_random_string(length=8):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))

def load_accounts():
    accounts = []
    if not os.path.exists(TOKENS_FILE):
        return accounts
    
    with open(TOKENS_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(":")
            if len(parts) >= 2:
                # Format: username:email:password or username:password
                if len(parts) == 2:
                    username, password = parts[0], parts[1]
                    email = f"{username}@example.com"
                else:
                    username, email, password = parts[0], parts[1], parts[2]
                accounts.append({
                    "username": username,
                    "email": email,
                    "password": password
                })
    return accounts

def save_account_to_file(username, email, password):
    with file_lock:
        with open(TOKENS_FILE, "a", encoding="utf-8") as f:
            f.write(f"{username}:{email}:{password}\n")

def login_account(session, username, password):
    login_url = f"{BASE_URL}/api/auth/login"
    try:
        response = session.post(login_url, json={
            "username": username,
            "password": password
        }, timeout=10)
        
        if response.status_code == 200:
            res_json = response.json()
            if res_json.get("success"):
                return True, "Login successful"
            else:
                return False, res_json.get("error", "Login failed")
        else:
            try:
                err_msg = response.json().get("error", f"HTTP {response.status_code}")
            except Exception:
                err_msg = f"HTTP {response.status_code}"
            return False, err_msg
    except Exception as e:
        return False, str(e)

# --- ACCOUNT CREATOR ---
def create_account_worker(index, prefix, password_mode, custom_password):
    session = requests.Session()
    username = f"{prefix}_{generate_random_string(6)}"
    email = f"{username}@{generate_random_string(5)}.com"
    password = custom_password if password_mode == "static" else f"Pass_{generate_random_string(8)}"
    
    signup_url = f"{BASE_URL}/api/auth/signup"
    try:
        response = session.post(signup_url, json={
            "username": username,
            "email": email,
            "password": password
        }, timeout=10)
        
        if response.status_code == 200:
            res_json = response.json()
            if res_json.get("success"):
                save_account_to_file(username, email, password)
                safe_print(f"[Thread {index}] [SUCCESS] Created account: {username}")
                return True
            else:
                safe_print(f"[Thread {index}] [FAILED] Account {username} failed: {res_json.get('error')}")
        elif response.status_code == 429:
            safe_print(f"[Thread {index}] [RATE LIMIT] Too many requests (429). Please slow down.")
        else:
            try:
                err_msg = response.json().get("error", f"HTTP {response.status_code}")
            except Exception:
                err_msg = f"HTTP {response.status_code}"
            safe_print(f"[Thread {index}] [FAILED] HTTP {response.status_code}: {err_msg}")
    except Exception as e:
        safe_print(f"[Thread {index}] [ERROR] Connection error: {e}")
    return False

def handle_account_creator():
    print("\n--- Account Creator ---")
    count = int(get_input("How many accounts to create", "10"))
    prefix = get_input("Username prefix", "bot")
    pw_choice = get_input("Password mode (static/random)", "random").lower()
    
    custom_password = ""
    if pw_choice == "static":
        custom_password = get_input("Enter password to use (min 6 chars)")
        while len(custom_password) < 6:
            custom_password = get_input("Password must be at least 6 characters. Enter password")
            
    threads = int(get_input("Number of threads", "5"))
    
    safe_print(f"\nStarting creation of {count} accounts using {threads} threads...")
    success_count = 0
    with ThreadPoolExecutor(max_workers=threads) as executor:
        futures = [
            executor.submit(create_account_worker, i+1, prefix, pw_choice, custom_password)
            for i in range(count)
        ]
        for fut in as_completed(futures):
            if fut.result():
                success_count += 1
                
    safe_print(f"\nFinished. Successfully created {success_count}/{count} accounts. Saved to {TOKENS_FILE}.")

# --- COMMUNITY SERVER JOINER ---
def join_server_worker(index, account, invite_code):
    session = requests.Session()
    logged_in, log_msg = login_account(session, account["username"], account["password"])
    if not logged_in:
        safe_print(f"[Thread {index}] [LOGIN FAILED] {account['username']}: {log_msg}")
        return False
    
    join_url = f"{BASE_URL}/api/servers/join/{invite_code}"
    try:
        response = session.post(join_url, timeout=10)
        if response.status_code == 200:
            res_json = response.json()
            if res_json.get("success"):
                safe_print(f"[Thread {index}] [SUCCESS] {account['username']} joined server: {res_json.get('name')}")
                return True
            else:
                safe_print(f"[Thread {index}] [FAILED] {account['username']} failed to join: {res_json.get('error')}")
        else:
            try:
                err_msg = response.json().get("error", f"HTTP {response.status_code}")
            except Exception:
                err_msg = f"HTTP {response.status_code}"
            safe_print(f"[Thread {index}] [FAILED] {account['username']} HTTP {response.status_code}: {err_msg}")
    except Exception as e:
        safe_print(f"[Thread {index}] [ERROR] {account['username']} connection error: {e}")
    return False

def handle_server_joiner():
    print("\n--- Community Server Joiner ---")
    accounts = load_accounts()
    if not accounts:
        safe_print(f"[!] No accounts found in {TOKENS_FILE}. Please create accounts first.")
        return
    
    invite_code = get_input("Enter server invite code (e.g. srv_xyz)")
    threads = int(get_input("Number of threads", "5"))
    
    safe_print(f"\nAttempting to join server {invite_code} with {len(accounts)} accounts using {threads} threads...")
    success_count = 0
    with ThreadPoolExecutor(max_workers=threads) as executor:
        futures = [
            executor.submit(join_server_worker, i+1, acc, invite_code)
            for i, acc in enumerate(accounts)
        ]
        for fut in as_completed(futures):
            if fut.result():
                success_count += 1
                
    safe_print(f"\nFinished. Successfully joined {success_count}/{len(accounts)} accounts to the server.")

# --- COMMUNITY SERVER MESSAGE SENDER ---
def send_message_worker(index, account, server_id, channel_id, content):
    session = requests.Session()
    logged_in, log_msg = login_account(session, account["username"], account["password"])
    if not logged_in:
        safe_print(f"[Thread {index}] [LOGIN FAILED] {account['username']}: {log_msg}")
        return False
    
    send_url = f"{BASE_URL}/api/servers/messages/send"
    try:
        response = session.post(send_url, json={
            "server_id": server_id,
            "channel_id": channel_id,
            "content": content
        }, timeout=10)
        
        if response.status_code == 200:
            res_json = response.json()
            if res_json.get("success"):
                safe_print(f"[Thread {index}] [SUCCESS] {account['username']} sent message.")
                return True
            else:
                safe_print(f"[Thread {index}] [FAILED] {account['username']} failed to send: {res_json.get('error')}")
        else:
            try:
                err_msg = response.json().get("error", f"HTTP {response.status_code}")
            except Exception:
                err_msg = f"HTTP {response.status_code}"
            safe_print(f"[Thread {index}] [FAILED] {account['username']} HTTP {response.status_code}: {err_msg}")
    except Exception as e:
        safe_print(f"[Thread {index}] [ERROR] {account['username']} connection error: {e}")
    return False

def handle_message_sender():
    print("\n--- Community Server Message Sender ---")
    accounts = load_accounts()
    if not accounts:
        safe_print(f"[!] No accounts found in {TOKENS_FILE}. Please create accounts first.")
        return
    
    server_id = get_input("Enter server ID")
    channel_id = get_input("Enter channel ID")
    content = get_input("Enter message content")
    threads = int(get_input("Number of threads", "5"))
    
    safe_print(f"\nSending messages to channel {channel_id} with {len(accounts)} accounts using {threads} threads...")
    success_count = 0
    with ThreadPoolExecutor(max_workers=threads) as executor:
        futures = [
            executor.submit(send_message_worker, i+1, acc, server_id, channel_id, content)
            for i, acc in enumerate(accounts)
        ]
        for fut in as_completed(futures):
            if fut.result():
                success_count += 1
                
    safe_print(f"\nFinished. Successfully sent {success_count}/{len(accounts)} messages.")

# --- BEAT BATTLE VOTER ---
def vote_battle_worker(index, account, battle_id, track_id, vote_val):
    session = requests.Session()
    logged_in, log_msg = login_account(session, account["username"], account["password"])
    if not logged_in:
        safe_print(f"[Thread {index}] [LOGIN FAILED] {account['username']}: {log_msg}")
        return False
    
    vote_url = f"{BASE_URL}/api/battles/vote"
    try:
        response = session.post(vote_url, json={
            "battle_id": battle_id,
            "track_id": track_id,
            "vote": vote_val
        }, timeout=10)
        
        if response.status_code == 200:
            res_json = response.json()
            if res_json.get("success"):
                safe_print(f"[Thread {index}] [SUCCESS] {account['username']} voted: {vote_val}")
                return True
            else:
                safe_print(f"[Thread {index}] [FAILED] {account['username']} vote failed: {res_json.get('error')}")
        else:
            try:
                err_msg = response.json().get("error", f"HTTP {response.status_code}")
            except Exception:
                err_msg = f"HTTP {response.status_code}"
            safe_print(f"[Thread {index}] [FAILED] {account['username']} HTTP {response.status_code}: {err_msg}")
    except Exception as e:
        safe_print(f"[Thread {index}] [ERROR] {account['username']} connection error: {e}")
    return False

def handle_battle_voter():
    print("\n--- Beat Battle Voter ---")
    accounts = load_accounts()
    if not accounts:
        safe_print(f"[!] No accounts found in {TOKENS_FILE}. Please create accounts first.")
        return
    
    battle_id = get_input("Enter battle ID")
    track_id = get_input("Enter track ID")
    vote_type = get_input("Vote type (upvote/downvote/clear)", "upvote").lower()
    
    vote_val = 1
    if vote_type == "downvote":
        vote_val = -1
    elif vote_type == "clear":
        vote_val = 0
        
    threads = int(get_input("Number of threads", "5"))
    
    safe_print(f"\nCasting {vote_type} ({vote_val}) with {len(accounts)} accounts using {threads} threads...")
    success_count = 0
    with ThreadPoolExecutor(max_workers=threads) as executor:
        futures = [
            executor.submit(vote_battle_worker, i+1, acc, battle_id, track_id, vote_val)
            for i, acc in enumerate(accounts)
        ]
        for fut in as_completed(futures):
            if fut.result():
                success_count += 1
                
    safe_print(f"\nFinished. Successfully cast {success_count}/{len(accounts)} votes.")

# --- BEAT BATTLE COMMENTER ---
def comment_battle_worker(index, account, battle_id, track_id, comment_text):
    session = requests.Session()
    logged_in, log_msg = login_account(session, account["username"], account["password"])
    if not logged_in:
        safe_print(f"[Thread {index}] [LOGIN FAILED] {account['username']}: {log_msg}")
        return False
    
    comment_url = f"{BASE_URL}/api/battles/comment"
    try:
        response = session.post(comment_url, json={
            "battle_id": battle_id,
            "track_id": track_id,
            "comment": comment_text
        }, timeout=10)
        
        if response.status_code == 200:
            res_json = response.json()
            if res_json.get("success"):
                safe_print(f"[Thread {index}] [SUCCESS] {account['username']} commented: '{comment_text[:20]}...'")
                return True
            else:
                safe_print(f"[Thread {index}] [FAILED] {account['username']} comment failed: {res_json.get('error')}")
        else:
            try:
                err_msg = response.json().get("error", f"HTTP {response.status_code}")
            except Exception:
                err_msg = f"HTTP {response.status_code}"
            safe_print(f"[Thread {index}] [FAILED] {account['username']} HTTP {response.status_code}: {err_msg}")
    except Exception as e:
        safe_print(f"[Thread {index}] [ERROR] {account['username']} connection error: {e}")
    return False

def handle_battle_commenter():
    print("\n--- Beat Battle Commenter ---")
    accounts = load_accounts()
    if not accounts:
        safe_print(f"[!] No accounts found in {TOKENS_FILE}. Please create accounts first.")
        return
    
    battle_id = get_input("Enter battle ID")
    track_id = get_input("Enter track ID")
    comment_text = get_input("Enter comment text")
    threads = int(get_input("Number of threads", "5"))
    
    safe_print(f"\nCommenting with {len(accounts)} accounts using {threads} threads...")
    success_count = 0
    with ThreadPoolExecutor(max_workers=threads) as executor:
        futures = [
            executor.submit(comment_battle_worker, i+1, acc, battle_id, track_id, comment_text)
            for i, acc in enumerate(accounts)
        ]
        for fut in as_completed(futures):
            if fut.result():
                success_count += 1
                
    safe_print(f"\nFinished. Successfully commented with {success_count}/{len(accounts)} accounts.")

# --- BEAT BATTLE JOINER ---
def join_battle_worker(index, account, invite_code):
    session = requests.Session()
    logged_in, log_msg = login_account(session, account["username"], account["password"])
    if not logged_in:
        safe_print(f"[Thread {index}] [LOGIN FAILED] {account['username']}: {log_msg}")
        return False
    
    join_url = f"{BASE_URL}/api/battles/join/{invite_code}"
    try:
        response = session.get(join_url, timeout=10)
        if response.status_code == 200:
            res_json = response.json()
            if res_json.get("success"):
                safe_print(f"[Thread {index}] [SUCCESS] {account['username']} joined battle: {res_json.get('title')}")
                return True
            else:
                safe_print(f"[Thread {index}] [FAILED] {account['username']} failed to join battle: {res_json.get('error')}")
        else:
            try:
                err_msg = response.json().get("error", f"HTTP {response.status_code}")
            except Exception:
                err_msg = f"HTTP {response.status_code}"
            safe_print(f"[Thread {index}] [FAILED] {account['username']} HTTP {response.status_code}: {err_msg}")
    except Exception as e:
        safe_print(f"[Thread {index}] [ERROR] {account['username']} connection error: {e}")
    return False

def handle_battle_joiner():
    print("\n--- Beat Battle Joiner ---")
    accounts = load_accounts()
    if not accounts:
        safe_print(f"[!] No accounts found in {TOKENS_FILE}. Please create accounts first.")
        return
    
    invite_code = get_input("Enter battle invite code (e.g. invite_xyz)")
    threads = int(get_input("Number of threads", "5"))
    
    safe_print(f"\nAttempting to join battle {invite_code} with {len(accounts)} accounts using {threads} threads...")
    success_count = 0
    with ThreadPoolExecutor(max_workers=threads) as executor:
        futures = [
            executor.submit(join_battle_worker, i+1, acc, invite_code)
            for i, acc in enumerate(accounts)
        ]
        for fut in as_completed(futures):
            if fut.result():
                success_count += 1
                
    safe_print(f"\nFinished. Successfully joined {success_count}/{len(accounts)} accounts to the battle.")

def main_menu():
    global BASE_URL
    print("=" * 50)
    print("          WAVELY V2 API INTERACTION TOOL")
    print("=" * 50)
    
    BASE_URL = get_input("Enter API Base URL", BASE_URL)
    
    while True:
        accounts = load_accounts()
        print("\n" + "=" * 40)
        print(f" Loaded accounts: {len(accounts)} from {TOKENS_FILE}")
        print("=" * 40)
        print("1. Account Creator")
        print("2. Community Server Joiner")
        print("3. Community Server Message Sender")
        print("4. Beat Battle Voter")
        print("5. Beat Battle Commenter")
        print("6. Beat Battle Joiner")
        print("7. Exit")
        print("=" * 40)
        
        choice = input("Select an option (1-7): ").strip()
        
        if choice == "1":
            handle_account_creator()
        elif choice == "2":
            handle_server_joiner()
        elif choice == "3":
            handle_message_sender()
        elif choice == "4":
            handle_battle_voter()
        elif choice == "5":
            handle_battle_commenter()
        elif choice == "6":
            handle_battle_joiner()
        elif choice == "7":
            print("Exiting tool. Goodbye!")
            sys.exit(0)
        else:
            print("Invalid selection. Please choose an option from 1 to 7.")

if __name__ == "__main__":
    try:
        main_menu()
    except KeyboardInterrupt:
        print("\nTool execution interrupted by user. Exiting.")
        sys.exit(0)
