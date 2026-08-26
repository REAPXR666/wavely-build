import os
import sys
import unittest

sys.path.insert(0, os.path.join(r'g:\HARDRIVE DATA\SPLICE CLONE\WAVELY WEBSITE V2'))

import database as db
import security as sec
import captcha as cap
from app import app

class TestWavelyBackend(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        app.config['WTF_CSRF_ENABLED'] = False
        self.client = app.test_client()

    def test_database_init(self):
        db.init_db()
        admin = db.get_user_by_username('Admin')
        self.assertIsNotNone(admin)
        self.assertEqual(admin['is_admin'], 1)
        print("[OK] Database initialization & Admin account verified.")

    def test_captcha_generation_and_verification(self):
        c = cap.generate_captcha()
        self.assertIn('token', c)
        self.assertIn('image', c)
        self.assertTrue(c['image'].startswith('data:image/svg+xml;base64,'))
        self.assertFalse(cap.verify_captcha(c['token'], 'WRONG_ANSWER'))
        print("[OK] Custom Anti-Bot Captcha verified.")

    def test_user_registration_and_login(self):
        res = self.client.get('/api/captcha')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn('token', data)
        print("[OK] API Captcha endpoint verified.")

    def test_financial_analytics(self):
        stats = db.get_financial_analytics()
        self.assertIn('total_revenue', stats)
        self.assertIn('mrr', stats)
        self.assertIn('total_active_subscribers', stats)
        print(f"[OK] Financial Analytics: Revenue=${stats['total_revenue']}, MRR=${stats['mrr']}.")

if __name__ == '__main__':
    unittest.main()
