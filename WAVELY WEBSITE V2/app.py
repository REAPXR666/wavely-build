import os
import time
import uuid
import hmac
from datetime import datetime, timedelta
from flask import (
    Flask, request, jsonify, render_template, redirect, url_for, 
    session, flash, abort, send_from_directory
)
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
from stripe import StripeClient, Webhook, SignatureVerificationError, StripeError

import database as db
import security as sec
import captcha as cap

load_dotenv()

app = Flask(__name__)
DEFAULT_DEVELOPMENT_SECRET = 'wavely-development-only-change-me'
app.config['SECRET_KEY'] = os.environ.get(
    'WAVELY_SECRET_KEY',
    DEFAULT_DEVELOPMENT_SECRET
)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('APP_BASE_URL', '').startswith('https://')
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

CORS(app, supports_credentials=True)

# Initialize database tables & seed master admin
db.init_db()

STRIPE_PLANS = {
    'monthly_499': {
        'price_env': 'STRIPE_MONTHLY_PRICE_ID',
        'label': 'Monthly Pro',
        'fallback_amount': 4.99,
        'fallback_days': 31,
    },
    'annual_45': {
        'price_env': 'STRIPE_ANNUAL_PRICE_ID',
        'label': 'Annual Pro',
        'fallback_amount': 45.00,
        'fallback_days': 366,
    },
}


def get_stripe_client():
    """Return a configured Stripe client without ever reading keys from the DB."""
    secret_key = os.environ.get('STRIPE_SECRET_KEY', '').strip()
    if not secret_key:
        raise RuntimeError('Stripe is not configured. STRIPE_SECRET_KEY is missing.')
    if secret_key.startswith('sk_live_') and app.config['SECRET_KEY'] == DEFAULT_DEVELOPMENT_SECRET:
        raise RuntimeError('WAVELY_SECRET_KEY must be configured before using live Stripe payments.')
    return StripeClient(secret_key, max_network_retries=2)


def get_checkout_base_url():
    """Use an explicit trusted origin for Stripe redirects in production."""
    base_url = os.environ.get('APP_BASE_URL', '').strip().rstrip('/')
    if not base_url and (app.debug or app.testing):
        base_url = request.url_root.rstrip('/')
    if not base_url:
        raise RuntimeError('APP_BASE_URL must be set for Stripe Checkout.')
    if os.environ.get('STRIPE_SECRET_KEY', '').startswith('sk_live_') and not base_url.startswith('https://'):
        raise RuntimeError('APP_BASE_URL must use HTTPS with a live Stripe key.')
    return base_url


def get_csrf_token():
    token = session.get('csrf_token')
    if not token:
        token = uuid.uuid4().hex + uuid.uuid4().hex
        session['csrf_token'] = token
    return token


def valid_csrf_token(candidate):
    expected = session.get('csrf_token', '')
    return bool(expected and candidate and hmac.compare_digest(expected, candidate))


def stripe_object_id(value):
    if isinstance(value, str):
        return value
    if value:
        return value.get('id')
    return None


def stripe_subscription_period_end(stripe_subscription):
    """Stripe moved billing periods from subscriptions to subscription items."""
    periods = []
    for item in (stripe_subscription.get('items') or {}).get('data', []):
        if item.get('current_period_end'):
            periods.append(int(item['current_period_end']))
    if periods:
        return max(periods)
    legacy_period = stripe_subscription.get('current_period_end')
    return int(legacy_period) if legacy_period else None


def stripe_plan_from_subscription(stripe_subscription):
    metadata = stripe_subscription.get('metadata') or {}
    if metadata.get('wavely_plan') in STRIPE_PLANS:
        return metadata['wavely_plan']

    items = (stripe_subscription.get('items') or {}).get('data', [])
    if items:
        price = items[0].get('price') or {}
        price_id = stripe_object_id(price)
        if not price_id:
            pricing = items[0].get('pricing') or {}
            price_id = stripe_object_id(pricing.get('price_details'))
        for plan, config in STRIPE_PLANS.items():
            if price_id and price_id == os.environ.get(config['price_env']):
                return plan
    return None


def stripe_user_id(stripe_subscription):
    metadata = stripe_subscription.get('metadata') or {}
    if str(metadata.get('wavely_user_id', '')).isdigit():
        return int(metadata['wavely_user_id'])

    subscription_id = stripe_subscription.get('id')
    customer_id = stripe_object_id(stripe_subscription.get('customer'))
    conn = db.get_db()
    row = conn.execute('''
        SELECT user_id FROM subscriptions
        WHERE stripe_subscription_id = ? OR stripe_customer_id = ?
        ORDER BY id DESC LIMIT 1
    ''', (subscription_id, customer_id)).fetchone()
    conn.close()
    return row['user_id'] if row else None


