import os
import sys
import unittest
import json

sys.path.insert(0, os.path.join(r'g:\HARDRIVE DATA\SPLICE CLONE\WAVELY WEBSITE V2'))

import database as db
import security as sec
import captcha as cap
from app import app

class TestWavelyEndToEnd(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        self.client = app.test_client()

    def test_end_to_end_flow(self):
        # 1. Register test user via API
        c = cap.generate_captcha()
        # Decode the answer from token
        parts = c['token'].split(':')
        # In testing, let's verify direct registration
        user_name = "testproducer_99"
        email = "producer99@test.com"
        
        # Test Direct API Auth
        res_login_fail = self.client.post('/api/auth/login', json={'username': user_name, 'password': 'Password123!'})
        self.assertEqual(res_login_fail.status_code, 401)
        print("[OK] Invalid login correctly rejected.")

        # Create user in DB
        from werkzeug.security import generate_password_hash
        conn = db.get_db()
        conn.execute("INSERT OR REPLACE INTO users (username, email, password_hash) VALUES (?, ?, ?)", (user_name, email, generate_password_hash('Password123!')))
        user_id = conn.execute("SELECT id FROM users WHERE username = ?", (user_name,)).fetchone()['id']
        conn.commit()
        conn.close()

        # Test Successful Login
        res_login = self.client.post('/api/auth/login', json={'username': user_name, 'password': 'Password123!'})
        self.assertEqual(res_login.status_code, 200)
        data = res_login.get_json()
        self.assertTrue(data['success'])
        self.assertFalse(data['subscription']['isSubscribed'])
        token = data['token']
        print("[OK] User login successful. Unsubscribed status verified.")

        # Test License Verify (Unsubscribed State)
        res_verify = self.client.post('/api/license/verify', json={
            'token': token,
            'hwid': 'TEST-HWID-ABC123XYZ',
            'pcName': 'Studio-PC',
            'osInfo': 'Windows 11',
            'appVersion': '1.0.5'
        })
        self.assertEqual(res_verify.status_code, 200)
        verify_data = res_verify.get_json()
        self.assertFalse(verify_data['isSubscribed'])
        print("[OK] License verification correctly reflects unsubscribed account state.")

        # Grant Subscription ($4.99/mo)
        from datetime import datetime, timedelta
        conn = db.get_db()
        exp = (datetime.utcnow() + timedelta(days=30)).strftime('%Y-%m-%d %H:%M:%S')
        conn.execute("INSERT INTO subscriptions (user_id, plan, status, amount, expires_at) VALUES (?, 'monthly_499', 'active', 4.99, ?)", (user_id, exp))
        conn.execute("INSERT INTO payments (user_id, amount, plan, payment_id, status) VALUES (?, 4.99, 'monthly_499', 'PAY_TEST_001', 'completed')", (user_id,))
        conn.commit()
        conn.close()

        # Re-test License Verify (Subscribed State)
        res_verify2 = self.client.post('/api/license/verify', json={
            'token': token,
            'hwid': 'TEST-HWID-ABC123XYZ'
        })
        self.assertEqual(res_verify2.status_code, 200)
        verify_data2 = res_verify2.get_json()
        self.assertTrue(verify_data2['isSubscribed'])
        self.assertEqual(verify_data2['plan'], 'monthly_499')
        print("[OK] License verification correctly reflects ACTIVE subscription.")

        # Test 5-minute Heartbeat
        res_hb = self.client.post('/api/license/heartbeat', json={
            'token': token,
            'hwid': 'TEST-HWID-ABC123XYZ'
        })
        self.assertEqual(res_hb.status_code, 200)
        self.assertTrue(res_hb.get_json()['isSubscribed'])
        print("[OK] Cryptographic Heartbeat verified.")

        # Test Financial Analytics with active payment
        fin = db.get_financial_analytics()
        self.assertEqual(fin['total_revenue'], 4.99)
        self.assertEqual(fin['mrr'], 4.99)
        self.assertEqual(fin['total_active_subscribers'], 1)
        print(f"[OK] Financial Analytics: Revenue=${fin['total_revenue']}, MRR=${fin['mrr']}, Active Subs={fin['total_active_subscribers']}.")

if __name__ == '__main__':
    unittest.main()
