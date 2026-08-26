import os
import sys
import json
from flask import session

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app import app, load_auth, save_auth, init_admin, generate_password_hash

def test_admin_initialization():
    print("[Test] Verifying admin user initialization...")
    # Clear admin if exists to test fresh creation
    auth_data = load_auth()
    if "admin" in auth_data["users"]:
        del auth_data["users"]["admin"]
        save_auth(auth_data)
        
    init_admin()
    
    auth_data = load_auth()
    assert "admin" in auth_data["users"], "Admin user not initialized!"
    admin_user = auth_data["users"]["admin"]
    assert admin_user["role"] == "admin", "Admin role not set!"
    assert admin_user["banned"] is False, "Admin user should not be banned!"
    print("[OK] Admin user initialization passed!")

def test_ip_banning_middleware():
    print("[Test] Verifying IP ban middleware...")
    auth_data = load_auth()
    auth_data["banned_ips"] = ["1.2.3.4"]
    save_auth(auth_data)
    
    client = app.test_client()
    
    # Try request from banned IP
    response = client.get('/', headers={'X-Forwarded-For': '1.2.3.4'})
    assert response.status_code == 403, f"Expected 403 Forbidden for banned IP, got {response.status_code}"
    
    # Try request from clean IP
    response = client.get('/', headers={'X-Forwarded-For': '5.6.7.8'})
    assert response.status_code == 200, f"Expected 200 OK for clean IP, got {response.status_code}"
    
    # Clean up
    auth_data = load_auth()
    auth_data["banned_ips"] = []
    save_auth(auth_data)
    print("[OK] IP ban middleware passed!")

def test_admin_api_endpoints():
    print("[Test] Verifying admin REST API endpoints...")
    
    # Create a developer user to test operations on
    auth_data = load_auth()
    auth_data["users"]["test_dev"] = {
        "email": "test@wavely.io",
        "password_hash": generate_password_hash("password123"),
        "role": "developer",
        "banned": False,
        "api_keys": []
    }
    save_auth(auth_data)
    
    client = app.test_client()
    
    # Without logging in as admin, it should fail
    response = client.get('/api/admin/users')
    assert response.status_code == 401, f"Expected 401 Unauthorized, got {response.status_code}"
    
    # Simulate session login as admin
    with client.session_transaction() as sess:
        sess['username'] = 'admin'
        
    # Now it should succeed
    response = client.get('/api/admin/users')
    assert response.status_code == 200, f"Expected 200 OK, got {response.status_code}"
    users = json.loads(response.data.decode('utf-8'))["users"]
    assert any(u["username"] == "test_dev" for u in users), "Test developer not found in users list!"
    
    # Ban the user
    response = client.post('/api/admin/users/test_dev/ban')
    assert response.status_code == 200
    
    auth_data = load_auth()
    assert auth_data["users"]["test_dev"]["banned"] is True, "User ban failed!"
    
    # Unban the user
    response = client.post('/api/admin/users/test_dev/unban')
    assert response.status_code == 200
    
    auth_data = load_auth()
    assert auth_data["users"]["test_dev"]["banned"] is False, "User unban failed!"
    
    # Delete the user
    response = client.delete('/api/admin/users/test_dev')
    assert response.status_code == 200
    
    auth_data = load_auth()
    assert "test_dev" not in auth_data["users"], "User deletion failed!"
    
    # Verify cannot ban admin
    response = client.post('/api/admin/users/admin/ban')
    assert response.status_code == 400, "Should prevent banning admin!"
    
    # Clean up
    init_admin()
    print("[OK] Admin endpoints verified successfully!")

if __name__ == "__main__":
    try:
        test_admin_initialization()
        test_ip_banning_middleware()
        test_admin_api_endpoints()
        print("\nAll administration test suites passed!")
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)
