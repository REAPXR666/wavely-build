import os
import requests
import json

BASE_URL = "http://127.0.0.1:5000"
TOKENS_FILE = "tokens.txt"

def run_tests():
    print("--- STARTING API VERIFICATION ---")
    
    # 1. Clean up tokens file
    if os.path.exists(TOKENS_FILE):
        os.remove(TOKENS_FILE)
        print("Cleared existing tokens.txt")
        
    # 2. Account Creator Verification
    print("\n1. Testing Account Creator (Signup)...")
    usernames = ["verify_user_1", "verify_user_2"]
    password = "verification_pass"
    
    for uname in usernames:
        email = f"{uname}@verify.com"
        payload = {"username": uname, "email": email, "password": password}
        try:
            res = requests.post(f"{BASE_URL}/api/auth/signup", json=payload, timeout=10)
            print(f"Signup {uname}: Status {res.status_code}, Response: {res.text}")
            if res.status_code == 200 and res.json().get("success"):
                with open(TOKENS_FILE, "a") as f:
                    f.write(f"{uname}:{email}:{password}\n")
        except Exception as e:
            print(f"Signup {uname} error: {e}")

    # Verify tokens file was written
    if os.path.exists(TOKENS_FILE):
        with open(TOKENS_FILE, "r") as f:
            print(f"tokens.txt contents:\n{f.read().strip()}")
    else:
        print("ERROR: tokens.txt was not created!")
        return

    # 3. Community Server Joiner Verification
    print("\n2. Testing Community Server Joiner...")
    # Use invite code from June Studio Room: srv_LeIdPxYS1tM
    invite_code = "srv_LeIdPxYS1tM"
    
    sessions = []
    for uname in usernames:
        s = requests.Session()
        # Login
        login_res = s.post(f"{BASE_URL}/api/auth/login", json={"username": uname, "password": password}, timeout=10)
        print(f"Login {uname}: Status {login_res.status_code}, Response: {login_res.text}")
        if login_res.status_code == 200 and login_res.json().get("success"):
            sessions.append((uname, s))
            
            # Join Server
            join_res = s.post(f"{BASE_URL}/api/servers/join/{invite_code}", timeout=10)
            print(f"Join server {invite_code} for {uname}: Status {join_res.status_code}, Response: {join_res.text}")

    # 4. Message Sender Verification
    print("\n3. Testing Community Server Message Sender...")
    server_id = "22704aa9-81de-42d9-bbf3-024c9d1d7a1b" # June Studio Room
    channel_id = "chan-general"
    
    for uname, s in sessions:
        msg_payload = {"server_id": server_id, "channel_id": channel_id, "content": f"Hello from automated verification by {uname}!"}
        msg_res = s.post(f"{BASE_URL}/api/servers/messages/send", json=msg_payload, timeout=10)
        print(f"Send message from {uname}: Status {msg_res.status_code}, Response: {msg_res.text}")

    # 5. Beat Battle Joiner Verification
    print("\n4. Testing Beat Battle Joiner...")
    battle_invite_code = "invite_46TYTHS2MYo" # Lo-Fi Summer Breeze
    
    for uname, s in sessions:
        join_battle_res = s.get(f"{BASE_URL}/api/battles/join/{battle_invite_code}", timeout=10)
        print(f"Join battle {battle_invite_code} for {uname}: Status {join_battle_res.status_code}, Response: {join_battle_res.text}")

    # 6. Track Submission (to allow commenting and voting)
    print("\n5. Submitting a test track entry...")
    battle_id = "36d84f42-9829-4718-8898-0e157c3538b7" # Lo-Fi Summer Breeze
    # Let's create a dummy file to upload
    dummy_file_path = "dummy_entry.mp3"
    with open(dummy_file_path, "wb") as f:
        f.write(b"MOCK MP3 DATA")
        
    track_id = None
    uname, s = sessions[0] # user 1 submits
    with open(dummy_file_path, "rb") as track_file:
        submit_res = s.post(f"{BASE_URL}/api/battles/submit", data={"battle_id": battle_id}, files={"track": track_file}, timeout=10)
        print(f"Submit track for {uname}: Status {submit_res.status_code}, Response: {submit_res.text}")
        
    # Let's load the battle data to get the track_id
    battles_res = s.get(f"{BASE_URL}/api/battles", timeout=10)
    if battles_res.status_code == 200:
        battles = battles_res.json().get("battles", [])
        for b in battles:
            if b["id"] == battle_id:
                tracks = b.get("tracks", [])
                if tracks:
                    track_id = tracks[0]["id"]
                    print(f"Found track ID: {track_id}")

    # Clean up dummy entry file
    if os.path.exists(dummy_file_path):
        os.remove(dummy_file_path)

    # 7. Beat Battle Commenter and Voter Verification
    if track_id:
        print("\n6. Testing Beat Battle Voter and Commenter...")
        # User 2 votes and comments on User 1's track
        uname2, s2 = sessions[1]
        
        # Vote
        vote_payload = {"battle_id": battle_id, "track_id": track_id, "vote": 1}
        vote_res = s2.post(f"{BASE_URL}/api/battles/vote", json=vote_payload, timeout=10)
        print(f"Vote track for {uname2}: Status {vote_res.status_code}, Response: {vote_res.text}")
        
        # Comment
        comment_payload = {"battle_id": battle_id, "track_id": track_id, "comment": "This beat is fire! Great job."}
        comment_res = s2.post(f"{BASE_URL}/api/battles/comment", json=comment_payload, timeout=10)
        print(f"Comment track for {uname2}: Status {comment_res.status_code}, Response: {comment_res.text}")
    else:
        print("\n[!] Skipping vote and comment tests because no track was successfully submitted.")

    print("\n--- VERIFICATION FINISHED ---")

if __name__ == "__main__":
    run_tests()