def sync_stripe_subscription(stripe_subscription, user_id=None, plan=None):
    subscription_id = stripe_subscription.get('id')
    customer_id = stripe_object_id(stripe_subscription.get('customer'))
    user_id = user_id or stripe_user_id(stripe_subscription)
    plan = plan or stripe_plan_from_subscription(stripe_subscription)
    if not subscription_id or not user_id or plan not in STRIPE_PLANS:
        raise ValueError('Stripe subscription is missing Wavely ownership metadata.')

    stripe_status = stripe_subscription.get('status', 'incomplete')
    local_status = 'active' if stripe_status in ('active', 'trialing') else stripe_status
    period_end = stripe_subscription_period_end(stripe_subscription)
    if not period_end:
        period_end = int(time.time()) + STRIPE_PLANS[plan]['fallback_days'] * 86400
    expires_at = datetime.utcfromtimestamp(period_end).strftime('%Y-%m-%d %H:%M:%S')

    items = (stripe_subscription.get('items') or {}).get('data', [])
    price = (items[0].get('price') or {}) if items else {}
    unit_amount = price.get('unit_amount') if hasattr(price, 'get') else None
    amount = (unit_amount / 100.0) if unit_amount is not None else STRIPE_PLANS[plan]['fallback_amount']
    auto_renew = int(local_status == 'active' and not stripe_subscription.get('cancel_at_period_end', False))

    conn = db.get_db()
    existing = conn.execute(
        'SELECT id FROM subscriptions WHERE stripe_subscription_id = ?',
        (subscription_id,)
    ).fetchone()
    if local_status == 'active':
        conn.execute('''
            UPDATE subscriptions SET status = 'replaced'
            WHERE user_id = ? AND status = 'active'
              AND (stripe_subscription_id IS NULL OR stripe_subscription_id != ?)
        ''', (user_id, subscription_id))
    if existing:
        conn.execute('''
            UPDATE subscriptions
            SET user_id = ?, plan = ?, status = ?, amount = ?, expires_at = ?,
                auto_renew = ?, stripe_customer_id = ?
            WHERE stripe_subscription_id = ?
        ''', (user_id, plan, local_status, amount, expires_at, auto_renew,
              customer_id, subscription_id))
    else:
        conn.execute('''
            INSERT INTO subscriptions
            (user_id, plan, status, amount, expires_at, auto_renew,
             stripe_customer_id, stripe_subscription_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (user_id, plan, local_status, amount, expires_at, auto_renew,
              customer_id, subscription_id))
    conn.commit()
    conn.close()
    return user_id, plan


def invoice_subscription_id(invoice):
    direct = stripe_object_id(invoice.get('subscription'))
    if direct:
        return direct
    parent = invoice.get('parent') or {}
    details = parent.get('subscription_details') or {}
    return stripe_object_id(details.get('subscription'))


def record_stripe_invoice(invoice, user_id, plan, status):
    invoice_id = invoice.get('id')
    if not invoice_id:
        return
    amount_cents = invoice.get('amount_paid') if status == 'completed' else invoice.get('amount_due')
    amount = (amount_cents or 0) / 100.0
    currency = (invoice.get('currency') or 'usd').upper()
    conn = db.get_db()
    conn.execute('''
        INSERT INTO payments (user_id, amount, currency, plan, payment_id, status)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(payment_id) DO UPDATE SET
            user_id = excluded.user_id,
            amount = excluded.amount,
            currency = excluded.currency,
            plan = excluded.plan,
            status = excluded.status
    ''', (user_id, amount, currency, plan, invoice_id, status))
    conn.commit()
    conn.close()


def stripe_event_was_processed(event_id):
    conn = db.get_db()
    row = conn.execute('SELECT 1 FROM stripe_events WHERE event_id = ?', (event_id,)).fetchone()
    conn.close()
    return bool(row)


def mark_stripe_event_processed(event_id, event_type):
    conn = db.get_db()
    conn.execute(
        'INSERT OR IGNORE INTO stripe_events (event_id, event_type) VALUES (?, ?)',
        (event_id, event_type)
    )
    conn.commit()
    conn.close()

# --- IP SECURITY & RATE LIMITING PRE-HOOK ---
@app.before_request
def check_security():
    ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    if ip and ',' in ip:
        ip = ip.split(',')[0].strip()

    # 1. Check IP Ban
    banned = db.is_ip_banned(ip)
    if banned and not request.path.startswith('/static/'):
        return render_template('base.html', banned_ip=True, ban_reason=banned['reason']), 403

    # 2. Rate Limiting (Skip static assets)
    if not request.path.startswith('/static/'):
        if not sec.check_rate_limit(ip, max_requests=180, window_seconds=60):
            return jsonify({'error': 'Too many requests. Please slow down.'}), 429

# --- CONTEXT PROCESSOR ---
@app.context_processor
def inject_globals():
    user = None
    sub = None
    if 'user_id' in session:
        user = db.get_user_by_id(session['user_id'])
        if user:
            sub = db.get_active_subscription(user['id'])
    return {
        'current_user': user,
        'active_sub': sub,
        'is_admin': bool(user and user['is_admin']),
        'now_year': datetime.utcnow().year,
        'csrf_token': get_csrf_token(),
    }

def login_required(f):
    from functools import wraps
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            flash('Please log in to access this page.', 'info')
            return redirect(url_for('login_page', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    from functools import wraps
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('admin_login_page'))
        user = db.get_user_by_id(session['user_id'])
        if not user or not user['is_admin']:
            flash('Administrator privileges required.', 'error')
            return redirect(url_for('index_page'))
        return f(*args, **kwargs)
    return decorated_function

# =========================================================================
# 1. PUBLIC WEBSITE ROUTES
# =========================================================================

@app.route('/')
def index_page():
    return render_template('index.html')

@app.route('/pricing')
def pricing_page():
    return render_template('pricing.html')

@app.route('/download')
def download_page():
    return render_template('download.html')

@app.route('/download/<path:filename>')
def download_installer_file(filename):
    # 1. Check in static/downloads/
    downloads_dir = os.path.join(app.root_path, 'static', 'downloads')
    if os.path.isfile(os.path.join(downloads_dir, filename)):
        return send_from_directory(downloads_dir, filename, as_attachment=True)
    
    # 2. Check in static/
    static_dir = os.path.join(app.root_path, 'static')
    if os.path.isfile(os.path.join(static_dir, filename)):
        return send_from_directory(static_dir, filename, as_attachment=True)
    
    # 3. Graceful alert if file is not yet uploaded to server disk
    flash(f"Download package '{filename}' is currently synchronizing on the server. Please check back shortly.", 'warning')
    return redirect(url_for('download_page'))

# =========================================================================
# 2. AUTHENTICATION & CAPTCHA ROUTES
# =========================================================================

@app.route('/api/captcha', methods=['GET'])
def get_captcha():
    c_data = cap.generate_captcha()
    return jsonify(c_data)

@app.route('/login', methods=['GET', 'POST'])
def login_page():
    if 'user_id' in session:
        return redirect(url_for('dashboard_page'))

    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        captcha_token = request.form.get('captcha_token', '')
        captcha_answer = request.form.get('captcha_answer', '')

        # 1. Verify Anti-Bot Captcha
        if not cap.verify_captcha(captcha_token, captcha_answer):
            flash('Incorrect or expired Anti-Bot Captcha answer. Please try again.', 'error')
            return render_template('login.html', username=username)

        # 2. Verify User
        user = db.get_user_by_username(username)
        ip = request.headers.get('X-Forwarded-For', request.remote_addr)
        ua = request.headers.get('User-Agent', '')

        if not user or not check_password_hash(user['password_hash'], password):
            conn = db.get_db()
            conn.execute("INSERT INTO login_logs (user_id, ip_address, user_agent, status) VALUES (?, ?, ?, 'failed')", (user['id'] if user else None, ip, ua))
            conn.commit()
            conn.close()
            flash('Invalid username or password.', 'error')
            return render_template('login.html', username=username)

        if user['is_banned']:
            flash(f"Account suspended: {user['ban_reason'] or 'Contact support.'}", 'error')
            return render_template('login.html')

        # Log Successful Login
        conn = db.get_db()
        conn.execute("INSERT INTO login_logs (user_id, ip_address, user_agent, status) VALUES (?, ?, ?, 'success')", (user['id'], ip, ua))
        conn.commit()
        conn.close()

        session.permanent = True
        session['user_id'] = user['id']
        session['username'] = user['username']
        session['is_admin'] = bool(user['is_admin'])

        flash(f"Welcome back, {user['username']}!", 'success')
        next_url = request.args.get('next')
        if next_url and next_url.startswith('/'):
            return redirect(next_url)
        return redirect(url_for('dashboard_page'))

    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register_page():
    if 'user_id' in session:
        return redirect(url_for('dashboard_page'))

    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        email = request.form.get('email', '').strip()
        password = request.form.get('password', '')
        confirm_password = request.form.get('confirm_password', '')
        captcha_token = request.form.get('captcha_token', '')
        captcha_answer = request.form.get('captcha_answer', '')

        if not cap.verify_captcha(captcha_token, captcha_answer):
            flash('Incorrect Anti-Bot Captcha answer. Please try again.', 'error')
            return render_template('register.html', username=username, email=email)

        if len(username) < 3:
            flash('Username must be at least 3 characters long.', 'error')
            return render_template('register.html', username=username, email=email)

        if len(password) < 6:
            flash('Password must be at least 6 characters long.', 'error')
            return render_template('register.html', username=username, email=email)

        if password != confirm_password:
            flash('Passwords do not match.', 'error')
            return render_template('register.html', username=username, email=email)

        if db.get_user_by_username(username):
            flash('That username is already taken. Please choose another.', 'error')
            return render_template('register.html', username=username, email=email)

        if db.get_user_by_email(email):
            flash('An account with that email already exists.', 'error')
            return render_template('register.html', username=username, email=email)

        pass_hash = generate_password_hash(password)
        conn = db.get_db()
        cursor = conn.cursor()
        cursor.execute("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)", (username, email, pass_hash))
        user_id = cursor.lastrowid
        conn.commit()
        conn.close()

        session.permanent = True
        session['user_id'] = user_id
        session['username'] = username
        session['is_admin'] = False

        flash('Your Wavely account has been successfully created!', 'success')
        return redirect(url_for('pricing_page'))

    return render_template('register.html')

@app.route('/logout')
def logout():
    session.clear()
    flash('You have been logged out.', 'info')
    return redirect(url_for('index_page'))

# =========================================================================
# 3. USER DASHBOARD & SUBSCRIPTION MANAGEMENT
# =========================================================================

@app.route('/dashboard')
@login_required
def dashboard_page():
    user = db.get_user_by_id(session['user_id'])
    sub = db.get_active_subscription(user['id'])

    conn = db.get_db()
    devices = conn.execute("SELECT * FROM devices WHERE user_id = ? ORDER BY id DESC", (user['id'],)).fetchall()
    logins = conn.execute("SELECT * FROM login_logs WHERE user_id = ? ORDER BY id DESC LIMIT 10", (user['id'],)).fetchall()
    payments = conn.execute("SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 5", (user['id'],)).fetchall()
    my_issues = conn.execute("SELECT * FROM issues WHERE user_id = ? ORDER BY id DESC LIMIT 5", (user['id'],)).fetchall()
    conn.close()

    return render_template(
        'dashboard.html',
        user=user,
        sub=sub,
        devices=devices,
        logins=logins,
        payments=payments,
        my_issues=my_issues
    )

@app.route('/dashboard/devices')
@login_required
def dashboard_devices_page():
    conn = db.get_db()
    devices = conn.execute("SELECT * FROM devices WHERE user_id = ? ORDER BY id DESC", (session['user_id'],)).fetchall()
    conn.close()
    return render_template('dashboard_devices.html', devices=devices)

@app.route('/dashboard/devices/revoke/<int:device_id>', methods=['POST'])
@login_required
def revoke_device(device_id):
    conn = db.get_db()
    conn.execute("DELETE FROM devices WHERE id = ? AND user_id = ?", (device_id, session['user_id']))
    conn.commit()
    conn.close()
    flash('Device access revoked successfully.', 'success')
    return redirect(url_for('dashboard_page'))

@app.route('/dashboard/subscription/cancel', methods=['POST'])
@login_required
def cancel_subscription():
    if not valid_csrf_token(request.form.get('csrf_token')):
        abort(400, description='Invalid security token.')

    conn = db.get_db()
    sub = conn.execute('''
        SELECT * FROM subscriptions
        WHERE user_id = ? AND status = 'active'
        ORDER BY id DESC LIMIT 1
    ''', (session['user_id'],)).fetchone()
    conn.close()

    if not sub:
        flash('No active subscription was found.', 'warning')
        return redirect(url_for('dashboard_page'))

    stripe_subscription_id = sub['stripe_subscription_id']
    if stripe_subscription_id:
        try:
            stripe_client = get_stripe_client()
            stripe_client.v1.subscriptions.update(
                stripe_subscription_id,
                {'cancel_at_period_end': True}
            )
        except (StripeError, RuntimeError):
            app.logger.exception('Stripe subscription cancellation failed')
            flash('We could not update your renewal right now. Please try again or contact support.', 'error')
            return redirect(url_for('dashboard_page'))

    conn = db.get_db()
    conn.execute(
        "UPDATE subscriptions SET auto_renew = 0 WHERE id = ?",
        (sub['id'],)
    )
    conn.commit()
    conn.close()
    flash('Auto-renew disabled. Your subscription will remain active until the end of your billing period.', 'info')
    return redirect(url_for('dashboard_page'))

# =========================================================================
# 4. STRIPE CHECKOUT & SUBSCRIPTION WEBHOOKS
# =========================================================================

@app.route('/api/checkout/session', methods=['POST'])
@login_required
def create_checkout_session():
    if not valid_csrf_token(request.headers.get('X-CSRF-Token')):
        return jsonify({'error': 'Your session has expired. Refresh the page and try again.'}), 400

    data = request.get_json() or {}
    plan = data.get('plan')
    if plan not in STRIPE_PLANS:
        return jsonify({'error': 'Invalid subscription plan.'}), 400

    user_id = session['user_id']
    user = db.get_user_by_id(user_id)
    if not user:
        return jsonify({'error': 'Account not found.'}), 404

    conn = db.get_db()
    active_sub = conn.execute('''
        SELECT * FROM subscriptions
        WHERE user_id = ? AND status = 'active' AND expires_at > ?
        ORDER BY id DESC LIMIT 1
    ''', (user_id, datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'))).fetchone()
    customer_row = conn.execute('''
        SELECT stripe_customer_id FROM subscriptions
        WHERE user_id = ? AND stripe_customer_id IS NOT NULL
        ORDER BY id DESC LIMIT 1
    ''', (user_id,)).fetchone()
    conn.close()
    if active_sub and active_sub['stripe_subscription_id']:
        return jsonify({'error': 'You already have an active Stripe subscription.'}), 409

    config = STRIPE_PLANS[plan]
    price_id = os.environ.get(config['price_env'], '').strip()
    if not price_id.startswith('price_'):
        app.logger.error('%s is missing or invalid', config['price_env'])
        return jsonify({'error': 'Checkout is not configured yet. Please contact support.'}), 503

    try:
        stripe_client = get_stripe_client()
        base_url = get_checkout_base_url()
        checkout_params = {
            'mode': 'subscription',
            'line_items': [{'price': price_id, 'quantity': 1}],
            'success_url': f'{base_url}/checkout/success?session_id={{CHECKOUT_SESSION_ID}}',
            'cancel_url': f'{base_url}/pricing?checkout=cancelled',
            'client_reference_id': str(user_id),
            'allow_promotion_codes': True,
            'billing_address_collection': 'auto',
            'metadata': {
                'wavely_user_id': str(user_id),
                'wavely_plan': plan,
            },
            'subscription_data': {
                'metadata': {
                    'wavely_user_id': str(user_id),
                    'wavely_plan': plan,
                }
            },
        }
        if customer_row and customer_row['stripe_customer_id']:
            checkout_params['customer'] = customer_row['stripe_customer_id']
        else:
            checkout_params['customer_email'] = user['email']

        checkout_session = stripe_client.v1.checkout.sessions.create(checkout_params)
        return jsonify({'success': True, 'checkout_url': checkout_session.url})
    except (StripeError, RuntimeError):
        app.logger.exception('Unable to create Stripe Checkout Session')
        return jsonify({'error': 'Checkout is temporarily unavailable. Please try again.'}), 502


@app.route('/checkout/success')
@login_required
def checkout_success():
    checkout_session_id = request.args.get('session_id', '').strip()
    if not checkout_session_id.startswith('cs_'):
        abort(400, description='Invalid Checkout Session.')

    try:
        stripe_session = get_stripe_client().v1.checkout.sessions.retrieve(checkout_session_id)
    except (StripeError, RuntimeError):
        app.logger.exception('Unable to retrieve Stripe Checkout Session')
        flash('We could not verify that Checkout Session. Please contact support if you were charged.', 'error')
        return redirect(url_for('pricing_page'))

    if str(stripe_session.get('client_reference_id')) != str(session['user_id']):
        abort(403)

    payment_complete = (
        stripe_session.get('status') == 'complete'
        and stripe_session.get('payment_status') in ('paid', 'no_payment_required')
    )
    return render_template(
        'checkout_success.html',
        payment_complete=payment_complete,
        checkout_session_id=checkout_session_id,
    )


@app.route('/api/stripe/webhook', methods=['POST'])
def stripe_webhook():
    webhook_secret = os.environ.get('STRIPE_WEBHOOK_SECRET', '').strip()
    if not webhook_secret:
        app.logger.error('STRIPE_WEBHOOK_SECRET is not configured')
        return jsonify({'error': 'Webhook is not configured.'}), 503

    payload = request.get_data(cache=False)
    signature = request.headers.get('Stripe-Signature', '')
    try:
        event = Webhook.construct_event(payload, signature, webhook_secret)
    except (ValueError, SignatureVerificationError):
        return jsonify({'error': 'Invalid webhook signature.'}), 400

    event_id = event.get('id')
    event_type = event.get('type')
    if not event_id or stripe_event_was_processed(event_id):
        return jsonify({'received': True})

    stripe_client = None
    try:
        obj = event['data']['object']

        if event_type == 'checkout.session.completed':
            subscription_id = stripe_object_id(obj.get('subscription'))
            metadata = obj.get('metadata') or {}
            plan = metadata.get('wavely_plan')
            user_reference = metadata.get('wavely_user_id') or obj.get('client_reference_id')
            if (
                subscription_id
                and str(user_reference).isdigit()
                and plan in STRIPE_PLANS
                and obj.get('payment_status') in ('paid', 'no_payment_required')
            ):
                stripe_client = get_stripe_client()
                stripe_subscription = stripe_client.v1.subscriptions.retrieve(subscription_id)
                sync_stripe_subscription(
                    stripe_subscription,
                    user_id=int(user_reference),
                    plan=plan,
                )

        elif event_type in ('invoice.paid', 'invoice.payment_failed'):
            subscription_id = invoice_subscription_id(obj)
            if subscription_id:
                stripe_client = get_stripe_client()
                stripe_subscription = stripe_client.v1.subscriptions.retrieve(subscription_id)
                user_id = stripe_user_id(stripe_subscription)
                plan = stripe_plan_from_subscription(stripe_subscription)
                if user_id and plan in STRIPE_PLANS:
                    user_id, plan = sync_stripe_subscription(stripe_subscription, user_id, plan)
                    payment_status = 'completed' if event_type == 'invoice.paid' else 'failed'
                    record_stripe_invoice(obj, user_id, plan, payment_status)

        elif event_type in (
            'customer.subscription.created',
            'customer.subscription.updated',
            'customer.subscription.deleted',
            'customer.subscription.paused',
            'customer.subscription.resumed',
        ):
            user_id = stripe_user_id(obj)
            plan = stripe_plan_from_subscription(obj)
            if user_id and plan in STRIPE_PLANS:
                sync_stripe_subscription(obj, user_id, plan)

        mark_stripe_event_processed(event_id, event_type)
    except (StripeError, RuntimeError, ValueError, TypeError, KeyError):
        app.logger.exception('Stripe webhook processing failed for %s', event_id)
        return jsonify({'error': 'Webhook processing failed.'}), 500

    return jsonify({'received': True})

# =========================================================================
# 5. COMMUNITY ISSUES & HELPDESK TICKETS
# =========================================================================

@app.route('/issues')
def issues_page():
    category = request.args.get('category', 'all')
    status_filter = request.args.get('status', 'all')

    conn = db.get_db()
    query = "SELECT * FROM issues WHERE 1=1"
    params = []

    if category != 'all':
        query += " AND category = ?"
        params.append(category)

    if status_filter != 'all':
        query += " AND status = ?"
        params.append(status_filter)
    else:
        # By default hide resolved issues from public general list
        query += " AND status != 'resolved'"

    query += " ORDER BY id DESC"
    issues = conn.execute(query, params).fetchall()
    conn.close()

    return render_template('issues.html', issues=issues, current_cat=category, current_status=status_filter)

@app.route('/issues/new', methods=['GET', 'POST'])
@login_required
def new_issue():
    if request.method == 'POST':
        category = request.form.get('category', 'Bug Report')
        title = request.form.get('title', '').strip()
        description = request.form.get('description', '').strip()
        priority = request.form.get('priority', 'normal')

        if not title or not description:
            flash('Please provide both a title and description for your report.', 'error')
            return render_template('new_issue.html')

        user = db.get_user_by_id(session['user_id'])
        conn = db.get_db()
        cursor = conn.cursor()
        cursor.execute('''
        INSERT INTO issues (user_id, username, category, title, description, priority, status)
        VALUES (?, ?, ?, ?, ?, ?, 'open')
        ''', (user['id'], user['username'], category, title, description, priority))
        issue_id = cursor.lastrowid
        conn.commit()
        conn.close()

        flash('Your issue has been reported. Our team will review and respond shortly.', 'success')
        return redirect(url_for('issue_detail_page', issue_id=issue_id))

    return render_template('new_issue.html')

@app.route('/issues/<int:issue_id>')
def issue_detail_page(issue_id):
    conn = db.get_db()
    issue = conn.execute("SELECT * FROM issues WHERE id = ?", (issue_id,)).fetchone()
    if not issue:
        conn.close()
        abort(404)

    messages = conn.execute("SELECT * FROM issue_messages WHERE issue_id = ? ORDER BY id ASC", (issue_id,)).fetchall()
    conn.close()

    return render_template('issue_detail.html', issue=issue, messages=messages)

@app.route('/issues/<int:issue_id>/reply', methods=['POST'])
@login_required
def reply_issue(issue_id):
    conn = db.get_db()
    issue = conn.execute("SELECT * FROM issues WHERE id = ?", (issue_id,)).fetchone()
    if not issue:
        conn.close()
        abort(404)

    if issue['is_locked'] or issue['status'] == 'resolved':
        conn.close()
        flash('This issue is resolved and locked. No further messages can be sent.', 'error')
        return redirect(url_for('issue_detail_page', issue_id=issue_id))

    message_text = request.form.get('message', '').strip()
    if not message_text:
        conn.close()
        flash('Message cannot be empty.', 'error')
        return redirect(url_for('issue_detail_page', issue_id=issue_id))

    user = db.get_user_by_id(session['user_id'])
    is_admin = bool(user and user['is_admin'])

    conn.execute('''
    INSERT INTO issue_messages (issue_id, sender_id, sender_name, is_admin, message)
    VALUES (?, ?, ?, ?, ?)
    ''', (issue_id, user['id'], user['username'], is_admin, message_text))

    # If admin replied, mark ticket in_progress
    if is_admin and issue['status'] == 'open':
        conn.execute("UPDATE issues SET status = 'in_progress' WHERE id = ?", (issue_id,))

    conn.commit()
    conn.close()

    flash('Reply posted successfully.', 'success')
    return redirect(url_for('issue_detail_page', issue_id=issue_id))

# =========================================================================
# 6. MASTER ADMIN DASHBOARD & SECURITY PANEL
# =========================================================================

@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login_page():
    if 'user_id' in session:
        user = db.get_user_by_id(session['user_id'])
        if user and user['is_admin']:
            return redirect(url_for('admin_dashboard_page'))

    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')

        user = db.get_user_by_username(username)
        if user and user['is_admin'] and check_password_hash(user['password_hash'], password):
            session.permanent = True
            session['user_id'] = user['id']
            session['username'] = user['username']
            session['is_admin'] = True
            flash('Logged into Master Admin Dashboard.', 'success')
            return redirect(url_for('admin_dashboard_page'))
        else:
            flash('Invalid Admin Credentials.', 'error')

    return render_template('admin_login.html')

@app.route('/admin')
@admin_required
def admin_dashboard_page():
    analytics = db.get_financial_analytics()
    conn = db.get_db()

    users = conn.execute("SELECT u.*, s.plan, s.status as sub_status, s.expires_at FROM users u LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active' ORDER BY u.id DESC").fetchall()
    devices = conn.execute("SELECT d.*, u.username FROM devices d JOIN users u ON d.user_id = u.id ORDER BY d.id DESC").fetchall()
    banned_ips = conn.execute("SELECT * FROM banned_ips ORDER BY id DESC").fetchall()
    issues = conn.execute("SELECT * FROM issues ORDER BY CASE WHEN status = 'open' THEN 1 WHEN status = 'in_progress' THEN 2 ELSE 3 END, id DESC").fetchall()
    conn.close()

    return render_template(
        'admin_dashboard.html',
        analytics=analytics,
        users=users,
        devices=devices,
        banned_ips=banned_ips,
        issues=issues
    )

@app.route('/admin/users/<int:user_id>/grant_membership', methods=['POST'])
@admin_required
def admin_grant_membership(user_id):
    plan = request.form.get('plan', 'monthly_499') # monthly_499, annual_45, lifetime_vip
    days = 30
    if plan == 'annual_45': days = 365
    elif plan == 'lifetime_vip': days = 3650

    expires_at = (datetime.utcnow() + timedelta(days=days)).strftime('%Y-%m-%d %H:%M:%S')

    conn = db.get_db()
    conn.execute("UPDATE subscriptions SET status = 'replaced' WHERE user_id = ? AND status = 'active'", (user_id,))
    conn.execute('''
    INSERT INTO subscriptions (user_id, plan, status, amount, expires_at, auto_renew)
    VALUES (?, ?, 'active', 0.0, ?, 1)
    ''', (user_id, plan, expires_at))
    conn.commit()
    conn.close()

    flash(f"Granted {plan} membership to user #{user_id}.", 'success')
    return redirect(url_for('admin_dashboard_page'))

@app.route('/admin/users/<int:user_id>/revoke_membership', methods=['POST'])
@admin_required
def admin_revoke_membership(user_id):
    conn = db.get_db()
    conn.execute("UPDATE subscriptions SET status = 'canceled', expires_at = CURRENT_TIMESTAMP WHERE user_id = ? AND status = 'active'", (user_id,))
    conn.commit()
    conn.close()
    flash(f"Canceled active membership for user #{user_id}.", 'info')
    return redirect(url_for('admin_dashboard_page'))

@app.route('/admin/users/<int:user_id>/toggle_ban', methods=['POST'])
@admin_required
def admin_toggle_user_ban(user_id):
    reason = request.form.get('reason', 'Violation of terms')
    conn = db.get_db()
    user = conn.execute("SELECT is_banned FROM users WHERE id = ?", (user_id,)).fetchone()
    if user:
        new_ban = 0 if user['is_banned'] else 1
        conn.execute("UPDATE users SET is_banned = ?, ban_reason = ? WHERE id = ?", (new_ban, reason if new_ban else '', user_id))
        conn.commit()
        flash(f"User #{user_id} {'banned' if new_ban else 'unbanned'} successfully.", 'success')
    conn.close()
    return redirect(url_for('admin_dashboard_page'))

@app.route('/admin/devices/<int:device_id>/toggle_ban', methods=['POST'])
@admin_required
def admin_toggle_device_ban(device_id):
    reason = request.form.get('reason', 'Security Policy Violation')
    conn = db.get_db()
    dev = conn.execute("SELECT is_banned FROM devices WHERE id = ?", (device_id,)).fetchone()
    if dev:
        new_ban = 0 if dev['is_banned'] else 1
        conn.execute("UPDATE devices SET is_banned = ?, ban_reason = ? WHERE id = ?", (new_ban, reason if new_ban else '', device_id))
        conn.commit()
        flash(f"HWID Device #{device_id} {'banned' if new_ban else 'unbanned'}.", 'success')
    conn.close()
    return redirect(url_for('admin_dashboard_page'))

@app.route('/admin/ips/ban', methods=['POST'])
@admin_required
def admin_ban_ip():
    ip_addr = request.form.get('ip_address', '').strip()
    reason = request.form.get('reason', 'Blocked by administrator')
    if ip_addr:
        conn = db.get_db()
        conn.execute("INSERT OR REPLACE INTO banned_ips (ip_address, reason, banned_by) VALUES (?, ?, 'Admin')", (ip_addr, reason))
        conn.commit()
        conn.close()
        flash(f"IP {ip_addr} banned.", 'success')
    return redirect(url_for('admin_dashboard_page'))

@app.route('/admin/ips/unban/<int:ip_id>', methods=['POST'])
@admin_required
def admin_unban_ip(ip_id):
    conn = db.get_db()
    conn.execute("DELETE FROM banned_ips WHERE id = ?", (ip_id,))
    conn.commit()
    conn.close()
    flash('IP unbanned.', 'success')
    return redirect(url_for('admin_dashboard_page'))

@app.route('/admin/issues/<int:issue_id>/resolve', methods=['POST'])
@admin_required
def admin_resolve_issue(issue_id):
    now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    conn = db.get_db()
    conn.execute("UPDATE issues SET status = 'resolved', is_locked = 1, resolved_at = ? WHERE id = ?", (now_str, issue_id))
    conn.commit()
    conn.close()
    flash(f"Issue #{issue_id} marked as Resolved and Locked.", 'success')
    return redirect(url_for('admin_dashboard_page'))

# =========================================================================
# 7. DESKTOP APP LICENSING & AUTHENTICATION API
# =========================================================================

@app.route('/api/auth/login', methods=['POST'])
def api_auth_login():
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')

    user = db.get_user_by_username(username)
    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'success': False, 'error': 'Invalid credentials'}), 401

    if user['is_banned']:
        return jsonify({'success': False, 'error': f"Account suspended: {user['ban_reason']}"}), 403

    sub = db.get_active_subscription(user['id'])
    token = sec.create_jwt_token(user['id'], user['username'], is_admin=bool(user['is_admin']))

    return jsonify({
        'success': True,
        'token': token,
        'user': {
            'id': user['id'],
            'username': user['username'],
            'email': user['email'],
            'is_admin': bool(user['is_admin'])
        },
        'subscription': {
            'isSubscribed': bool(sub),
            'plan': sub['plan'] if sub else 'none',
            'expiresAt': sub['expires_at'] if sub else None
        }
    })

@app.route('/api/auth/register', methods=['POST'])
def api_auth_register():
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '')
    captcha_token = data.get('captcha_token', '')
    captcha_answer = data.get('captcha_answer', '')

    if not cap.verify_captcha(captcha_token, captcha_answer):
        return jsonify({'success': False, 'error': 'Invalid Anti-Bot Captcha answer'}), 400

    if len(username) < 3 or len(password) < 6:
        return jsonify({'success': False, 'error': 'Invalid username or password length'}), 400

    if db.get_user_by_username(username) or db.get_user_by_email(email):
        return jsonify({'success': False, 'error': 'Username or email already in use'}), 400

    pass_hash = generate_password_hash(password)
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)", (username, email, pass_hash))
    user_id = cursor.lastrowid
    conn.commit()
    conn.close()

    token = sec.create_jwt_token(user_id, username)
    return jsonify({
        'success': True,
        'token': token,
        'user': { 'id': user_id, 'username': username, 'email': email },
        'subscription': { 'isSubscribed': False, 'plan': 'none' }
    })

@app.route('/api/license/verify', methods=['POST'])
def api_license_verify():
    data = request.get_json() or {}
    token_str = data.get('token') or request.headers.get('Authorization', '')
    payload = sec.decode_jwt_token(token_str)

    if not payload:
        return jsonify({'success': False, 'error': 'Unauthorized: Valid login required', 'isSubscribed': False}), 401

    user_id = payload['user_id']
    user = db.get_user_by_id(user_id)
    if not user or user['is_banned']:
        return jsonify({'success': False, 'banned': True, 'banReason': user['ban_reason'] if user else 'Banned', 'isSubscribed': False}), 403

    hwid = data.get('hwid')
    device_ban_reason = db.is_device_banned(hwid)
    if device_ban_reason:
        return jsonify({'success': False, 'banned': True, 'banReason': device_ban_reason, 'isSubscribed': False}), 403

    # Register / Update Device
    db.register_or_heartbeat_device(user_id, data)

    # Check Subscription
    sub = db.get_active_subscription(user_id)
    return jsonify({
        'success': True,
        'allowed': True,
        'isSubscribed': bool(sub),
        'plan': sub['plan'] if sub else 'none',
        'expiresAt': sub['expires_at'] if sub else None,
        'user': {
            'username': user['username'],
            'email': user['email']
        }
    })

@app.route('/api/license/heartbeat', methods=['POST'])
def api_license_heartbeat():
    data = request.get_json() or {}
    token_str = data.get('token') or request.headers.get('Authorization', '')
    payload = sec.decode_jwt_token(token_str)

    if not payload:
        return jsonify({'status': 'unauthorized', 'isSubscribed': False}), 401

    user_id = payload['user_id']
    user = db.get_user_by_id(user_id)
    if not user or user['is_banned']:
        return jsonify({'status': 'banned', 'banReason': user['ban_reason'] if user else 'Banned'}), 403

    hwid = data.get('hwid')
    dev_status = db.register_or_heartbeat_device(user_id, data)
    if dev_status and dev_status.get('is_banned'):
        return jsonify({'status': 'banned', 'banReason': dev_status.get('ban_reason')}), 403

    sub = db.get_active_subscription(user_id)
    return jsonify({
        'status': 'active',
        'isSubscribed': bool(sub),
        'plan': sub['plan'] if sub else 'none'
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 6767))
    print(f"[WAVELY V2] Server launching on http://0.0.0.0:{port}")
    app.run(host='0.0.0.0', port=port, debug=True)
