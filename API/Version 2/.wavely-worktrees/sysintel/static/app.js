// --- STATE MANAGEMENT ---
let currentUser = null;
let currentTab = 'home';
let trafficChartInstance = null;
let allLogs = [];

// Determine current tab from pathname
const pathname = window.location.pathname;
if (pathname === '/' || !pathname) {
    currentTab = 'home';
} else {
    currentTab = pathname.substring(1).split('/')[0].split('?')[0].split('#')[0];
}

// --- HAMBURGER MENU ---
function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    const btn = document.getElementById('hamburger-btn');
    menu.classList.toggle('open');
    btn.classList.toggle('open');
}
function closeMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    const btn = document.getElementById('hamburger-btn');
    if (menu) menu.classList.remove('open');
    if (btn) btn.classList.remove('open');
}

// --- PAGE INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is already logged in (by requesting dashboard analytics)
    checkAuthSession();
    
    // Trigger initialization based on path
    if (currentTab === 'browser') {
        initSampleBrowser();
    } else if (currentTab === 'dashboard') {
        loadDashboard();
    } else if (currentTab === 'community') {
        initCommunityPage();
    } else if (currentTab === 'admin') {
        loadAdmin();
    }
});

function checkAuthSession() {
    fetch('/api/dashboard/analytics')
        .then(res => {
            // Only a genuine 401 means "not logged in". For any other non-OK
            // status (500, 302, etc.) we must NOT redirect to /login: the server
            // sends /login -> /dashboard when a session exists, so bouncing here
            // creates an infinite reload loop. Treat those as transient instead.
            if (res.status === 401) {
                currentUser = null;
                updateAuthHeader(false);
                loadFavorites();
                if (currentTab === 'dashboard' || currentTab === 'admin' || currentTab === 'community' || currentTab === 'browser') {
                    switchTab('login');
                }
                return null;
            }
            if (!res.ok) {
                throw new Error('Auth check failed (status ' + res.status + ')');
            }
            return res.json();
        })
        .then(data => {
            if (!data) return; // handled 401 above
            // User session is active
            currentUser = true; 
            updateAuthHeader(true, data.isAdmin, data.username);
            loadFavorites();
            
            // If currently on login/signup page, redirect to dashboard
            if (currentTab === 'login' || currentTab === 'signup') {
                switchTab('dashboard');
            } else {
                // If on dashboard, render data
                if (currentTab === 'dashboard') {
                    renderDashboardData(data);
                } else if (currentTab === 'admin') {
                    loadAdmin();
                }
            }
        })
        .catch((err) => {
            // Network/parse/5xx error: auth state is unknown, not "logged out".
            // Keep the user where they are (no redirect -> no reload ping-pong)
            // and don't flip the header to signed-out, since the session may
            // still be valid. We'll re-check on the next navigation.
            console.error('Auth session check error (non-fatal):', err);
            loadFavorites();
        });
}

function updateAuthHeader(isLoggedIn, isAdmin = false, username = '') {
    const authSection = document.getElementById('header-auth-section');
    const mobileAuthSection = document.getElementById('mobile-auth-section');
    const adminNavBtn = document.getElementById('nav-admin-btn');
    const mobileAdminBtn = document.getElementById('mobile-nav-admin-btn');
    if (isLoggedIn) {
        authSection.innerHTML = `
            <span style="font-size:12px;color:rgba(255,255,255,0.6);display:inline-flex;align-items:center;gap:5px;">
                <i class="fa-regular fa-user" style="color:var(--primary);"></i> <strong style="color:#fff;">${escapeHtml(username)}</strong>
            </span>
            <button class="btn btn-ghost btn-sm" onclick="handleLogout()"><i class="fa-solid fa-right-from-bracket"></i> Sign Out</button>
        `;
        if (mobileAuthSection) {
            mobileAuthSection.innerHTML = `
                <div style="font-size:13px;color:var(--text-muted);text-align:center;padding:6px;">Signed in as <strong style="color:#fff;">${escapeHtml(username)}</strong></div>
                <button class="btn btn-ghost btn-block" onclick="handleLogout();closeMobileMenu()"><i class="fa-solid fa-right-from-bracket"></i> Sign Out</button>
            `;
        }
        if (adminNavBtn) adminNavBtn.style.display = isAdmin ? 'inline-block' : 'none';
        if (mobileAdminBtn) mobileAdminBtn.style.display = isAdmin ? 'flex' : 'none';
    } else {
        authSection.innerHTML = `
            <button class="btn btn-ghost btn-sm" onclick="switchTab('login')">Sign In</button>
            <button class="btn btn-primary btn-sm" onclick="switchTab('signup')">Register</button>
        `;
        if (mobileAuthSection) {
            mobileAuthSection.innerHTML = `
                <button class="btn btn-ghost btn-block" onclick="switchTab('login');closeMobileMenu()">Sign In</button>
                <button class="btn btn-primary btn-block" onclick="switchTab('signup');closeMobileMenu()">Register</button>
            `;
        }
        if (adminNavBtn) adminNavBtn.style.display = 'none';
        if (mobileAdminBtn) mobileAdminBtn.style.display = 'none';
    }
}

// --- TAB ROUTING SYSTEM (multi-page navigation) ---
function switchTab(tabId) {
    if (tabId === 'home') {
        window.location.href = '/';
    } else {
        window.location.href = '/' + tabId;
    }
}

// --- CODE PLAYGROUND MULTI-LANGUAGE CONTROLLER ---
function switchCodeTab(btn, lang) {
    const parent = btn.closest('.code-tab-container');
    
    // Update active class on tab buttons
    parent.querySelectorAll('.code-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Update active code panel
    parent.querySelectorAll('.code-pane').forEach(pane => {
        pane.classList.remove('active');
        if (pane.getAttribute('data-lang') === lang) {
            pane.classList.add('active');
        }
    });
}

function copyCode(btn) {
    const pane = btn.closest('.code-pane');
    const code = pane.querySelector('code').innerText;
    
    navigator.clipboard.writeText(code).then(() => {
        const originalText = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
        setTimeout(() => {
            btn.innerHTML = originalText;
        }, 1800);
    });
}

// --- ACCOUNT HANDLERS ---
function handleSignup(event) {
    event.preventDefault();
    const username = document.getElementById('signup-username').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const errorEl = document.getElementById('signup-error');
    
    errorEl.innerText = "";
    
    fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
    })
    .then(res => res.json().then(data => ({ status: res.status, data })))
    .then(({ status, data }) => {
        if (status === 200) {
            currentUser = true;
            updateAuthHeader(true);
            switchTab('dashboard');
        } else {
            errorEl.innerText = data.error || "Failed to sign up.";
        }
    })
    .catch(() => {
        errorEl.innerText = "Connection error. Please try again.";
    });
}

function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    
    errorEl.innerText = "";
    
    fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(res => res.json().then(data => ({ status: res.status, data })))
    .then(({ status, data }) => {
        if (status === 200) {
            currentUser = true;
            updateAuthHeader(true);
            switchTab('dashboard');
        } else {
            errorEl.innerText = data.error || "Failed to sign in.";
        }
    })
    .catch(() => {
        errorEl.innerText = "Connection error. Please try again.";
    });
}

function handleLogout() {
    fetch('/api/auth/logout', { method: 'POST' })
        .then(() => {
            currentUser = null;
            updateAuthHeader(false);
            switchTab('home');
        });
}

// --- SCROLL REVEAL ANIMATIONS ---
function initScrollReveal() {
    const revealEls = document.querySelectorAll('.feature-card, .card, .doc-block, .interactive-preview, .hero-section');
    revealEls.forEach(el => el.classList.add('reveal'));
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(el => observer.observe(el));
}

// Mouse-tracking glow on cards
function initCardGlow() {
    document.querySelectorAll('.feature-card, .battle-card').forEach(card => {
        card.addEventListener('mousemove', e => {
            const rect = card.getBoundingClientRect();
            card.style.setProperty('--mouse-x', ((e.clientX - rect.left) / rect.width * 100) + '%');
            card.style.setProperty('--mouse-y', ((e.clientY - rect.top) / rect.height * 100) + '%');
        });
    });
}

// Animated counter for dashboard metrics
function animateCounter(el, target) {
    const start = parseInt(el.innerText) || 0;
    const duration = 600;
    const startTime = performance.now();
    function tick(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.innerText = Math.round(start + (target - start) * eased);
        if (progress < 1) requestAnimationFrame(tick);
        else { el.innerText = target; el.classList.add('counting'); setTimeout(() => el.classList.remove('counting'), 300); }
    }
    requestAnimationFrame(tick);
}

// Initialize animations on page load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initScrollReveal, 100);
    setTimeout(initCardGlow, 200);
});

// --- DOCS SCROLL HELPER ---
function scrollToDocSection(event, sectionId) {
    event.preventDefault();
    const el = document.getElementById(sectionId);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Update active sidebar link
        document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
        if (event.target) event.target.classList.add('active');
    }
}

// --- DEVELOPER DASHBOARD ACTIONS ---
function loadDashboard() {
    loadUserProfile();
    startCommunityPolling();
    // Activating the 'api' subtab triggers loadApiDashboardData() (the analytics
    // fetch/render). Do NOT fetch analytics directly here as well, and note that
    // switchDashTab('api') must NOT call back into loadDashboard() or the two
    // would recurse infinitely (which spammed thousands of /poll requests).
    switchDashTab(currentDashTab || 'api');
    
    // Auto-join deep link checks
    const searchParams = new URLSearchParams(window.location.search);
    let joinBattle = searchParams.get('joinbattle');
    let joinServer = searchParams.get('joinserver');
    
    // Backwards compatibility with hash params
    const hashVal = window.location.hash.substring(1);
    if (hashVal.includes('?')) {
        const hashParams = new URLSearchParams(hashVal.split('?')[1] || '');
        if (!joinBattle) joinBattle = hashParams.get('joinbattle');
        if (!joinServer) joinServer = hashParams.get('joinserver');
    }
    
    if (joinBattle) {
        fetch(`/api/battles/join/${joinBattle}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert(`Successfully joined battle: ${data.title}`);
                loadBeatBattles();
            }
        });
    }
    if (joinServer) {
        fetch(`/api/servers/join/${joinServer}`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert(`Successfully joined community server: ${data.name}`);
                loadServers();
            }
        });
    }
}

// Fetches + renders the API analytics dashboard. Kept separate from
// loadDashboard() so the 'api' subtab can refresh data without re-running
// polling setup or recursing.
function loadApiDashboardData() {
    fetch('/api/dashboard/analytics')
        .then(res => {
            if (res.status === 401) {
                currentUser = null;
                updateAuthHeader(false);
                switchTab('login');
                throw new Error("Unauthorized session");
            }
            return res.json();
        })
        .then(data => {
            renderDashboardData(data);
        })
        .catch(err => {
            console.error("Dashboard error:", err);
        });
}

function renderDashboardData(data) {
    // 1. Render Metrics with animated counters
    const totalReqEl = document.getElementById('stat-total-requests');
    const errEl = document.getElementById('stat-errors');
    const totalNum = parseInt(data.stats.totalRequests) || 0;
    const errNum = parseInt(data.stats.errorCount) || 0;
    if (typeof animateCounter === 'function') {
        animateCounter(totalReqEl, totalNum);
        animateCounter(errEl, errNum);
    } else {
        totalReqEl.innerText = data.stats.totalRequests;
        errEl.innerText = data.stats.errorCount;
    }
    document.getElementById('stat-success-rate').innerText = data.stats.successRate;
    document.getElementById('stat-most-used').innerText = data.stats.mostUsed;

    // 2. Render Keys List
    const keysContainer = document.getElementById('keys-list-container');
    keysContainer.innerHTML = "";
    
    document.getElementById('key-count').innerText = `${data.keys.length}/3`;
    
    data.keys.forEach(k => {
        const row = document.createElement('div');
        row.className = 'key-item-row';
        row.innerHTML = `
            <div class="key-header">
                <span class="key-label">${escapeHtml(k.label)}</span>
                <button class="btn-delete" onclick="deleteApiKey('${k.id}')" title="Delete Key"><i class="fa-regular fa-trash-can"></i></button>
            </div>
            <div class="key-val-box" onclick="copyKeyText(this, '${k.key}')" title="Click to copy API key">
                <span class="key-masked">${maskKey(k.key)}</span>
                <span class="copy-hint" style="font-size: 11px; color: var(--primary-hover);"><i class="fa-regular fa-copy"></i> Copy</span>
            </div>
            <div class="key-meta-date">Created on ${new Date(k.created_at).toLocaleDateString()}</div>
        `;
        keysContainer.appendChild(row);
    });

    // Toggle Key Generator Visibility based on limit
    const keyForm = document.querySelector('.generate-key-form');
    if (data.keys.length >= 3) {
        keyForm.style.display = 'none';
    } else {
        keyForm.style.display = 'flex';
    }

    // 3. Render Charts
    renderTrafficChart(data.chart.labels, data.chart.data);
    renderEndpointPieChart(data.endpoints || {});

    // 4. Render Logs Table
    allLogs = data.logs;
    filterLogs();

    // 5. Update API quota bar
    const dailyLimit = 1000;
    const todayCount = data.chart.data[data.chart.data.length - 1] || 0;
    const quotaLabel = document.getElementById('quota-label');
    const quotaBar = document.getElementById('quota-bar');
    if (quotaLabel) quotaLabel.innerText = `${todayCount} / ${dailyLimit}`;
    if (quotaBar) setTimeout(() => { quotaBar.style.width = Math.min((todayCount / dailyLimit) * 100, 100) + '%'; }, 100);
}

function maskKey(key) {
    if (!key || key.length < 8) return "wv_••••••••";
    return `${key.substring(0, 7)}••••••••••••${key.substring(key.length - 4)}`;
}

function copyKeyText(el, rawKey) {
    navigator.clipboard.writeText(rawKey).then(() => {
        const originalHtml = el.innerHTML;
        el.innerHTML = `<span style="color: var(--success); font-family: var(--font-body); font-weight: 600;"><i class="fa-solid fa-check"></i> Copied to Clipboard!</span>`;
        setTimeout(() => {
            el.innerHTML = originalHtml;
        }, 1500);
    });
}

function generateApiKey() {
    const labelInput = document.getElementById('new-key-label');
    const label = labelInput.value.trim();
    
    fetch('/api/keys/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            labelInput.value = "";
            loadApiDashboardData();
        } else {
            alert(data.error || "Failed to generate key");
        }
    });
}

function deleteApiKey(keyId) {
    if (!confirm("Are you sure you want to delete this API key? Any applications currently using it will be blocked immediately.")) return;
    
    fetch(`/api/keys/${keyId}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                loadApiDashboardData();
            } else {
                alert(data.error || "Failed to delete key");
            }
        });
}

// --- CHART RENDERING (ChartJS) ---
function renderTrafficChart(labels, dataset) {
    const ctx = document.getElementById('trafficChart').getContext('2d');
    
    if (trafficChartInstance) {
        trafficChartInstance.destroy();
    }
    
    // Create beautiful neon purple gradient fill under the line
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.4)');
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0.0)');
    
    trafficChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Requests',
                data: dataset,
                borderColor: '#a78bfa',
                borderWidth: 3,
                backgroundColor: gradient,
                fill: true,
                tension: 0.35,
                pointBackgroundColor: '#8b5cf6',
                pointHoverRadius: 7,
                pointHoverBackgroundColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#6b7280', font: { family: 'Plus Jakarta Sans' } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#6b7280', precision: 0, font: { family: 'Plus Jakarta Sans' } },
                    beginAtZero: true
                }
            }
        }
    });
}

// --- ENDPOINT PIE CHART ---
let endpointPieInstance = null;
function renderEndpointPieChart(endpoints) {
    const canvas = document.getElementById('endpointPieChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (endpointPieInstance) endpointPieInstance.destroy();
    const labels = Object.keys(endpoints).slice(0, 8);
    const values = labels.map(l => endpoints[l]);
    const colors = ['#8b5cf6','#d946ef','#10b981','#f59e0b','#3b82f6','#ef4444','#06b6d4','#ec4899'];
    endpointPieInstance = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: values, backgroundColor: colors.slice(0, labels.length), borderWidth: 0, hoverOffset: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', size: 11 }, boxWidth: 10, padding: 8 } } }, cutout: '60%' }
    });
}

// --- CSV EXPORT ---
function exportLogsCSV() {
    if (!allLogs || allLogs.length === 0) { alert('No logs to export.'); return; }
    let csv = 'Timestamp,Type,Endpoint,Details\n';
    allLogs.forEach(log => {
        csv += `"${log.timestamp}","${log.type}","${log.endpoint}","${log.details.replace(/"/g, '""')}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `wavely_logs_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- CHANGE PASSWORD ---
function changePassword() {
    const oldPw = document.getElementById('settings-old-password').value;
    const newPw = document.getElementById('settings-new-password').value;
    const confirmPw = document.getElementById('settings-confirm-password').value;
    const errEl = document.getElementById('settings-error');
    const statusEl = document.getElementById('settings-status');
    errEl.innerText = ''; statusEl.innerText = '';
    if (!oldPw || !newPw || !confirmPw) { errEl.innerText = 'All fields are required.'; return; }
    if (newPw !== confirmPw) { errEl.innerText = 'New passwords do not match.'; return; }
    if (newPw.length < 6) { errEl.innerText = 'Password must be at least 6 characters.'; return; }
    fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPw, new_password: newPw })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            statusEl.style.color = 'var(--success)'; statusEl.innerText = '✓ Password updated!';
            document.getElementById('settings-old-password').value = '';
            document.getElementById('settings-new-password').value = '';
            document.getElementById('settings-confirm-password').value = '';
        } else {
            errEl.innerText = data.error || 'Failed to update password.';
        }
    })
    .catch(() => { errEl.innerText = 'Connection error.'; });
}

// --- LOG FILTERING ---
function filterLogs() {
    const searchVal = document.getElementById('log-search').value.toLowerCase();
    const tbody = document.getElementById('logs-table-body');
    tbody.innerHTML = "";
    
    const filtered = allLogs.filter(log => {
        return log.endpoint.toLowerCase().includes(searchVal) || 
               log.details.toLowerCase().includes(searchVal) ||
               log.type.toLowerCase().includes(searchVal);
    });
    
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-dim);">No requests or error logs found.</td></tr>`;
        return;
    }
    
    filtered.forEach(log => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="log-timestamp">${new Date(log.timestamp).toLocaleString()}</td>
            <td><span class="log-type ${log.type}">${escapeHtml(log.type)}</span></td>
            <td class="log-route">${escapeHtml(log.endpoint)}</td>
            <td class="log-details">${escapeHtml(log.details)}</td>
        `;
        tbody.appendChild(row);
    });
}

// --- STRING ESCAPER UTILITIES ---
function escapeHtml(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// --- ADMIN SYSTEM CONTROLLERS ---
let adminLogs = [];
let adminSubTab = 'users';

function loadAdmin() {
    loadAdminUsers();
    loadAdminIps();
    loadAdminLogs();
}

function switchAdminSubTab(subTabId) {
    adminSubTab = subTabId;
    
    // Update sub-navigation button states
    document.querySelectorAll('.subnav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.querySelector(`.subnav-btn[onclick="switchAdminSubTab('${subTabId}')"]`);
    if (activeBtn) activeBtn.classList.add('active');
    
    // Update content panels
    document.querySelectorAll('.admin-subtab-content').forEach(pane => {
        pane.classList.remove('active');
    });
    const activePane = document.getElementById(`admin-subtab-${subTabId}`);
    if (activePane) activePane.classList.add('active');
}

function loadAdminUsers() {
    fetch('/api/admin/users')
        .then(res => {
            if (!res.ok) throw new Error("Failed to load admin users");
            return res.json();
        })
        .then(data => {
            document.getElementById('admin-users-count').innerText = data.users.length;
            const tbody = document.getElementById('admin-users-table-body');
            tbody.innerHTML = "";
            
            data.users.forEach(user => {
                const tr = document.createElement('tr');
                
                const banBtn = user.banned 
                    ? `<button class="btn-ban-toggle btn-unban" onclick="unbanUser('${escapeHtml(user.username)}')"><i class="fa-solid fa-unlock"></i> Unban</button>`
                    : `<button class="btn-ban-toggle" onclick="banUser('${escapeHtml(user.username)}')"><i class="fa-solid fa-ban"></i> Ban</button>`;
                
                const deleteBtn = user.username === 'admin' 
                    ? '' 
                    : `<button class="btn-delete" onclick="deleteUser('${escapeHtml(user.username)}')"><i class="fa-regular fa-trash-can"></i> Delete</button>`;
                
                const statusBadge = user.banned
                    ? `<span class="badge-status banned">Banned</span>`
                    : `<span class="badge-status active">Active</span>`;
                    
                const roleBadge = user.role === 'admin'
                    ? `<span class="badge-role admin">Admin</span>`
                    : `<span class="badge-role developer">Developer</span>`;
                
                tr.innerHTML = `
                    <td><strong>${escapeHtml(user.username)}</strong></td>
                    <td>${escapeHtml(user.email)}</td>
                    <td>${roleBadge}</td>
                    <td>${user.keys_count} keys</td>
                    <td>${statusBadge}</td>
                    <td>
                        <div class="action-btn-group">
                            ${user.username !== 'admin' ? banBtn : ''}
                            ${deleteBtn}
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        })
        .catch(err => console.error(err));
}

function banUser(username) {
    if (!confirm(`Are you sure you want to ban the developer "${username}"? All active API keys under this account will be suspended immediately.`)) return;
    fetch(`/api/admin/users/${username}/ban`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) loadAdminUsers();
            else alert(data.error || "Failed to ban user");
        });
}

function unbanUser(username) {
    fetch(`/api/admin/users/${username}/unban`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) loadAdminUsers();
            else alert(data.error || "Failed to unban user");
        });
}

function deleteUser(username) {
    if (!confirm(`WARNING: Are you sure you want to permanently delete the account of "${username}"? This will invalidate all generated API keys and delete their settings. This action cannot be undone.`)) return;
    fetch(`/api/admin/users/${username}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
            if (data.success) loadAdminUsers();
            else alert(data.error || "Failed to delete user");
        });
}

function loadAdminIps() {
    fetch('/api/admin/ips')
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('admin-ips-table-body');
            tbody.innerHTML = "";
            
            if (data.banned_ips.length === 0) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-dim);">No IP addresses are currently banned.</td></tr>`;
                return;
            }
            
            data.banned_ips.forEach(ip => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><code>${escapeHtml(ip)}</code></td>
                    <td><span class="badge-status banned">Banned</span></td>
                    <td>
                        <button class="btn-ban-toggle btn-unban" onclick="unbanIp('${escapeHtml(ip)}')"><i class="fa-solid fa-unlock"></i> Unban IP</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        });
}

function handleIpBan(event) {
    event.preventDefault();
    const ipInput = document.getElementById('ban-ip-address');
    const ip = ipInput.value.trim();
    if (!ip) return;
    
    fetch('/api/admin/ips/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            ipInput.value = "";
            loadAdminIps();
        } else {
            alert(data.error || "Failed to ban IP address");
        }
    });
}

function unbanIp(ip) {
    fetch(`/api/admin/ips/${ip}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
            if (data.success) loadAdminIps();
            else alert(data.error || "Failed to unban IP");
        });
}

function loadAdminLogs() {
    fetch('/api/admin/logs')
        .then(res => res.json())
        .then(data => {
            adminLogs = data.logs;
            filterAdminLogs();
        });
}

function filterAdminLogs() {
    const searchVal = document.getElementById('admin-log-search').value.toLowerCase();
    const tbody = document.getElementById('admin-logs-table-body');
    tbody.innerHTML = "";
    
    const filtered = adminLogs.filter(log => {
        return (log.username || '').toLowerCase().includes(searchVal) ||
               (log.ip_address || '').toLowerCase().includes(searchVal) ||
               (log.endpoint || '').toLowerCase().includes(searchVal) ||
               (log.details || '').toLowerCase().includes(searchVal) ||
               (log.type || '').toLowerCase().includes(searchVal);
    });
    
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim);">No matching system logs found.</td></tr>`;
        return;
    }
    
    filtered.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="log-timestamp">${new Date(log.timestamp).toLocaleString()}</td>
            <td><strong>${escapeHtml(log.username)}</strong></td>
            <td><code>${escapeHtml(log.ip_address)}</code></td>
            <td><span class="log-type ${log.type}">${escapeHtml(log.type)}</span></td>
            <td class="log-route">${escapeHtml(log.endpoint)}</td>
            <td class="log-details">${escapeHtml(log.details)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// --- WAVELY ONLINE SAMPLE BROWSER CONTROLLER ---
// ==========================================

let localFavorites = [];
let browserResults = [];
let localDownloaded = [];
let audioPlayer = null;
let currentlyPlayingSample = null;
let browserActivePanel = 'sounds'; // 'sounds', 'presets', 'liked', 'downloaded'
let browserInitialized = false;

// Initialize Sample Browser
function initSampleBrowser() {
    if (!browserInitialized) {
        browserInitialized = true;
        
        // Setup audio player event handlers
        setupBrowserAudioPlayer();
        
        // Load initial favorites and downloads first
        loadFavorites();
        loadDownloaded();
        
        // Execute default search
        executeBrowserSearch();
    } else {
        // Just refresh view
        renderBrowserResults();
    }
}

// Setup persistent HTML5 audio player
function setupBrowserAudioPlayer() {
    audioPlayer = new Audio();
    
    // volume progress bar initial state
    const volumeSlider = document.getElementById('player-volume');
    if (volumeSlider) {
        audioPlayer.volume = parseInt(volumeSlider.value) / 100;
    }
    
    audioPlayer.addEventListener('timeupdate', () => {
        const progressBar = document.getElementById('player-progress');
        const timeCurrent = document.getElementById('player-time-current');
        
        if (progressBar && audioPlayer.duration) {
            const pct = (audioPlayer.currentTime / audioPlayer.duration) * 100;
            progressBar.value = pct;
        }
        if (timeCurrent) {
            timeCurrent.innerText = formatTime(audioPlayer.currentTime);
        }
    });
    
    audioPlayer.addEventListener('durationchange', () => {
        const timeTotal = document.getElementById('player-time-total');
        if (timeTotal && audioPlayer.duration) {
            timeTotal.innerText = formatTime(audioPlayer.duration);
        }
    });
    
    audioPlayer.addEventListener('ended', () => {
        // Reset play icons
        const playBtn = document.getElementById('player-play-toggle');
        if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        
        currentlyPlayingSample = null;
        renderBrowserResults();
    });
    
    audioPlayer.addEventListener('play', () => {
        const playBtn = document.getElementById('player-play-toggle');
        if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        renderBrowserResults();
    });
    
    audioPlayer.addEventListener('pause', () => {
        const playBtn = document.getElementById('player-play-toggle');
        if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        renderBrowserResults();
    });
}

// Toggle play state of player
function togglePlayerPlay() {
    if (!audioPlayer) return;
    if (audioPlayer.paused) {
        audioPlayer.play().catch(err => console.log("Play failed: ", err));
    } else {
        audioPlayer.pause();
    }
}

// Seek position
function seekPlayer(value) {
    if (!audioPlayer || !audioPlayer.duration) return;
    audioPlayer.currentTime = (parseFloat(value) / 100) * audioPlayer.duration;
}

// Volume slider
function setPlayerVolume(value) {
    if (!audioPlayer) return;
    audioPlayer.volume = parseInt(value) / 100;
}

// Helper to format seconds to MM:SS
function formatTime(secs) {
    if (isNaN(secs)) return "0:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

// Load Favorites list (cloud or local storage)
function loadFavorites() {
    if (currentUser) {
        fetch('/api/web/favorites')
            .then(res => {
                if (res.ok) return res.json();
                throw new Error("Failed to load favorites");
            })
            .then(data => {
                localFavorites = data.favorites || [];
                updateFavoritesBadge();
                if (currentTab === 'browser') renderBrowserResults();
            })
            .catch(err => {
                console.log(err);
                loadOfflineFavorites();
            });
    } else {
        loadOfflineFavorites();
    }
}

function loadOfflineFavorites() {
    try {
        const stored = localStorage.getItem('wavely_favorites');
        localFavorites = stored ? JSON.parse(stored) : [];
    } catch (e) {
        localFavorites = [];
    }
    updateFavoritesBadge();
    if (currentTab === 'browser') renderBrowserResults();
}

function updateFavoritesBadge() {
    const badge = document.getElementById('liked-badge-count');
    if (badge) {
        badge.innerText = localFavorites.length;
    }
}

// Load local downloaded samples tracker
function loadDownloaded() {
    try {
        const stored = localStorage.getItem('wavely_downloaded');
        localDownloaded = stored ? JSON.parse(stored) : [];
    } catch (e) {
        localDownloaded = [];
    }
    updateDownloadedBadge();
}

function updateDownloadedBadge() {
    const badge = document.getElementById('downloaded-badge-count');
    if (badge) {
        badge.innerText = localDownloaded.length;
    }
}

// Toggle favorite sample
function toggleFavorite(sample) {
    if (currentUser) {
        fetch('/api/web/favorites/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sample: sample })
        })
        .then(res => {
            if (res.ok) return res.json();
            return res.json().then(d => { throw new Error(d.error || "Toggle failed") });
        })
        .then(data => {
            localFavorites = data.favorites || [];
            updateFavoritesBadge();
            renderBrowserResults();
            updatePlayerBarFavoriteState();
        })
        .catch(err => {
            alert(err.message);
        });
    } else {
        // Toggle offline favorite in localStorage
        const uuidVal = sample.uuid;
        const index = localFavorites.findIndex(f => f.uuid === uuidVal);
        if (index > -1) {
            localFavorites.splice(index, 1);
        } else {
            localFavorites.push(sample);
        }
        localStorage.setItem('wavely_favorites', JSON.stringify(localFavorites));
        updateFavoritesBadge();
        renderBrowserResults();
        updatePlayerBarFavoriteState();
    }
}

function togglePlayerFavorite() {
    if (currentlyPlayingSample) {
        toggleFavorite(currentlyPlayingSample);
    }
}

function updatePlayerBarFavoriteState() {
    const favBtn = document.getElementById('player-fav-btn');
    if (!favBtn || !currentlyPlayingSample) return;
    
    const isFav = localFavorites.some(f => f.uuid === currentlyPlayingSample.uuid);
    if (isFav) {
        favBtn.innerHTML = '<i class="fa-solid fa-star" style="color: #fbbf24;"></i>';
    } else {
        favBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
    }
}

// Switch between Sidebar panels: Sounds, Presets, Liked, Downloaded
function switchBrowserPanel(panelId) {
    browserActivePanel = panelId;
    
    // Update active nav button states
    document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const activeBtn = document.getElementById(`side-nav-${panelId}`);
    if (activeBtn) activeBtn.classList.add('active');
    
    const filterCard = document.getElementById('browser-filter-card');
    const soundsFilters = document.getElementById('filters-row-sounds');
    const presetsFilters = document.getElementById('filters-row-presets');
    const countTitle = document.getElementById('results-count-title');
    
    if (panelId === 'sounds') {
        if (filterCard) filterCard.style.display = 'block';
        if (soundsFilters) soundsFilters.style.display = 'flex';
        if (presetsFilters) presetsFilters.style.display = 'none';
        if (countTitle) countTitle.innerText = 'Sounds';
        executeBrowserSearch();
    } else if (panelId === 'presets') {
        if (filterCard) filterCard.style.display = 'block';
        if (soundsFilters) soundsFilters.style.display = 'none';
        if (presetsFilters) presetsFilters.style.display = 'flex';
        if (countTitle) countTitle.innerText = 'Presets';
        executeBrowserSearch();
    } else if (panelId === 'liked') {
        if (filterCard) filterCard.style.display = 'none';
        if (countTitle) countTitle.innerText = 'Liked Sounds';
        renderBrowserResults();
    } else if (panelId === 'downloaded') {
        if (filterCard) filterCard.style.display = 'none';
        if (countTitle) countTitle.innerText = 'Downloaded Sounds';
        renderBrowserResults();
    }
}

// Search execution API call
function executeBrowserSearch() {
    const query = document.getElementById('browser-search-input').value.trim();
    
    // Ensure default search value on empty query input
    const effectiveQuery = query || "synth lead";
    
    let keyRoot = '';
    let keyScale = '';
    let category = '';
    let type = '';
    let plugin = '';
    
    if (browserActivePanel === 'sounds') {
        keyRoot = document.getElementById('filter-key-root').value;
        keyScale = document.getElementById('filter-key-scale').value;
        category = document.getElementById('filter-instrument').value;
        type = document.getElementById('filter-type').value;
    } else if (browserActivePanel === 'presets') {
        type = 'preset';
        plugin = document.getElementById('filter-preset-plugin').value;
    }
    
    // Construct search key string
    let searchKey = '';
    if (keyRoot) {
        searchKey = keyRoot;
        if (keyScale) {
            searchKey += keyScale;
        }
    }
    
    // Show spinner loader
    document.getElementById('browser-loader').style.display = 'flex';
    document.getElementById('browser-table-wrapper').style.display = 'none';
    
    // Call web-friendly API endpoint
    const url = new URL('/api/web/search', window.location.origin);
    url.searchParams.append('q', effectiveQuery);
    if (category) url.searchParams.append('category', category);
    if (searchKey) url.searchParams.append('key', searchKey);
    if (type) url.searchParams.append('type', type);
    if (plugin) url.searchParams.append('plugin', plugin);
    
    fetch(url)
        .then(res => {
            if (res.ok) return res.json();
            throw new Error("Search query failed");
        })
        .then(data => {
            browserResults = data.results || [];
            
            document.getElementById('browser-loader').style.display = 'none';
            document.getElementById('browser-table-wrapper').style.display = 'block';
            
            // Set count
            document.getElementById('results-total-badge').innerText = `${data.count || 0} assets found`;
            
            // Render results
            renderBrowserResults();
        })
        .catch(err => {
            document.getElementById('browser-loader').style.display = 'none';
            document.getElementById('browser-table-wrapper').style.display = 'block';
            document.getElementById('results-total-badge').innerText = `Error`;
            console.error("Splice search error: ", err);
        });
}

// Render sample results list in the table
function renderBrowserResults() {
    const listBody = document.getElementById('browser-results-body');
    if (!listBody) return;
    
    listBody.innerHTML = '';
    
    let itemsToRender = [];
    if (browserActivePanel === 'sounds' || browserActivePanel === 'presets') {
        itemsToRender = browserResults;
    } else if (browserActivePanel === 'liked') {
        itemsToRender = localFavorites;
    } else if (browserActivePanel === 'downloaded') {
        itemsToRender = localDownloaded;
    }
    
    // Update badge count title for local lists
    if (browserActivePanel === 'liked') {
        document.getElementById('results-total-badge').innerText = `${itemsToRender.length} liked`;
    } else if (browserActivePanel === 'downloaded') {
        document.getElementById('results-total-badge').innerText = `${itemsToRender.length} downloaded`;
    }
    
    if (itemsToRender.length === 0) {
        const colSpan = 8;
        let hint = "No samples found. Try adjusting your query or filters.";
        if (browserActivePanel === 'liked') {
            hint = "No liked sounds yet. Click the star icon on any sample to save it here.";
        } else if (browserActivePanel === 'downloaded') {
            hint = "No downloaded sounds yet. Download any sample to view it here.";
        }
        listBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 40px; color: var(--text-dim);">${hint}</td></tr>`;
        return;
    }
    
    itemsToRender.forEach(sample => {
        const tr = document.createElement('tr');
        
        // Playing state check
        const isPlayingThis = currentlyPlayingSample && currentlyPlayingSample.uuid === sample.uuid && !audioPlayer.paused;
        const playIcon = isPlayingThis ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
        const playClass = isPlayingThis ? 'btn-play-cell playing' : 'btn-play-cell';
        
        // Favorite state check
        const isFav = localFavorites.some(f => f.uuid === sample.uuid);
        const favIconClass = isFav ? 'fa-solid fa-star favorited' : 'fa-regular fa-star';
        
        // Cover Art image or fallback
        const coverArt = sample.coverArt || '/static/placeholder-art.png';
        
        // Format tags
        let tagsHtml = '';
        const tagsToShow = (sample.tags || []).slice(0, 4);
        tagsToShow.forEach(tag => {
            tagsHtml += `<span class="sample-tag-pill">${escapeHtml(tag)}</span> `;
        });
        
        // Safe serialization of sample object
        const escapedSample = JSON.stringify(sample).replace(/'/g, "\\'").replace(/"/g, '&quot;');
        
        // Download cell button configuration based on preset vs sample
        let downloadCellHtml = '';
        if (sample.isPreset) {
            const ext = sample.presetExt || 'preset';
            downloadCellHtml = `
                <button class="btn btn-primary btn-sm" style="width: 100%; display: inline-flex; justify-content: center; align-items: center; gap: 4px;" onclick="downloadSampleFile(${escapedSample}, '${ext}')">
                    <i class="fa-solid fa-download"></i> Preset (.${ext})
                </button>
            `;
        } else {
            downloadCellHtml = `
                <div class="download-action-cell">
                    <button class="btn btn-secondary btn-sm" onclick="downloadSampleFile(${escapedSample}, 'mp3')">MP3</button>
                    <button class="btn btn-primary btn-sm" onclick="downloadSampleFile(${escapedSample}, 'wav')">WAV</button>
                </div>
            `;
        }

        tr.innerHTML = `
            <td>
                <button class="${playClass}" onclick="playSampleBrowser(${escapedSample})">
                    ${playIcon}
                </button>
            </td>
            <td>
                <img src="${escapeHtml(coverArt)}" alt="Art" class="cover-thumb">
            </td>
            <td>
                <div class="sample-info-cell">
                    <span class="sample-title-text">${escapeHtml(sample.name)}</span>
                    <span class="sample-meta-sub">Pack: <strong>${escapeHtml(sample.pack)}</strong></span>
                    <div class="sample-tags-wrap">${tagsHtml}</div>
                </div>
            </td>
            <td><code>${escapeHtml(sample.key || '--')}</code></td>
            <td><code>${escapeHtml(sample.bpm || '--')}</code></td>
            <td><code>${escapeHtml(sample.duration || '--')}</code></td>
            <td>
                <button class="btn-fav-cell" onclick="toggleFavorite(${escapedSample})">
                    <i class="${favIconClass}"></i>
                </button>
            </td>
            <td>
                ${downloadCellHtml}
            </td>
        `;
        listBody.appendChild(tr);
    });
}

// Play a sample inside the browser
function playSampleBrowser(sample) {
    if (!audioPlayer) return;
    
    // Toggle play/pause if clicking same track
    if (currentlyPlayingSample && currentlyPlayingSample.uuid === sample.uuid) {
        if (audioPlayer.paused) {
            audioPlayer.play().catch(err => console.log("Play failed: ", err));
        } else {
            audioPlayer.pause();
        }
        return;
    }
    
    // New track selection
    currentlyPlayingSample = sample;
    
    // Update bottom player panel fields
    document.getElementById('player-sample-name').innerText = sample.name;
    document.getElementById('player-sample-pack').innerText = sample.pack;
    const art = document.getElementById('player-art');
    if (art) art.src = sample.coverArt || '/static/placeholder-art.png';
    
    // Toggle player actions based on preset vs audio
    const dlMp3Btn = document.getElementById('player-download-mp3');
    const dlWavBtn = document.getElementById('player-download-wav');
    let dlPresetBtn = document.getElementById('player-download-preset');
    if (!dlPresetBtn) {
        dlPresetBtn = document.createElement('button');
        dlPresetBtn.id = 'player-download-preset';
        dlPresetBtn.className = 'btn btn-primary btn-sm';
        dlPresetBtn.onclick = () => downloadCurrentPlayerSample();
        dlMp3Btn.parentNode.appendChild(dlPresetBtn);
    }
    
    if (sample.isPreset) {
        dlMp3Btn.style.display = 'none';
        dlWavBtn.style.display = 'none';
        dlPresetBtn.style.display = 'inline-flex';
        dlPresetBtn.innerHTML = `<i class="fa-solid fa-download"></i> Preset (.${sample.presetExt || 'preset'})`;
    } else {
        dlMp3Btn.style.display = 'inline-flex';
        dlWavBtn.style.display = 'inline-flex';
        dlPresetBtn.style.display = 'none';
    }
    
    // Toggle active layout
    const playerBar = document.getElementById('persistent-player');
    if (playerBar) playerBar.classList.add('active');
    
    updatePlayerBarFavoriteState();
    
    // Load decrypted audio file stream endpoint
    audioPlayer.src = `/api/web/decrypted-audio/${sample.uuid}`;
    audioPlayer.load();
    audioPlayer.play().catch(err => console.log("Audio play error: ", err));
}

// Download action trigger
function downloadSampleFile(sample, format) {
    const uuid = sample.uuid;
    const url = `/api/web/decrypted-audio/${uuid}?format=${format}`;
    
    // Add to localDownloaded tracker
    const index = localDownloaded.findIndex(d => d.uuid === uuid);
    if (index === -1) {
        localDownloaded.push(sample);
        localStorage.setItem('wavely_downloaded', JSON.stringify(localDownloaded));
        updateDownloadedBadge();
    }
    
    // Resolve download filename
    let downloadName = sample.name;
    if (sample.isPreset) {
        const ext = sample.presetExt || 'preset';
        if (!downloadName.toLowerCase().endsWith('.' + ext.toLowerCase())) {
            downloadName = `${downloadName}.${ext}`;
        }
    } else {
        if (!downloadName.toLowerCase().endsWith('.' + format.toLowerCase())) {
            downloadName = `${downloadName}.${format}`;
        }
    }
    
    // Use Fetch Blob approach to guarantee the browser honors link.download
    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error("Network response was not ok");
            return res.blob();
        })
        .then(blob => {
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = downloadName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);
        })
        .catch(err => {
            console.warn("Blob download failed, falling back to direct link:", err);
            const link = document.createElement('a');
            link.href = url;
            link.download = downloadName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    
    // Re-render if currently on the downloaded panel
    if (browserActivePanel === 'downloaded') {
        renderBrowserResults();
    }
}

function downloadCurrentPlayerSample(format) {
    if (currentlyPlayingSample) {
        if (currentlyPlayingSample.isPreset) {
            downloadSampleFile(currentlyPlayingSample, currentlyPlayingSample.presetExt || 'preset');
        } else {
            downloadSampleFile(currentlyPlayingSample, format);
        }
    }
}

// Duplicate escapeHtml removed - using the one defined earlier

// --- COMMUNITY SYSTEM STATE & ROUTING ---
let currentDashTab = 'api';
let currentUserProfile = null;

function switchDashTab(tab) {
    currentDashTab = tab;
    document.querySelectorAll('.dash-menu-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.dash-subtab-pane').forEach(el => el.classList.remove('active'));
    
    const btn = document.getElementById(`menu-btn-${tab}`);
    if (btn) btn.classList.add('active');
    
    const pane = document.getElementById(`dash-subtab-${tab}`);
    if (pane) pane.classList.add('active');
    
    if (tab === 'profile') {
        loadUserProfile();
    } else if (tab === 'battles') {
        loadBeatBattles();
        loadLeaderboard();
    }
}

// --- COMMUNITY PAGE VIEW SWITCHER ---
let currentCommunityView = 'servers';

function switchCommunityView(view) {
    currentCommunityView = view;
    document.querySelectorAll('.community-top-tab').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.community-view').forEach(el => el.classList.remove('active'));
    
    const btn = document.getElementById(`comm-tab-${view}`);
    if (btn) btn.classList.add('active');
    
    const pane = document.getElementById(`community-view-${view}`);
    if (pane) pane.classList.add('active');
    
    if (view === 'servers') {
        loadServers();
    } else if (view === 'dms') {
        loadDMs();
    }
}

function initCommunityPage() {
    loadUserProfile();
    startCommunityPolling();
    switchCommunityView('servers');
    
    // Auto-join deep link checks
    const searchParams = new URLSearchParams(window.location.search);
    let joinServer = searchParams.get('joinserver');
    
    if (joinServer) {
        fetch(`/api/servers/join/${joinServer}`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert(`Successfully joined community server: ${data.name}`);
                loadServers();
            }
        });
    }
}

function loadUserProfile() {
    fetch('/api/profile')
        .then(res => res.json())
        .then(data => {
            if (data.error) return;
            currentUserProfile = data;
            
            // Fill sidebar details
            const elDashUsername = document.getElementById('dash-username');
            if (elDashUsername) elDashUsername.innerText = data.username;
            
            const elDashEloVal = document.getElementById('dash-elo-val');
            if (elDashEloVal) elDashEloVal.innerText = data.profile.elo || 0;
            
            const elDashRankVal = document.getElementById('dash-rank-val');
            if (elDashRankVal) elDashRankVal.innerText = data.profile.global_rank || '--';
            
            const elDashUpvotesVal = document.getElementById('dash-upvotes-val');
            if (elDashUpvotesVal) elDashUpvotesVal.innerText = data.profile.upvotes || 0;
            
            const elDashDownvotesVal = document.getElementById('dash-downvotes-val');
            if (elDashDownvotesVal) elDashDownvotesVal.innerText = data.profile.downvotes || 0;
            
            const elDashUserPfp = document.getElementById('dash-user-pfp');
            const elProfileEditPfpPreview = document.getElementById('profile-edit-pfp-preview');
            
            if (data.profile.pfp) {
                const pfpTs = '?t=' + Date.now();
                if (elDashUserPfp) elDashUserPfp.src = data.profile.pfp + pfpTs;
                if (elProfileEditPfpPreview) elProfileEditPfpPreview.src = data.profile.pfp + pfpTs;
            } else {
                if (elDashUserPfp) elDashUserPfp.src = '/static/placeholder-art.png';
                if (elProfileEditPfpPreview) elProfileEditPfpPreview.src = '/static/placeholder-art.png';
            }
            
            // Fill profile editing form fields
            const elProfileBioInput = document.getElementById('profile-bio-input');
            if (elProfileBioInput) {
                elProfileBioInput.value = data.profile.bio || '';
                updateBioCharCount();
            }
            const socials = data.profile.socials || {};
            const elProfileScInput = document.getElementById('profile-sc-input');
            if (elProfileScInput) elProfileScInput.value = socials.soundcloud || '';
            const elProfileYtInput = document.getElementById('profile-yt-input');
            if (elProfileYtInput) elProfileYtInput.value = socials.youtube || '';
            const elProfileTwInput = document.getElementById('profile-tw-input');
            if (elProfileTwInput) elProfileTwInput.value = socials.twitter || '';
            const elProfileSpInput = document.getElementById('profile-sp-input');
            if (elProfileSpInput) elProfileSpInput.value = socials.spotify || '';
        })
        .catch(err => console.error("Error loading user profile:", err));
}

// --- PROFILE EDITING ACTIONS ---
function updateBioCharCount() {
    const textarea = document.getElementById('profile-bio-input');
    const counter = document.getElementById('bio-char-counter');
    if (!textarea || !counter) return;
    const len = textarea.value.length;
    counter.innerText = `${len} / 300`;
    counter.className = 'bio-char-counter';
    if (len > 270) counter.classList.add('warn');
    if (len >= 300) counter.classList.add('danger');
}

function saveProfileChanges() {
    const btn = document.getElementById('btn-save-profile');
    const status = document.getElementById('profile-save-status');
    const bio = document.getElementById('profile-bio-input').value;
    const socials = {
        soundcloud: document.getElementById('profile-sc-input').value.trim(),
        youtube: document.getElementById('profile-yt-input').value.trim(),
        twitter: document.getElementById('profile-tw-input').value.trim(),
        spotify: document.getElementById('profile-sp-input').value.trim()
    };
    
    // Show loading state
    const originalText = btn.innerHTML;
    btn.classList.add('saving');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    status.className = 'profile-save-status loading';
    status.innerText = 'Saving...';
    
    fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bio, socials })
    })
    .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
            return res.text().then(text => {
                throw new Error('Server returned non-JSON response (status ' + res.status + '): ' + text.substring(0, 200));
            });
        }
        return res.json();
    })
    .then(data => {
        if (data.success) {
            status.className = 'profile-save-status success';
            status.innerText = '✓ Profile saved successfully!';
            loadUserProfile();
            setTimeout(() => {
                status.innerText = '';
                status.className = 'profile-save-status';
            }, 3000);
        } else {
            status.className = 'profile-save-status error';
            status.innerText = '✗ ' + (data.error || 'Failed to save profile');
        }
    })
    .catch(err => {
        status.className = 'profile-save-status error';
        status.innerText = '✗ ' + (err.message && err.message.startsWith('Server returned') ? 'Server error. Please try again.' : 'Connection error. Please try again.');
        console.error('Profile save error:', err);
    })
    .finally(() => {
        btn.classList.remove('saving');
        btn.disabled = false;
        btn.innerHTML = originalText;
    });
}

function uploadProfilePFP() {
    const fileInput = document.getElementById('profile-pfp-input');
    const status = document.getElementById('pfp-upload-status');
    if (!fileInput.files || fileInput.files.length === 0) return;
    
    const file = fileInput.files[0];
    
    // Validate file type and size
    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        status.className = 'pfp-upload-status error';
        status.innerText = '✗ Please select a PNG, JPEG, GIF, or WebP image';
        fileInput.value = '';
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        status.className = 'pfp-upload-status error';
        status.innerText = '✗ Image must be under 5 MB';
        fileInput.value = '';
        return;
    }
    
    // Show loading state
    status.className = 'pfp-upload-status loading';
    status.innerText = 'Uploading...';
    
    const formData = new FormData();
    formData.append('pfp', file);
    
    fetch('/api/profile/pfp', {
        method: 'POST',
        body: formData
    })
    .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
            return res.text().then(text => {
                throw new Error('Server returned non-JSON response (status ' + res.status + '): ' + text.substring(0, 200));
            });
        }
        return res.json();
    })
    .then(data => {
        if (data.success) {
            // Cache-bust: append timestamp to force browser to reload image
            const cacheBustedUrl = data.pfp_url + '?t=' + Date.now();
            document.getElementById('profile-edit-pfp-preview').src = cacheBustedUrl;
            document.getElementById('dash-user-pfp').src = cacheBustedUrl;
            
            status.className = 'pfp-upload-status success';
            status.innerText = '✓ Photo updated!';
            setTimeout(() => {
                status.innerText = '';
                status.className = 'pfp-upload-status';
            }, 3000);
        } else {
            status.className = 'pfp-upload-status error';
            status.innerText = '✗ ' + (data.error || 'Failed to upload image');
        }
    })
    .catch(err => {
        status.className = 'pfp-upload-status error';
        status.innerText = '✗ ' + (err.message && err.message.startsWith('Server returned') ? 'Server error. Please try again.' : 'Connection error. Please try again.');
        console.error('PFP upload error:', err);
    })
    .finally(() => {
        fileInput.value = '';
    });
}

// --- BEAT BATTLES SYSTEM ---
let currentBattleTab = 'active';
let allBattles = [];

function switchBattleTab(tab) {
    currentBattleTab = tab;
    document.querySelectorAll('.battle-tab-btn').forEach(el => el.classList.remove('active'));
    const btn = document.getElementById(`bt-tab-${tab}`);
    if (btn) btn.classList.add('active');
    renderBattles();
}

function loadBeatBattles() {
    fetch('/api/battles')
        .then(res => res.json())
        .then(data => {
            allBattles = data.battles || [];
            renderBattles();
        });
}

function renderBattles() {
    const container = document.getElementById('battles-list');
    container.innerHTML = '';
    
    const filtered = allBattles.filter(b => {
        if (currentBattleTab === 'active') return b.status === 'active';
        if (currentBattleTab === 'completed') return b.status === 'completed';
        if (currentBattleTab === 'my') return b.creator === currentUserProfile.username;
        if (currentBattleTab === 'joined') {
            return (b.tracks && b.tracks.some(t => t.username === currentUserProfile.username)) || (b.participants && b.participants.includes(currentUserProfile.username));
        }
        return true;
    });
    
    if (filtered.length === 0) {
        container.innerHTML = `<p style="padding: 24px; text-align: center; opacity: 0.5;">No battles in this category.</p>`;
        return;
    }
    
    filtered.forEach(b => {
        const deadlineDate = new Date(b.deadline);
        const card = document.createElement('div');
        card.className = 'battle-card';
        card.onclick = () => showBattleDetail(b.id);
        card.innerHTML = `
            <div class="battle-card-header">
                <span class="battle-card-title">${escapeHtml(b.title)}</span>
                <span class="battle-status-badge status-${b.status}">${b.status.toUpperCase()}</span>
            </div>
            <p style="font-size:13px; opacity:0.8; margin-bottom:12px;">${escapeHtml(b.description)}</p>
            <div class="battle-card-details">
                <span><i class="fa-solid fa-key"></i> Key: ${escapeHtml(b.key)}</span>
                <span><i class="fa-solid fa-music"></i> Style: ${escapeHtml(b.style)}</span>
                <span><i class="fa-solid fa-clock"></i> Ends: ${deadlineDate.toLocaleString()}</span>
                <span><i class="fa-solid fa-file-audio"></i> Submissions: ${b.tracks.length}</span>
            </div>
        `;
        container.appendChild(card);
    });
}

let activeBattleDetailId = null;
function showBattleDetail(battleId) {
    activeBattleDetailId = battleId;
    const battle = allBattles.find(b => b.id === battleId);
    if (!battle) return;
    
    document.getElementById('battle-leaderboard-panel').style.display = 'none';
    const detailPanel = document.getElementById('battle-detail-panel');
    detailPanel.style.display = 'block';
    
    const isParticipant = (battle.participants && battle.participants.includes(currentUserProfile.username)) || battle.creator === currentUserProfile.username;
    let submitSection = '';
    if (battle.status === 'active') {
        if (isParticipant) {
            submitSection = `
                <div class="battle-submit-form" style="margin-top:20px; padding:15px; border:1px solid var(--border-color); border-radius:8px; background:rgba(255,255,255,0.01);">
                    <h4>Submit Your Track Entry</h4>
                    <div class="form-group" style="margin-top:10px;">
                        <input type="file" id="track-submission-file" class="input-form" accept="audio/*">
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="submitBattleEntry('${battle.id}')">Submit Track</button>
                </div>
            `;
        } else {
            submitSection = `
                <div class="battle-join-cta" style="margin-top:20px; padding:20px; border:1px solid rgba(155, 89, 182, 0.4); border-radius:8px; background:rgba(155, 89, 182, 0.05); text-align:center;">
                    <h4 style="margin-bottom:10px;">Join this Beat Battle to submit your entry!</h4>
                    <button class="btn btn-primary" onclick="joinBattleFromUI('${battle.invite_code}', '${battle.id}')"><i class="fa-solid fa-right-to-bracket"></i> Join Battle</button>
                </div>
            `;
        }
    } else {
        submitSection = `
            <div class="battle-completed-winner" style="margin-top:20px; padding:15px; border:1px dashed var(--accent); border-radius:8px; background:rgba(217, 70, 239, 0.05); text-align:center;">
                <h4 style="color:var(--accent);"><i class="fa-solid fa-trophy"></i> Winner: ${escapeHtml(battle.winner || 'None')}</h4>
            </div>
        `;
    }
    
    let tracksListHtml = '';
    if (battle.tracks.length === 0) {
        tracksListHtml = `<p style="opacity:0.5; padding:10px 0;">No tracks submitted yet.</p>`;
    } else {
        const sortedTracks = [...battle.tracks].sort((t1, t2) => {
            const votes1 = Object.values(t1.votes || {}).reduce((a, b) => a + b, 0);
            const votes2 = Object.values(t2.votes || {}).reduce((a, b) => a + b, 0);
            return votes2 - votes1;
        });
        
        sortedTracks.forEach(t => {
            const netVotes = Object.values(t.votes || {}).reduce((a, b) => a + b, 0);
            const myVote = t.votes[currentUserProfile.username] || 0;
            const hasUpvoted = myVote === 1;
            const hasDownvoted = myVote === -1;
            
            let commentRows = '';
            (t.comments || []).forEach(c => {
                commentRows += `
                    <div style="font-size:12px; background:rgba(255,255,255,0.02); padding:6px; border-radius:4px; margin-bottom:4px;">
                        <span class="user-hoverable" onmouseover="showHovercard(event, '${c.username}')" style="font-weight:700; color:var(--primary-hover); cursor:pointer;">${escapeHtml(c.username)}:</span>
                        <span>${escapeHtml(c.comment)}</span>
                    </div>
                `;
            });
            
            tracksListHtml += `
                <div class="battle-track-row" style="padding:15px; border-bottom:1px solid rgba(255,255,255,0.05);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="user-hoverable" onmouseover="showHovercard(event, '${t.username}')" style="font-weight:700; font-size:14px; cursor:pointer;">${escapeHtml(t.username)}</span>
                            <button class="btn btn-secondary btn-xs" onclick="startDMWith('${t.username}')"><i class="fa-solid fa-message"></i> Message</button>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <button class="btn btn-xs ${hasUpvoted ? 'btn-primary' : 'btn-secondary'}" onclick="voteBattleTrack('${battle.id}', '${t.id}', 1)"><i class="fa-solid fa-thumbs-up"></i></button>
                            <span style="font-weight:700; font-size:13px; min-width:20px; text-align:center;">${netVotes}</span>
                            <button class="btn btn-xs ${hasDownvoted ? 'btn-error' : 'btn-secondary'}" onclick="voteBattleTrack('${battle.id}', '${t.id}', -1)"><i class="fa-solid fa-thumbs-down"></i></button>
                        </div>
                    </div>
                    
                    <audio src="${t.audio_url}" controls style="width:100%; height:32px; border-radius:4px; margin-bottom:8px;"></audio>
                    
                    <div class="track-comments-box" style="margin-top:10px;">
                        <div class="comments-list" style="margin-bottom:8px; max-height:100px; overflow-y:auto;">
                            ${commentRows}
                        </div>
                        <div style="display:flex; gap:8px;">
                            <input type="text" id="comment-input-${t.id}" class="input-form input-xs" placeholder="Post a comment..." style="flex:1;">
                            <button class="btn btn-primary btn-xs" onclick="postTrackComment('${battle.id}', '${t.id}')">Post</button>
                        </div>
                    </div>
                </div>
            `;
        });
    }
    
    detailPanel.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <button class="btn btn-secondary btn-sm" onclick="hideBattleDetail()"><i class="fa-solid fa-arrow-left"></i> Back to Leaderboard</button>
            <span class="invite-label-copy" onclick="copyBattleInvite('${battle.invite_code}')" style="cursor:pointer; font-size:12px; color:var(--primary-hover);"><i class="fa-solid fa-link"></i> Invite Code: ${battle.invite_code} (Click link)</span>
        </div>
        
        <h2>${escapeHtml(battle.title)}</h2>
        <p style="margin:10px 0; opacity:0.8;">${escapeHtml(battle.description)}</p>
        
        <div class="battle-details-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:15px 0; font-size:13px; color:var(--text-muted);">
            <div><strong>Key Constraint:</strong> ${escapeHtml(battle.key)}</div>
            <div><strong>Style Theme:</strong> ${escapeHtml(battle.style)}</div>
            <div><strong>UTC Deadline:</strong> ${new Date(battle.deadline).toLocaleString()}</div>
            <div><strong>Reference Sample:</strong> <a href="${battle.sample_url}" target="_blank" style="color:var(--primary-hover); text-decoration:underline;">Download Reference</a></div>
        </div>
        
        ${submitSection}
        
        <h3 style="margin-top:25px; margin-bottom:15px; border-bottom:1px solid var(--border-color); padding-bottom:6px;">Entries (${battle.tracks.length})</h3>
        <div class="battle-tracks-list-wrap">
            ${tracksListHtml}
        </div>
    `;
}

function hideBattleDetail() {
    document.getElementById('battle-detail-panel').style.display = 'none';
    document.getElementById('battle-leaderboard-panel').style.display = 'block';
    activeBattleDetailId = null;
}

function copyBattleInvite(code) {
    const link = `${window.location.origin}/#dashboard?joinbattle=${code}`;
    navigator.clipboard.writeText(link).then(() => {
        alert("Invite link copied to clipboard!");
    });
}

function joinBattleFromUI(inviteCode, battleId) {
    fetch(`/api/battles/join/${inviteCode}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert(`Successfully joined battle: ${data.title}`);
                fetch('/api/battles')
                    .then(res => res.json())
                    .then(resData => {
                        allBattles = resData.battles || [];
                        showBattleDetail(battleId);
                    });
            } else {
                alert("Failed to join: " + (data.error || ""));
            }
        });
}

function voteBattleTrack(battleId, trackId, value) {
    const battle = allBattles.find(b => b.id === battleId);
    const track = battle ? battle.tracks.find(t => t.id === trackId) : null;
    const currentVal = track ? track.votes[currentUserProfile.username] : null;
    const targetVal = (currentVal === value) ? 0 : value;
    
    fetch('/api/battles/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ battle_id: battleId, track_id: trackId, vote: targetVal })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            loadBeatBattles();
            setTimeout(() => {
                showBattleDetail(battleId);
            }, 200);
        }
    });
}

function postTrackComment(battleId, trackId) {
    const input = document.getElementById(`comment-input-${trackId}`);
    const text = input.value.trim();
    if (!text) return;
    
    fetch('/api/battles/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ battle_id: battleId, track_id: trackId, comment: text })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            input.value = '';
            loadBeatBattles();
            setTimeout(() => {
                showBattleDetail(battleId);
            }, 200);
        }
    });
}

function submitBattleEntry(battleId) {
    const fileInput = document.getElementById('track-submission-file');
    if (!fileInput.files || fileInput.files.length === 0) {
        alert("Please select your audio file first");
        return;
    }
    
    const formData = new FormData();
    formData.append('battle_id', battleId);
    formData.append('track', fileInput.files[0]);
    
    fetch('/api/battles/submit', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert("Entry uploaded!");
            loadBeatBattles();
            setTimeout(() => {
                showBattleDetail(battleId);
            }, 200);
        } else {
            alert("Submission failed: " + (data.error || ""));
        }
    });
}

function loadLeaderboard() {
    fetch('/api/battles/leaderboard')
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('leaderboard-table-body');
            tbody.innerHTML = '';
            (data.leaderboard || []).forEach((u, i) => {
                const rank = i + 1;
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td class="leaderboard-rank rank-${rank <= 3 ? rank : 'other'}">${rank}</td>
                    <td class="user-hoverable" onmouseover="showHovercard(event, '${u.username}')" style="font-weight:700; cursor:pointer;">${escapeHtml(u.username)}</td>
                    <td style="color:var(--accent); font-weight:700;">${u.elo}</td>
                    <td>${u.wins}</td>
                    <td style="color:var(--success); font-weight:700;">${u.upvotes}</td>
                    <td style="color:var(--error); font-weight:700;">${u.downvotes}</td>
                `;
                tbody.appendChild(row);
            });
        });
}

function showCreateBattleModal() {
    document.getElementById('create-battle-modal').style.display = 'flex';
}
function hideCreateBattleModal() {
    document.getElementById('create-battle-modal').style.display = 'none';
}
function submitCreateBattle() {
    const title = document.getElementById('battle-title-input').value.trim();
    const description = document.getElementById('battle-desc-input').value.trim();
    const key = document.getElementById('battle-key-input').value.trim();
    const style = document.getElementById('battle-style-input').value.trim();
    const deadline = document.getElementById('battle-deadline-input').value;
    const isPublic = document.getElementById('battle-visibility-input').value;
    const fileInput = document.getElementById('battle-sample-file-input');
    
    if (!title || !deadline || !fileInput.files || fileInput.files.length === 0) {
        alert("All fields (including the reference sample audio) are required.");
        return;
    }
    
    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', description);
    formData.append('key', key);
    formData.append('style', style);
    formData.append('deadline', deadline);
    formData.append('is_public', isPublic);
    formData.append('sample', fileInput.files[0]);
    
    fetch('/api/battles/create', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert("Battle published!");
            hideCreateBattleModal();
            loadBeatBattles();
        } else {
            alert("Failed to publish: " + (data.error || ""));
        }
    });
}

// --- DIRECT MESSAGES (DMs) ---
let currentDMPartner = null;

function loadDMs() {
    fetch('/api/dms')
        .then(res => res.json())
        .then(data => {
            const container = document.getElementById('dms-list-container');
            container.innerHTML = '';
            
            if (data.dms.length === 0) {
                container.innerHTML = `<p style="opacity: 0.5; text-align: center; padding: 24px;">No active conversations.</p>`;
                return;
            }
            
            data.dms.forEach(d => {
                const item = document.createElement('div');
                item.className = `dm-thread-item ${currentDMPartner === d ? 'active' : ''}`;
                item.onclick = () => selectDMPartner(d);
                item.innerHTML = `
                    <img src="/static/placeholder-art.png" class="user-avatar-small" alt="Avatar" style="width:24px; height:24px; border-radius:50%; margin-right:8px; object-fit:cover;">
                    <span>${escapeHtml(d)}</span>
                `;
                container.appendChild(item);
            });
        });
}

function selectDMPartner(username) {
    currentDMPartner = username;
    document.querySelectorAll('.dm-thread-item').forEach(el => el.classList.remove('active'));
    
    document.getElementById('dm-recipient-name').innerText = username;
    document.getElementById('dm-call-actions-panel').style.display = 'flex';
    
    fetch(`/api/profile/hovercard/${username}`)
        .then(res => res.json())
        .then(data => {
            if (data.profile && data.profile.pfp) {
                document.getElementById('dm-recipient-pfp').src = data.profile.pfp;
            } else {
                document.getElementById('dm-recipient-pfp').src = '/static/placeholder-art.png';
            }
        });
        
    loadDMMessages();
    closeDMCommunitySidebar();
}

function loadDMMessages() {
    if (!currentDMPartner) return;
    fetch(`/api/dms/messages/${currentDMPartner}`)
        .then(res => res.json())
        .then(data => {
            const container = document.getElementById('dm-chat-messages');
            updateChatMessages(container, data.messages || [], true);
        });
}

function sendDMMessage() {
    const input = document.getElementById('dm-chat-input');
    const content = input.value.trim();
    if (!content || !currentDMPartner) return;
    
    fetch('/api/dms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: currentDMPartner, content })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            input.value = '';
            loadDMMessages();
        }
    });
}

function handleDMKeydown(e) {
    if (e.key === 'Enter') sendDMMessage();
}

function startDMWith(username) {
    switchDashTab('dms');
    fetch('/api/dms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: username, content: "👋 Hey! Let's collab on some beats." })
    })
    .then(() => {
        loadDMs();
        selectDMPartner(username);
    });
}

// --- COMMUNITY SERVERS SYSTEM ---
let currentServerId = null;
let currentChannelId = null;
let allServers = [];

function loadServers() {
    fetch('/api/servers')
        .then(res => res.json())
        .then(data => {
            allServers = data.servers || [];
            
            const dock = document.getElementById('servers-icons-container');
            dock.innerHTML = '';
            
            allServers.forEach(s => {
                const icon = document.createElement('div');
                icon.className = `btn-server-dock ${currentServerId === s.id ? 'active' : ''}`;
                icon.title = s.name;
                icon.onclick = () => selectServer(s.id);
                icon.innerHTML = `<img src="${s.icon_url || '/static/placeholder-art.png'}" style="width:100%; height:100%; border-radius:inherit; object-fit:cover;">`;
                dock.appendChild(icon);
            });
            
            if (currentServerId) {
                const srv = allServers.find(s => s.id === currentServerId);
                if (srv) selectServer(srv.id);
            }
        });
}

function selectServer(serverId) {
    currentServerId = serverId;
    const server = allServers.find(s => s.id === serverId);
    if (!server) return;
    
    document.querySelectorAll('.btn-server-dock').forEach(el => el.classList.remove('active'));
    
    document.getElementById('selected-server-name').innerText = server.name;
    document.getElementById('selected-server-invite').innerText = `Invite Link: ${window.location.origin}/#dashboard?joinserver=${server.invite_code} (Click to copy)`;
    
    const isOwner = server.owner === currentUserProfile.username;
    const myRoles = server.members[currentUserProfile.username] || [];
    const isMod = isOwner || myRoles.includes('role-mod');
    
    document.getElementById('server-admin-controls').style.display = isMod ? 'flex' : 'none';
    
    renderServerChannels(server);
    renderServerMembers(server);
    
    if (server.channels.length > 0) {
        selectChannel(server.channels[0].id);
    }
    closeAllCommunitySidebars();
}

function copyServerInviteLink() {
    const server = allServers.find(s => s.id === currentServerId);
    if (!server) return;
    const link = `${window.location.origin}/#dashboard?joinserver=${server.invite_code}`;
    navigator.clipboard.writeText(link).then(() => {
        alert("Server join link copied to clipboard!");
    });
}

function renderServerChannels(server) {
    const container = document.getElementById('server-channels-container');
    container.innerHTML = '';
    
    const me = currentUserProfile ? currentUserProfile.username : null;
    const members = server.members || {};
    const isOwner = !!me && server.owner === me;
    const myRoles = (me && members[me]) || [];
    const isMod = isOwner || myRoles.includes('role-mod');
    
    const sortedCats = [...(server.categories || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
    
    sortedCats.forEach(cat => {
        const catWrap = document.createElement('div');
        catWrap.className = 'channel-category-wrap';
        
        let reorderCatBtns = '';
        if (isMod) {
            reorderCatBtns = `
                <div style="display:inline-flex; gap:4px; margin-left:auto; align-items:center;">
                    <button onclick="reorderCategory(event, '${cat.id}', 'up')" title="Move Up" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px;"><i class="fa-solid fa-chevron-up"></i></button>
                    <button onclick="reorderCategory(event, '${cat.id}', 'down')" title="Move Down" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px;"><i class="fa-solid fa-chevron-down"></i></button>
                    <button class="btn-edit-category-settings" onclick="openCategorySettingsModal(event, '${cat.id}')" title="Category Settings" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:11px; margin-left:2px;"><i class="fa-solid fa-gear"></i></button>
                </div>
            `;
        }
        
        catWrap.innerHTML = `
            <div class="channel-category-header" style="display:flex; align-items:center;">
                <span>${escapeHtml(cat.name)}</span>
                ${reorderCatBtns}
            </div>
        `;
        
        const channels = (server.channels || []).filter(c => c.category_id === cat.id);
        channels.sort((a, b) => (a.position || 0) - (b.position || 0));
        
        channels.forEach(chan => {
            if (chan.allowed_roles && chan.allowed_roles.length > 0) {
                const hasRole = isOwner || myRoles.some(rid => chan.allowed_roles.includes(rid));
                if (!hasRole) return;
            }
            
            let reorderChanBtns = '';
            if (isMod) {
                reorderChanBtns = `
                    <div style="display:inline-flex; gap:2px; margin-left:auto; opacity:0.6; align-items:center;">
                        <button onclick="reorderChannel(event, '${chan.id}', 'up')" title="Move Up" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:9px;"><i class="fa-solid fa-chevron-up"></i></button>
                        <button onclick="reorderChannel(event, '${chan.id}', 'down')" title="Move Down" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:9px;"><i class="fa-solid fa-chevron-down"></i></button>
                    </div>
                `;
            }
            
            const item = document.createElement('div');
            item.className = `channel-item ${currentChannelId === chan.id ? 'active' : ''}`;
            item.onclick = (e) => {
                e.stopPropagation();
                selectChannel(chan.id);
            };
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.innerHTML = `
                <span># ${escapeHtml(chan.name)}</span>
                ${reorderChanBtns}
            `;
            catWrap.appendChild(item);
        });
        
        container.appendChild(catWrap);
    });
}

function selectChannel(channelId) {
    currentChannelId = channelId;
    const server = allServers.find(s => s.id === currentServerId);
    if (!server) return;
    
    const channel = server.channels.find(c => c.id === channelId);
    if (!channel) return;
    
    document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
    
    document.getElementById('selected-channel-name').innerText = channel.name;
    document.getElementById('server-chat-input').placeholder = `Message #${channel.name}`;
    
    document.getElementById('channel-slowmode-indicator').style.display = channel.slowmode > 0 ? 'inline-block' : 'none';
    document.getElementById('channel-locked-indicator').style.display = channel.locked ? 'inline-block' : 'none';
    
    const isOwner = server.owner === currentUserProfile.username;
    const myRoles = server.members[currentUserProfile.username] || [];
    const isMod = isOwner || myRoles.includes('role-mod');
    document.getElementById('btn-channel-settings').style.display = isMod ? 'inline-block' : 'none';
    
    loadServerMessages();
    closeAllCommunitySidebars();
}

function loadServerMessages() {
    if (!currentServerId || !currentChannelId) return;
    fetch(`/api/servers/messages/${currentServerId}/${currentChannelId}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) return;
            const container = document.getElementById('server-chat-messages');
            updateChatMessages(container, data.messages || [], false);
        });
}

function sendServerChatMessage() {
    const input = document.getElementById('server-chat-input');
    const content = input.value.trim();
    if (!content || !currentServerId || !currentChannelId) return;
    
    fetch('/api/servers/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_id: currentServerId, channel_id: currentChannelId, content })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
        } else {
            input.value = '';
            loadServerMessages();
        }
    });
}

function handleServerChatKeydown(e) {
    if (e.key === 'Enter') sendServerChatMessage();
}

function renderServerMembers(server) {
    const container = document.getElementById('server-members-container');
    container.innerHTML = '';
    
    const me = currentUserProfile ? currentUserProfile.username : null;
    const sortedRoles = [...(server.roles || [])].sort((a, b) => (b.position || 0) - (a.position || 0));
    const groups = {};
    const fallbackGroup = [];
    
    Object.keys(server.members || {}).forEach(mname => {
        const mroles = server.members[mname] || [];
        const separateRole = sortedRoles.find(r => r.show_separately && mroles.includes(r.id));
        if (separateRole) {
            if (!groups[separateRole.id]) groups[separateRole.id] = [];
            groups[separateRole.id].push(mname);
        } else {
            fallbackGroup.push(mname);
        }
    });
    
    function renderMemberItem(mname, roleColor = 'var(--text-main)') {
        const mroles = server.members[mname] || [];
        const isMemOwner = server.owner === mname;
        
        let tagsHtml = '';
        if (isMemOwner) {
            tagsHtml += `<span class="member-role-tag" style="background:rgba(230,126,34,0.2); color:#e67e22;">OWNER</span> `;
        }
        
        mroles.forEach(rid => {
            const role = (server.roles || []).find(r => r.id === rid);
            if (role) {
                tagsHtml += `<span class="member-role-tag" style="background:rgba(255,255,255,0.05); color:${role.color};">${role.name.toUpperCase()}</span> `;
            }
        });
        
        let actionBtns = '';
        const myRoles = (me && server.members[me]) || [];
        const isCurrentUserOwner = !!me && server.owner === me;
        const hasModPerm = isCurrentUserOwner || myRoles.includes('role-mod');
        
        if (isCurrentUserOwner && mname !== server.owner) {
            actionBtns += `<button class="btn btn-ghost btn-xs sidebar-manage-roles-btn" onclick="openMemberRolesModal('${mname}')" title="Manage Roles" style="padding: 2px 5px;"><i class="fa-solid fa-user-gear"></i></button>`;
        }
        
        if (hasModPerm && mname !== server.owner && mname !== me) {
            actionBtns += `
                <button class="btn btn-secondary btn-xs" onclick="kickServerMember('${mname}')" style="padding: 2px 5px; margin-left:4px;">Kick</button>
                <button class="btn btn-error btn-xs" style="background:#ef4444; padding: 2px 5px; margin-left:4px;" onclick="banServerMember('${mname}')">Ban</button>
            `;
        }
        
        const mitem = document.createElement('div');
        mitem.className = 'member-item';
        mitem.style.display = 'flex';
        mitem.style.alignItems = 'center';
        mitem.innerHTML = `
            <img src="/static/placeholder-art.png" class="user-avatar-small" alt="Avatar" style="width:24px; height:24px; border-radius:50%; object-fit:cover; margin-right:8px;">
            <div style="display:flex; flex-direction:column; flex:1;">
                <span class="user-hoverable" onmouseover="showHovercard(event, '${mname}')" style="font-weight:700; cursor:pointer; color:${roleColor};">${escapeHtml(mname)}</span>
                <div style="margin-top:2px;">${tagsHtml}</div>
            </div>
            <div style="display:inline-flex; align-items:center; gap:2px; margin-left:auto;">
                ${actionBtns}
            </div>
        `;
        return mitem;
    }
    
    sortedRoles.forEach(role => {
        if (!role.show_separately) return;
        const membersInRole = groups[role.id] || [];
        if (membersInRole.length === 0) return;
        
        const header = document.createElement('div');
        header.style.fontSize = '10px';
        header.style.fontWeight = '800';
        header.style.textTransform = 'uppercase';
        header.style.color = role.color;
        header.style.marginTop = '12px';
        header.style.marginBottom = '4px';
        header.style.letterSpacing = '0.5px';
        header.innerText = `${role.name} — ${membersInRole.length}`;
        container.appendChild(header);
        
        membersInRole.forEach(mname => {
            container.appendChild(renderMemberItem(mname, role.color));
        });
    });
    
    if (fallbackGroup.length > 0) {
        const header = document.createElement('div');
        header.style.fontSize = '10px';
        header.style.fontWeight = '800';
        header.style.textTransform = 'uppercase';
        header.style.color = 'var(--text-dim)';
        header.style.marginTop = '12px';
        header.style.marginBottom = '4px';
        header.style.letterSpacing = '0.5px';
        header.innerText = `Online — ${fallbackGroup.length}`;
        container.appendChild(header);
        
        fallbackGroup.forEach(mname => {
            container.appendChild(renderMemberItem(mname));
        });
    }
}

function kickServerMember(username) {
    if (!confirm(`Are you sure you want to kick ${username}?`)) return;
    fetch('/api/servers/members/kick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_id: currentServerId, username })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert(`${username} kicked.`);
            loadServers();
        }
    });
}

function banServerMember(username) {
    if (!confirm(`Are you sure you want to ban ${username}?`)) return;
    fetch('/api/servers/members/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_id: currentServerId, username })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert(`${username} banned.`);
            loadServers();
        }
    });
}

function showCreateServerModal() {
    document.getElementById('create-server-modal').style.display = 'flex';
}
function hideCreateServerModal() {
    document.getElementById('create-server-modal').style.display = 'none';
}
function submitCreateServer() {
    const name = document.getElementById('server-name-input').value.trim();
    if (!name) {
        alert('Please enter a server name.');
        return;
    }
    
    const btn = document.querySelector('#create-server-modal .btn-primary');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';
    
    const formData = new FormData();
    formData.append('name', name);
    const iconInput = document.getElementById('server-icon-input');
    if (iconInput.files.length > 0) {
        formData.append('icon', iconInput.files[0]);
    }
    
    fetch('/api/servers/create', {
        method: 'POST',
        body: formData
    })
    .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
            return res.text().then(text => {
                throw new Error('Server returned non-JSON response (status ' + res.status + '): ' + text.substring(0, 200));
            });
        }
        return res.json();
    })
    .then(data => {
        if (data.success) {
            hideCreateServerModal();
            loadServers();
        } else {
            alert('Failed to create server: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(err => {
        console.error('Create server error:', err);
        alert(err.message && err.message.startsWith('Server returned') ? 'Server error. Please try again.' : 'Connection error. Please try again.');
    })
    .finally(() => {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    });
}

function showJoinServerModal() {
    document.getElementById('join-server-modal').style.display = 'flex';
}
function hideJoinServerModal() {
    document.getElementById('join-server-modal').style.display = 'none';
}
function submitJoinServer() {
    const code = document.getElementById('server-join-code-input').value.trim();
    if (!code) {
        alert('Please enter an invite code.');
        return;
    }
    
    fetch(`/api/servers/join/${code}`, { method: 'POST' })
    .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
            return res.text().then(text => {
                throw new Error('Server returned non-JSON response (status ' + res.status + '): ' + text.substring(0, 200));
            });
        }
        return res.json();
    })
    .then(data => {
        if (data.success) {
            hideJoinServerModal();
            loadServers();
        } else {
            alert("Join failed: " + (data.error || ""));
        }
    })
    .catch(err => {
        console.error('Join server error:', err);
        alert(err.message && err.message.startsWith('Server returned') ? 'Server error. Please try again.' : 'Connection error. Please try again.');
    });
}

function showCreateCatChanModal() {
    document.getElementById('create-cat-chan-modal').style.display = 'flex';
    const select = document.getElementById('catchan-category-select');
    select.innerHTML = '';
    const server = allServers.find(s => s.id === currentServerId);
    if (server) {
        server.categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.innerText = cat.name;
            select.appendChild(opt);
        });
    }
    toggleCatChanFields();
}
function hideCreateCatChanModal() {
    document.getElementById('create-cat-chan-modal').style.display = 'none';
}
function toggleCatChanFields() {
    const type = document.getElementById('catchan-type-input').value;
    document.getElementById('catchan-category-select-wrap').style.display = type === 'channel' ? 'block' : 'none';
}
function submitCreateCatChan() {
    const type = document.getElementById('catchan-type-input').value;
    const name = document.getElementById('catchan-name-input').value.trim();
    const category_id = document.getElementById('catchan-category-select').value;
    
    if (!name) return;
    
    fetch('/api/servers/channels/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_id: currentServerId, type, name, category_id })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            hideCreateCatChanModal();
            loadServers();
        }
    });
}

function showChannelSettingsModal() {
    const server = allServers.find(s => s.id === currentServerId);
    const channel = server ? server.channels.find(c => c.id === currentChannelId) : null;
    if (!channel) return;
    
    document.getElementById('channel-slowmode-input').value = channel.slowmode || 0;
    document.getElementById('channel-locked-input').checked = channel.locked || false;
    
    const catSelect = document.getElementById('channel-move-category-select');
    catSelect.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.innerText = 'Uncategorized';
    if (!channel.category_id) noneOpt.selected = true;
    catSelect.appendChild(noneOpt);
    
    server.categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.innerText = cat.name;
        if (channel.category_id === cat.id) {
            opt.selected = true;
        }
        catSelect.appendChild(opt);
    });
    
    const rolesList = document.getElementById('channel-roles-list');
    rolesList.innerHTML = '';
    
    server.roles.forEach(role => {
        const checked = (channel.allowed_roles || []).includes(role.id) ? 'checked' : '';
        const item = document.createElement('label');
        item.style.cursor = 'pointer';
        item.innerHTML = `
            <input type="checkbox" value="${role.id}" ${checked} class="channel-allowed-role-cb" style="margin-right:6px;">
            <span style="color:${role.color}; font-weight:700;">${escapeHtml(role.name)}</span>
        `;
        rolesList.appendChild(item);
    });
    
    document.getElementById('channel-settings-modal').style.display = 'flex';
}
function hideChannelSettingsModal() {
    document.getElementById('channel-settings-modal').style.display = 'none';
}
function submitChannelSettings() {
    const slowmode = document.getElementById('channel-slowmode-input').value;
    const locked = document.getElementById('channel-locked-input').checked;
    
    const checkedRoles = [];
    document.querySelectorAll('.channel-allowed-role-cb:checked').forEach(cb => {
        checkedRoles.push(cb.value);
    });
    
    const newCategoryId = document.getElementById('channel-move-category-select').value || null;
    
    fetch('/api/servers/channels/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            server_id: currentServerId,
            channel_id: currentChannelId,
            slowmode,
            locked,
            allowed_roles: checkedRoles
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            return fetch('/api/servers/channels/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    server_id: currentServerId,
                    channel_id: currentChannelId,
                    category_id: newCategoryId
                })
            });
        } else {
            throw new Error("Failed to modify channel settings");
        }
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            hideChannelSettingsModal();
            loadServers();
        } else {
            alert(data.error || "Failed to move channel category");
        }
    })
    .catch(err => alert(err.message));
}

function showServerRolesModal() {
    const server = allServers.find(s => s.id === currentServerId);
    if (!server) return;
    
    const container = document.getElementById('roles-mini-list-container');
    container.innerHTML = '';
    
    server.roles.forEach(role => {
        const item = document.createElement('div');
        item.style.padding = '6px';
        item.style.background = 'rgba(255,255,255,0.02)';
        item.style.borderRadius = '4px';
        item.style.color = role.color;
        item.style.fontWeight = '700';
        item.innerText = role.name;
        container.appendChild(item);
    });
    
    document.getElementById('server-roles-modal').style.display = 'flex';
}
function hideServerRolesModal() {
    document.getElementById('server-roles-modal').style.display = 'none';
}
function submitCreateServerRole() {
    const name = document.getElementById('role-name-input').value.trim();
    const color = document.getElementById('role-color-input').value;
    
    const perms = [];
    document.querySelectorAll('.perm-checkbox:checked').forEach(cb => {
        perms.push(cb.value);
    });
    
    if (!name) {
        alert('Please enter a role name.');
        return;
    }
    
    const showSeparately = document.getElementById('role-show-separately');
    const showSep = showSeparately ? showSeparately.checked : false;

    fetch('/api/servers/roles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_id: currentServerId, name, color, permissions: perms, show_separately: showSep })
    })
    .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
            return res.text().then(text => {
                throw new Error('Server returned non-JSON response (status ' + res.status + '): ' + text.substring(0, 200));
            });
        }
        return res.json();
    })
    .then(data => {
        if (data.success) {
            alert("Role created!");
            hideServerRolesModal();
            loadServers();
        } else {
            alert('Failed to create role: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(err => {
        console.error('Create role error:', err);
        alert(err.message && err.message.startsWith('Server returned') ? 'Server error. Please try again.' : 'Connection error. Please try again.');
    });
}

// --- PROFILE HOVERCARD PANEL ---
let hovercardTimeout = null;

function showHovercard(event, username) {
    if (hovercardTimeout) clearTimeout(hovercardTimeout);
    
    const hovercard = document.getElementById('profile-hovercard');
    
    fetch(`/api/profile/hovercard/${username}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) return;
            const p = data.profile;
            
            let socialsHtml = '';
            if (p.socials) {
                if (p.socials.soundcloud) socialsHtml += `<a href="https://soundcloud.com/${escapeHtml(p.socials.soundcloud)}" target="_blank" style="color:var(--text-muted); margin-right:8px;"><i class="fa-brands fa-soundcloud"></i></a>`;
                if (p.socials.youtube) socialsHtml += `<a href="https://youtube.com/${escapeHtml(p.socials.youtube)}" target="_blank" style="color:var(--text-muted); margin-right:8px;"><i class="fa-brands fa-youtube"></i></a>`;
                if (p.socials.twitter) socialsHtml += `<a href="https://twitter.com/${escapeHtml(p.socials.twitter)}" target="_blank" style="color:var(--text-muted); margin-right:8px;"><i class="fa-brands fa-twitter"></i></a>`;
                if (p.socials.spotify) socialsHtml += `<a href="https://open.spotify.com/search/${escapeHtml(p.socials.spotify)}" target="_blank" style="color:var(--text-muted); margin-right:8px;"><i class="fa-brands fa-spotify"></i></a>`;
            }
            
            hovercard.innerHTML = `
                <div class="hovercard-header">
                    <img src="${p.pfp || '/static/placeholder-art.png'}" class="hovercard-avatar" alt="Avatar">
                    <div>
                        <div class="hovercard-name">${escapeHtml(data.username)}</div>
                        <div class="hovercard-rank"><i class="fa-solid fa-fire"></i> ELO: ${p.elo || 0} (Rank #${p.global_rank || '--'})</div>
                    </div>
                </div>
                <div class="hovercard-bio">${escapeHtml(p.bio || "No bio yet.")}</div>
                <div class="hovercard-socials">${socialsHtml}</div>
            `;
            
            const rect = event.target.getBoundingClientRect();
            hovercard.style.top = `${rect.top + window.scrollY + 25}px`;
            hovercard.style.left = `${rect.left + window.scrollX}px`;
            hovercard.style.display = 'block';
            hovercard.style.opacity = '1';
        });
        
    event.target.addEventListener('mouseleave', () => {
        hovercardTimeout = setTimeout(() => {
            hovercard.style.opacity = '0';
            setTimeout(() => { hovercard.style.display = 'none'; }, 200);
        }, 800);
    });
}

// --- COMMUNITY POLL INTERVAL ---
let communityPollInterval = null;

let callPollMode = false;
function startCommunityPolling() {
    if (communityPollInterval) clearInterval(communityPollInterval);
    pollCommunity();
    // During an active call, signaling (offer/answer/ICE) must trickle fast,
    // so poll aggressively. Otherwise use a relaxed interval.
    communityPollInterval = setInterval(pollCommunity, callPollMode ? 1000 : 3000);
}
function setCallPollMode(active) {
    if (callPollMode === active) return;
    callPollMode = active;
    startCommunityPolling();
}

function pollCommunity() {
    fetch('/api/community/poll')
        .then(res => {
            if (!res.ok) throw new Error("Poll error");
            return res.json();
        })
        .then(data => {
            if (data.announcements && data.announcements.length > 0) {
                const ann = data.announcements[0];
                showCelebrationModal(ann);
            }
            
            handleWebRTCSignaling(data);
            
            // Auto reload messages if current tabs are active
            if (currentTab === 'community') {
                if (currentCommunityView === 'servers' && currentServerId && currentChannelId) {
                    loadServerMessages();
                } else if (currentCommunityView === 'dms' && currentDMPartner) {
                    loadDMMessages();
                }
            }
        })
        .catch(err => console.debug("Poll sync failed:", err));
}

let activeAnnouncement = null;
function showCelebrationModal(ann) {
    activeAnnouncement = ann;
    document.getElementById('celebrate-message').innerText = `You won the beat battle "${ann.battle_title}"! Your skills have been recognized by the community.`;
    document.getElementById('battle-winner-modal').style.display = 'flex';
}

function dismissAnnouncement() {
    if (!activeAnnouncement) return;
    fetch('/api/profile/announcement/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeAnnouncement.id })
    })
    .then(res => res.json())
    .then(() => {
        document.getElementById('battle-winner-modal').style.display = 'none';
        activeAnnouncement = null;
        loadUserProfile();
    });
}

// --- WEBRTC SIGNALING & VOICE/SCREEN CALLING ---
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let currentCallId = null;
let callRole = null;
let isCallMuted = false;
let isCallScreenSharing = false;

let rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
            urls: [
                'turn:openrelay.metered.ca:80',
                'turn:openrelay.metered.ca:443',
                'turn:openrelay.metered.ca:443?transport=tcp'
            ],
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ],
    iceCandidatePoolSize: 10
};

// Pull the best-available ICE configuration (including any user-provided TURN
// credentials) from the backend so calls connect reliably across networks.
function loadIceConfig() {
    return fetch('/api/webrtc/ice-config')
        .then(r => r.json())
        .then(cfg => {
            if (cfg && Array.isArray(cfg.iceServers) && cfg.iceServers.length) {
                rtcConfig = { iceServers: cfg.iceServers, iceCandidatePoolSize: 10 };
            }
        })
        .catch(() => {});
}
loadIceConfig();

function handleWebRTCSignaling(data) {
    if (data.incoming_call && !currentCallId) {
        document.getElementById('incoming-caller-name').innerText = `Incoming Call from ${data.incoming_call.caller}`;
        document.getElementById('incoming-call-type').innerText = data.incoming_call.type === 'screenshare' ? 'Screenshare & Voice Call' : 'Voice Call';
        document.getElementById('webrtc-incoming-modal').style.display = 'flex';
        currentCallId = data.incoming_call.id;
        callRole = 'receiver';
    }
    
    if (data.active_call && currentCallId === data.active_call.id) {
        const state = data.active_call.state;
        
        if (state === 'accepted' && callRole === 'caller' && !peerConnection.remoteDescription) {
            peerConnection.setRemoteDescription(new RTCSessionDescription({
                type: 'answer',
                sdp: data.active_call.sdp_answer
            })).then(() => {
                console.log("WebRTC answer processed.");
            });
        }
        
        const peerCandidates = callRole === 'caller' ? data.active_call.receiver_candidates : data.active_call.caller_candidates;
        
        if (peerCandidates && peerCandidates.length > 0) {
            peerCandidates.forEach(candStr => {
                try {
                    const candidate = new RTCIceCandidate(JSON.parse(candStr));
                    peerConnection.addIceCandidate(candidate);
                } catch(e) {}
            });
        }
    }
    
    if (!data.active_call && currentCallId) {
        cleanupCallSession();
    }
}

function startWebRTCCall(type = 'voice') {
    if (!currentDMPartner) return;
    
    currentCallId = null;
    callRole = 'caller';
    isCallMuted = false;
    isCallScreenSharing = (type === 'screenshare');
    
    document.getElementById('call-status-label').innerText = "Calling...";
    document.getElementById('call-partner-name').innerText = currentDMPartner;
    document.getElementById('screenshare-container').style.display = (type === 'screenshare') ? 'block' : 'none';
    document.getElementById('webrtc-call-overlay').style.display = 'block';
    
    let mediaPromise;
    if (type === 'screenshare') {
        mediaPromise = navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
            .then(screenStream => {
                return navigator.mediaDevices.getUserMedia({ audio: true })
                    .then(micStream => {
                        const tracks = [...screenStream.getVideoTracks(), ...micStream.getAudioTracks()];
                        return new MediaStream(tracks);
                    }).catch(() => screenStream);
            });
    } else {
        mediaPromise = navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    
    mediaPromise.then(stream => {
        localStream = stream;
        
        if (type === 'screenshare') {
            document.getElementById('local-video').srcObject = stream;
        }
        
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        stream.getTracks().forEach(track => {
            peerConnection.addTrack(track, stream);
        });
        
        peerConnection.ontrack = (event) => {
            if (!remoteStream) {
                remoteStream = event.streams[0];
                document.getElementById('remote-video').srcObject = remoteStream;
            }
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && currentCallId) {
                fetch('/api/webrtc/call/candidate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        call_id: currentCallId,
                        candidate: JSON.stringify(event.candidate)
                    })
                });
            }
        };
        
        peerConnection.createOffer().then(offer => {
            return peerConnection.setLocalDescription(offer).then(() => {
                fetch('/api/webrtc/call/initiate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        receiver: currentDMPartner,
                        type,
                        sdp: offer.sdp
                    })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        currentCallId = data.call_id;
                        document.getElementById('call-status-label').innerText = "Ringing...";
                    } else {
                        cleanupCallSession();
                    }
                });
            });
        });
    })
    .catch(err => {
        console.error("Call failed:", err);
        cleanupCallSession();
    });
}

function acceptIncomingCall() {
    document.getElementById('webrtc-incoming-modal').style.display = 'none';
    
    fetch('/api/community/poll')
        .then(res => res.json())
        .then(data => {
            const call = data.active_call;
            if (!call) {
                cleanupCallSession();
                return;
            }
            
            document.getElementById('call-status-label').innerText = "Connecting...";
            document.getElementById('call-partner-name').innerText = call.caller;
            document.getElementById('screenshare-container').style.display = (call.type === 'screenshare') ? 'block' : 'none';
            document.getElementById('webrtc-call-overlay').style.display = 'block';
            
            navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                .then(stream => {
                    localStream = stream;
                    
                    peerConnection = new RTCPeerConnection(rtcConfig);
                    
                    stream.getTracks().forEach(track => {
                        peerConnection.addTrack(track, stream);
                    });
                    
                    peerConnection.ontrack = (event) => {
                        if (!remoteStream) {
                            remoteStream = event.streams[0];
                            document.getElementById('remote-video').srcObject = remoteStream;
                        }
                    };
                    
                    peerConnection.onicecandidate = (event) => {
                        if (event.candidate) {
                            fetch('/api/webrtc/call/candidate', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    call_id: currentCallId,
                                    candidate: JSON.stringify(event.candidate)
                                })
                            });
                        }
                    };
                    
                    peerConnection.setRemoteDescription(new RTCSessionDescription({
                        type: 'offer',
                        sdp: call.sdp_offer
                    })).then(() => {
                        peerConnection.createAnswer().then(answer => {
                            peerConnection.setLocalDescription(answer).then(() => {
                                fetch('/api/webrtc/call/respond', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        call_id: currentCallId,
                                        action: 'accept',
                                        sdp: answer.sdp
                                    })
                                }).then(() => {
                                    document.getElementById('call-status-label').innerText = "Connected";
                                });
                            });
                        });
                    });
                })
                .catch(err => {
                    console.error("Accept calling failed:", err);
                    rejectIncomingCall();
                });
        });
}

function rejectIncomingCall() {
    document.getElementById('webrtc-incoming-modal').style.display = 'none';
    if (currentCallId) {
        fetch('/api/webrtc/call/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ call_id: currentCallId, action: 'reject' })
        }).then(() => {
            cleanupCallSession();
        });
    }
}

function toggleMuteCall() {
    if (!localStream) return;
    isCallMuted = !isCallMuted;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isCallMuted;
    });
    
    const icon = document.getElementById('btn-call-mute').querySelector('i');
    if (isCallMuted) {
        icon.className = "fa-solid fa-microphone-slash";
        document.getElementById('btn-call-mute').style.background = '#ef4444';
    } else {
        icon.className = "fa-solid fa-microphone";
        document.getElementById('btn-call-mute').style.background = '';
    }
}

function toggleScreenshareCall() {
    alert("Screenshare toggling supported at call start. End current call and choose screenshare calling option.");
}

function endCurrentCall() {
    if (currentCallId) {
        fetch('/api/webrtc/call/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ call_id: currentCallId, action: 'end' })
        }).then(() => {
            cleanupCallSession();
        });
    } else {
        cleanupCallSession();
    }
}

function cleanupCallSession() {
    document.getElementById('webrtc-call-overlay').style.display = 'none';
    document.getElementById('webrtc-incoming-modal').style.display = 'none';
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteStream = null;
    currentCallId = null;
    callRole = null;
}

// --- NEW HELPER FUNCTIONS FOR CHAT STABILITY, MODALS, AND COLLAPSIBLE SIDEBARS ---
function updateChatMessages(container, messages, isDM = false) {
    const existingItems = container.querySelectorAll('.chat-message-item');
    const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 25;
    
    if (existingItems.length === 0 || messages.length < existingItems.length) {
        container.innerHTML = '';
    }
    
    const startIndex = container.querySelectorAll('.chat-message-item').length;
    for (let i = startIndex; i < messages.length; i++) {
        const m = messages[i];
        const msg = document.createElement('div');
        msg.className = 'chat-message-item';
        
        const senderName = isDM ? m.sender : m.username;
        const senderHoverHtml = isDM 
            ? `<span class="message-username" style="font-weight:700;">${escapeHtml(senderName)}</span>`
            : `<span class="message-username user-hoverable" onmouseover="showHovercard(event, '${senderName}')" style="font-weight:700; cursor:pointer;">${escapeHtml(senderName)}</span>`;
            
        msg.innerHTML = `
            <img src="/static/placeholder-art.png" class="message-user-pfp" alt="PFP" style="width:32px; height:32px; border-radius:50%; object-fit:cover;">
            <div class="message-content-wrap">
                <div class="message-meta">
                    ${senderHoverHtml}
                    <span class="message-timestamp">${new Date(m.created_at).toLocaleTimeString()}</span>
                </div>
                <div class="message-text">${replaceInviteLinksWithPlaceholders(escapeHtml(m.content))}</div>
            </div>
        `;
        container.appendChild(msg);
    }
    
    if (startIndex < messages.length) {
        loadInvitePreviews();
        if (wasAtBottom || startIndex === 0) {
            container.scrollTop = container.scrollHeight;
        }
    }
}

function replaceInviteLinksWithPlaceholders(content) {
    const inviteRegex = /(?:wavely\.lol\/join\/|joinserver=)([a-zA-Z0-9_-]+)/gi;
    return content.replace(inviteRegex, (match, code) => {
        return `<a href="/community?joinserver=${code}" class="invite-link-text">${escapeHtml(match)}</a><div class="invite-preview-placeholder" data-code="${code}"></div>`;
    });
}

function loadInvitePreviews() {
    const placeholders = document.querySelectorAll('.invite-preview-placeholder:not(.loaded)');
    placeholders.forEach(placeholder => {
        placeholder.classList.add('loaded');
        const code = placeholder.getAttribute('data-code');
        
        fetch(`/api/servers/invite-info/${code}`)
            .then(res => {
                if (!res.ok) throw new Error("Invite not found");
                return res.json();
            })
            .then(server => {
                const isMember = allServers.some(s => s.id === server.id);
                const actionButton = isMember 
                    ? `<button class="btn btn-secondary btn-sm" disabled style="cursor:default; font-size: 11px; padding: 4px 8px;"><i class="fa-solid fa-check"></i> Joined</button>`
                    : `<button class="btn btn-primary btn-sm" onclick="joinServerFromInvite('${server.invite_code}', this)" style="font-size: 11px; padding: 4px 8px;">Join Server</button>`;
                
                placeholder.innerHTML = `
                    <div class="invite-card-container" style="display:flex; align-items:center; gap:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:6px; padding:12px; margin-top:8px; max-width:400px; box-shadow:0 4px 12px rgba(0,0,0,0.15);">
                        <img src="${server.icon_url || '/static/placeholder-art.png'}" style="width:40px; height:40px; border-radius:8px; object-fit:cover;">
                        <div style="flex-direction:column; display:flex; flex:1; min-width: 0;">
                            <div style="font-size:10px; font-weight:bold; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">You've been invited to join</div>
                            <div style="font-size:13px; font-weight:bold; color:#fff; margin-top:2px;" class="text-truncate">${escapeHtml(server.name)}</div>
                            <div style="display:flex; gap:10px; font-size:10px; color:var(--text-muted); margin-top:4px; align-items:center;">
                                <span style="display:flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; background:#10b981; border-radius:50%; display:inline-block;"></span> ${server.online_count} Online</span>
                                <span>${server.member_count} Members</span>
                            </div>
                        </div>
                        <div>
                            ${actionButton}
                        </div>
                    </div>
                `;
            })
            .catch(() => {
                placeholder.innerHTML = `
                    <div style="font-size:11px; color:var(--error); padding:4px 0;"><i class="fa-solid fa-triangle-exclamation"></i> Invalid or expired invite link.</div>
                `;
            });
    });
}

function joinServerFromInvite(code, button) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    fetch(`/api/servers/join/${code}`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                button.className = "btn btn-secondary btn-sm";
                button.innerHTML = '<i class="fa-solid fa-check"></i> Joined';
                loadServers();
            } else {
                button.disabled = false;
                button.innerHTML = 'Join Server';
                alert(data.error || "Failed to join server");
            }
        });
}

// Member Roles Modal
function openMemberRolesModal(targetUsername) {
    const server = allServers.find(s => s.id === currentServerId);
    if (!server) return;
    
    const targetMemberRoles = server.members[targetUsername] || [];
    document.getElementById('member-roles-modal-title').innerText = `Manage Roles for ${escapeHtml(targetUsername)}`;
    
    const container = document.getElementById('member-roles-checkboxes-container');
    container.innerHTML = '';
    
    server.roles.forEach(role => {
        const isChecked = targetMemberRoles.includes(role.id);
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '8px';
        label.style.padding = '6px';
        label.style.cursor = 'pointer';
        label.innerHTML = `
            <input type="checkbox" value="${role.id}" ${isChecked ? 'checked' : ''} onchange="toggleMemberRole('${targetUsername}', '${role.id}', this.checked)">
            <span style="color:${role.color}; font-weight:700;">${escapeHtml(role.name)}</span>
        `;
        container.appendChild(label);
    });
    
    document.getElementById('member-roles-modal').style.display = 'flex';
}

function closeMemberRolesModal() {
    document.getElementById('member-roles-modal').style.display = 'none';
}

function toggleMemberRole(targetUsername, roleId, shouldAdd) {
    fetch('/api/servers/roles/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            server_id: currentServerId,
            username: targetUsername,
            role_id: roleId,
            action: shouldAdd ? 'add' : 'remove'
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            loadServers();
        } else {
            alert(data.error || "Failed to update role");
        }
    });
}

// Category Settings Modal
let currentEditCategoryId = null;

function openCategorySettingsModal(event, categoryId) {
    event.stopPropagation();
    currentEditCategoryId = categoryId;
    
    const server = allServers.find(s => s.id === currentServerId);
    if (!server) return;
    
    const category = server.categories.find(c => c.id === categoryId);
    if (!category) return;
    
    document.getElementById('edit-category-name-input').value = category.name;
    
    const container = document.getElementById('category-roles-list');
    container.innerHTML = '';
    
    server.roles.forEach(role => {
        const checked = (category.allowed_roles || []).includes(role.id) ? 'checked' : '';
        const item = document.createElement('label');
        item.style.cursor = 'pointer';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '8px';
        item.innerHTML = `
            <input type="checkbox" value="${role.id}" ${checked} class="category-allowed-role-cb">
            <span style="color:${role.color}; font-weight:700;">${escapeHtml(role.name)}</span>
        `;
        container.appendChild(item);
    });
    
    document.getElementById('category-settings-modal').style.display = 'flex';
}

function closeCategorySettingsModal() {
    document.getElementById('category-settings-modal').style.display = 'none';
}

function submitCategorySettings() {
    const name = document.getElementById('edit-category-name-input').value.trim();
    if (!name) return;
    
    const checkedRoles = [];
    document.querySelectorAll('.category-allowed-role-cb:checked').forEach(cb => {
        checkedRoles.push(cb.value);
    });
    
    const syncChildren = document.getElementById('category-sync-children-input').checked;
    
    fetch('/api/servers/categories/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            server_id: currentServerId,
            category_id: currentEditCategoryId,
            name: name,
            allowed_roles: checkedRoles,
            sync_children: syncSummaryValue(syncChildren)
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            closeCategorySettingsModal();
            loadServers();
        } else {
            alert(data.error || "Failed to update category");
        }
    });
}

function syncSummaryValue(val) {
    return val;
}

// Category / Channel Reordering
function reorderCategory(event, categoryId, direction) {
    event.stopPropagation();
    const server = allServers.find(s => s.id === currentServerId);
    if (!server) return;
    
    const sortedCats = [...server.categories].sort((a, b) => (a.position || 0) - (b.position || 0));
    const idx = sortedCats.findIndex(c => c.id === categoryId);
    if (idx === -1) return;
    
    if (direction === 'up' && idx > 0) {
        const temp = sortedCats[idx].position;
        sortedCats[idx].position = sortedCats[idx - 1].position;
        sortedCats[idx - 1].position = temp;
    } else if (direction === 'down' && idx < sortedCats.length - 1) {
        const temp = sortedCats[idx].position;
        sortedCats[idx].position = sortedCats[idx + 1].position;
        sortedCats[idx + 1].position = temp;
    } else {
        return;
    }
    
    fetch('/api/servers/categories/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            server_id: currentServerId,
            items: sortedCats.map((c, i) => ({ id: c.id, position: c.position }))
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            loadServers();
        }
    });
}

function reorderChannel(event, channelId, direction) {
    event.stopPropagation();
    const server = allServers.find(s => s.id === currentServerId);
    if (!server) return;
    
    const channel = server.channels.find(c => c.id === channelId);
    if (!channel) return;
    
    const siblingChannels = server.channels.filter(c => c.category_id === channel.category_id);
    siblingChannels.sort((a, b) => (a.position || 0) - (b.position || 0));
    
    const idx = siblingChannels.findIndex(c => c.id === channelId);
    if (idx === -1) return;
    
    if (direction === 'up' && idx > 0) {
        const temp = siblingChannels[idx].position;
        siblingChannels[idx].position = siblingChannels[idx - 1].position;
        siblingChannels[idx - 1].position = temp;
    } else if (direction === 'down' && idx < siblingChannels.length - 1) {
        const temp = siblingChannels[idx].position;
        siblingChannels[idx].position = siblingChannels[idx + 1].position;
        siblingChannels[idx + 1].position = temp;
    } else {
        return;
    }
    
    fetch('/api/servers/channels/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            server_id: currentServerId,
            items: siblingChannels.map(c => ({ id: c.id, position: c.position }))
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            loadServers();
        }
    });
}

// Collapsible Sidebars for Mobile
function toggleLeftCommunitySidebar() {
    const grid = document.querySelector('.servers-portal-grid');
    const dock = document.querySelector('.servers-left-dock');
    const channels = document.querySelector('.server-channels-sidebar');
    const rightSidebar = document.querySelector('.server-members-sidebar');
    
    if (rightSidebar) rightSidebar.classList.remove('open');
    if (grid) grid.classList.remove('sidebar-right-open');
    
    dock.classList.toggle('open');
    channels.classList.toggle('open');
    grid.classList.toggle('sidebar-left-open');
}

// Sidebar roles assignment and toggle button fixes
function toggleRightCommunitySidebar() {
    const grid = document.querySelector('.servers-portal-grid');
    const dock = document.querySelector('.servers-left-dock');
    const channels = document.querySelector('.server-channels-sidebar');
    const rightSidebar = document.querySelector('.server-members-sidebar');
    
    if (dock) dock.classList.remove('open');
    if (channels) channels.classList.remove('open');
    if (grid) grid.classList.remove('sidebar-left-open');
    
    rightSidebar.classList.toggle('open');
    grid.classList.toggle('sidebar-right-open');
}

function closeAllCommunitySidebars() {
    const grid = document.querySelector('.servers-portal-grid');
    const dock = document.querySelector('.servers-left-dock');
    const channels = document.querySelector('.server-channels-sidebar');
    const rightSidebar = document.querySelector('.server-members-sidebar');
    
    if (dock) dock.classList.remove('open');
    if (channels) channels.classList.remove('open');
    if (rightSidebar) rightSidebar.classList.remove('open');
    if (grid) {
        grid.classList.remove('sidebar-left-open');
        grid.classList.remove('sidebar-right-open');
    }
}

function toggleDMCommunitySidebar() {
    const grid = document.querySelector('.dms-portal-grid');
    const sidebar = document.querySelector('.dms-left-sidebar');
    
    sidebar.classList.toggle('open');
    grid.classList.toggle('sidebar-open');
}

function closeDMCommunitySidebar() {
    const grid = document.querySelector('.dms-portal-grid');
    const sidebar = document.querySelector('.dms-left-sidebar');
    
    if (sidebar) sidebar.classList.remove('open');
    if (grid) grid.classList.remove('sidebar-open');
}

// Global click event to close sidebars when clicking on backdrop overlay
document.addEventListener('click', (e) => {
    const grid = document.querySelector('.servers-portal-grid');
    if (grid && (grid.classList.contains('sidebar-left-open') || grid.classList.contains('sidebar-right-open'))) {
        if (!e.target.closest('.servers-left-dock') && 
            !e.target.closest('.server-channels-sidebar') && 
            !e.target.closest('.server-members-sidebar') &&
            !e.target.closest('.mobile-channel-toggle-btn') &&
            !e.target.closest('.mobile-members-toggle-btn') &&
            !e.target.closest('.sidebar-manage-roles-btn')) {
            closeAllCommunitySidebars();
        }
    }
    
    const dmGrid = document.querySelector('.dms-portal-grid');
    if (dmGrid && dmGrid.classList.contains('sidebar-open')) {
        if (!e.target.closest('.dms-left-sidebar') && 
            !e.target.closest('.mobile-dm-toggle-btn')) {
            closeDMCommunitySidebar();
        }
    }
});



// =============================================================
// DISCORD-LIKE COMMUNITY (DC) SYSTEM — WAVELY COMMUNITY V2
// =============================================================

// DC State
let dcCurrentView = 'empty'; // 'empty' | 'server' | 'dms'
let dcSearchTimeout = null;

// Override: initCommunityPage
function initCommunityPage() {
    loadDCLayout();
    startCommunityPolling();
    // Check for deep-link params
    const sp = new URLSearchParams(window.location.search);
    const joinServer = sp.get('joinserver');
    if (joinServer) {
        fetch('/api/servers/join/' + joinServer, { method: 'POST' })
            .then(r => r.json())
            .then(d => { if (d.success) { loadServers(); alert('Joined: ' + d.name); } });
    }
}

function loadDCLayout() {
    loadUserProfile();
    loadServers();
    loadDCFriends();
    loadDMs();
    loadDashboardNotifications();
}

// Switch between DMs view and server view in the DC layout
function switchDCView(view) {
    dcCurrentView = view;
    const dmsBtn = document.getElementById('dc-dock-dms-btn');
    const dmsSidebar = document.getElementById('dc-dms-sidebar');
    const serverSidebar = document.getElementById('dc-server-sidebar');
    const serverChat = document.getElementById('dc-server-chat');
    const dmChat = document.getElementById('dc-dm-chat');
    const emptyPane = document.getElementById('dc-chat-empty');
    const membersBar = document.getElementById('dc-members-sidebar');
    const layout = document.getElementById('dc-layout');
    const membersMobileBtn = document.getElementById('dc-mobile-members-btn');
    const serverMembersToggle = document.getElementById('dc-server-members-toggle');

    if (view === 'dms') {
        if (dmsBtn) dmsBtn.classList.add('active');
        if (dmsSidebar) dmsSidebar.style.display = 'flex';
        if (serverSidebar) serverSidebar.style.display = 'none';
        if (serverChat) serverChat.style.display = 'none';
        if (membersBar) membersBar.style.display = 'none';
        if (layout) layout.classList.remove('has-members');
        if (membersMobileBtn) membersMobileBtn.style.display = 'none';
        if (serverMembersToggle) serverMembersToggle.style.display = 'none';
        // Only show DM chat if partner selected
        if (currentDMPartner) {
            if (dmChat) dmChat.style.display = 'flex';
            if (emptyPane) emptyPane.style.display = 'none';
        } else {
            if (dmChat) dmChat.style.display = 'none';
            if (emptyPane) emptyPane.style.display = 'flex';
        }
        document.getElementById('dc-mobile-title').innerText = 'Direct Messages';
        loadDMs();
        loadDCFriends();
    } else if (view === 'server') {
        if (dmsBtn) dmsBtn.classList.remove('active');
        if (dmsSidebar) dmsSidebar.style.display = 'none';
        if (serverSidebar) serverSidebar.style.display = 'flex';
        if (dmChat) dmChat.style.display = 'none';
        if (currentServerId && currentChannelId) {
            if (serverChat) serverChat.style.display = 'flex';
            if (emptyPane) emptyPane.style.display = 'none';
        } else {
            if (serverChat) serverChat.style.display = 'none';
            if (emptyPane) emptyPane.style.display = 'flex';
        }
        if (currentServerId) {
            if (membersBar) { membersBar.style.display = 'flex'; }
            if (layout) layout.classList.add('has-members');
            if (membersMobileBtn) membersMobileBtn.style.display = 'flex';
            if (serverMembersToggle) serverMembersToggle.style.display = 'flex';
        }
    } else {
        // empty
        if (dmsBtn) dmsBtn.classList.remove('active');
        if (dmsSidebar) dmsSidebar.style.display = 'none';
        if (serverSidebar) serverSidebar.style.display = 'flex';
        if (serverChat) serverChat.style.display = 'none';
        if (dmChat) dmChat.style.display = 'none';
        if (emptyPane) emptyPane.style.display = 'flex';
        if (membersBar) membersBar.style.display = 'none';
        if (layout) layout.classList.remove('has-members');
    }
}

// Override: loadServers to populate DC dock icons
function loadServers() {
    fetch('/api/servers')
        .then(res => res.json())
        .then(data => {
            allServers = data.servers || [];
            const dockList = document.getElementById('dc-server-icons-list');
            if (dockList) {
                dockList.innerHTML = '';
                allServers.forEach(s => {
                    const btn = document.createElement('button');
                    btn.className = 'dc-dock-item' + (currentServerId === s.id ? ' active' : '');
                    btn.title = s.name;
                    btn.onclick = () => selectServer(s.id);
                    btn.innerHTML = s.icon_url ? `<img src="${s.icon_url}" alt="${escapeHtml(s.name)}">` : `<span style="font-size:13px;font-weight:800;">${escapeHtml(s.name.charAt(0))}</span>`;
                    dockList.appendChild(btn);
                });
            }
            // Legacy dock container (dashboard)
            const legacyDock = document.getElementById('servers-icons-container');
            if (legacyDock) {
                legacyDock.innerHTML = '';
                allServers.forEach(s => {
                    const icon = document.createElement('div');
                    icon.className = 'btn-server-dock' + (currentServerId === s.id ? ' active' : '');
                    icon.title = s.name;
                    icon.onclick = () => selectServer(s.id);
                    icon.innerHTML = `<img src="${s.icon_url || '/static/placeholder-art.png'}" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;">`;
                    legacyDock.appendChild(icon);
                });
            }
            if (currentServerId) {
                const srv = allServers.find(s => s.id === currentServerId);
                if (srv) selectServer(srv.id);
            }
        });
}

// Override: selectServer to switch to server view and show members
function selectServer(serverId) {
    currentServerId = serverId;
    const server = allServers.find(s => s.id === serverId);
    if (!server) return;

    // Update dock active state
    document.querySelectorAll('#dc-server-icons-list .dc-dock-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.btn-server-dock').forEach(el => el.classList.remove('active'));

    switchDCView('server');

    const nameEl = document.getElementById('selected-server-name');
    if (nameEl) nameEl.innerText = server.name;

    const inviteEl = document.getElementById('selected-server-invite');
    if (inviteEl) {
        inviteEl.innerText = `Invite: ${window.location.origin}/#dashboard?joinserver=${server.invite_code}`;
        inviteEl.style.display = 'block';
    }

    const isOwner = currentUserProfile && server.owner === currentUserProfile.username;
    const myRoles = currentUserProfile ? ((server.members || {})[currentUserProfile.username] || []) : [];
    const isMod = isOwner || myRoles.some(r => (server.roles || []).find(ro => ro.id === r && ro.permissions && ro.permissions.includes('manage_channels')));

    const adminControls = document.getElementById('server-admin-controls');
    const noSelection = document.getElementById('dc-server-no-selection');
    if (adminControls) adminControls.style.display = isMod ? 'flex' : 'none';
    if (noSelection) noSelection.style.display = 'none';

    renderServerChannels(server);
    renderServerMembers(server);
    document.getElementById('dc-mobile-title').innerText = server.name;

    if (server.channels.length > 0) {
        const firstChan = server.channels[0];
        selectChannel(firstChan.id);
    }
    dcCloseMobileOverlays();
}

// Override: selectDMPartner for DC layout
function selectDMPartner(username) {
    currentDMPartner = username;
    switchDCView('dms');

    const nameEl = document.getElementById('dm-recipient-name');
    if (nameEl) nameEl.innerText = username;

    const callPanel = document.getElementById('dm-call-actions-panel');
    if (callPanel) callPanel.style.display = 'flex';

    const dmChat = document.getElementById('dc-dm-chat');
    const emptyPane = document.getElementById('dc-chat-empty');
    if (dmChat) dmChat.style.display = 'flex';
    if (emptyPane) emptyPane.style.display = 'none';

    fetch('/api/profile/hovercard/' + username)
        .then(r => r.json())
        .then(d => {
            const pfpEl = document.getElementById('dm-recipient-pfp');
            if (pfpEl) pfpEl.src = (d.profile && d.profile.pfp) ? d.profile.pfp : '/static/placeholder-art.png';
        })
        .catch(() => {});

    document.getElementById('dc-mobile-title').innerText = username;
    loadDMMessages();
    dcCloseMobileOverlays();

    // Highlight active DM in list
    document.querySelectorAll('.dc-dm-item').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-username') === username);
    });
}

// Override: loadDMs
function loadDMs() {
    fetch('/api/dms')
        .then(res => res.json())
        .then(data => {
            const container = document.getElementById('dms-list-container');
            if (!container) return;
            container.innerHTML = '';
            if (data.dms.length === 0) {
                container.innerHTML = '<div class="dc-sidebar-empty">No conversations yet.</div>';
                return;
            }
            data.dms.forEach(d => {
                const item = document.createElement('div');
                item.className = 'dc-dm-item' + (currentDMPartner === d ? ' active' : '');
                item.setAttribute('data-username', d);
                item.onclick = () => selectDMPartner(d);
                item.innerHTML = `
                    <img src="/static/placeholder-art.png" class="dc-dm-avatar-sm" alt="">
                    <span class="dc-friend-name">${escapeHtml(d)}</span>
                `;
                container.appendChild(item);
            });
        });
}

// ==========================================
// FRIENDS SYSTEM
// ==========================================

function loadDCFriends() {
    fetch('/api/friends')
        .then(r => r.json())
        .then(data => {
            // Friend requests
            const reqGroup = document.getElementById('dc-friend-requests-group');
            const reqList = document.getElementById('dc-friend-requests-list');
            const reqCount = document.getElementById('dc-friend-req-count');
            if (reqList) {
                reqList.innerHTML = '';
                (data.incoming_requests || []).forEach(requester => {
                    const item = document.createElement('div');
                    item.className = 'dc-req-item';
                    item.innerHTML = `
                        <img src="/static/placeholder-art.png" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">
                        <span class="dc-req-username">${escapeHtml(requester)} wants to be friends</span>
                        <div class="dc-req-actions">
                            <button class="dc-req-accept" onclick="respondFriendRequest('${escapeHtml(requester)}','accept')">
                                <i class="fa-solid fa-check"></i>
                            </button>
                            <button class="dc-req-reject" onclick="respondFriendRequest('${escapeHtml(requester)}','reject')">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    `;
                    reqList.appendChild(item);
                });
            }
            if (reqGroup) {
                reqGroup.style.display = (data.incoming_requests || []).length > 0 ? 'block' : 'none';
            }
            if (reqCount) reqCount.innerText = (data.incoming_requests || []).length;

            // Friends list
            const friendsList = document.getElementById('dc-friends-list');
            const friendsCount = document.getElementById('dc-friends-count');
            if (friendsList) {
                friendsList.innerHTML = '';
                if ((data.friends || []).length === 0) {
                    friendsList.innerHTML = '<div class="dc-sidebar-empty">No friends yet.<br><small>Search above to add one!</small></div>';
                } else {
                    (data.friends || []).forEach(friend => {
                        const item = document.createElement('div');
                        item.className = 'dc-friend-item';
                        item.innerHTML = `
                            <img src="/static/placeholder-art.png" class="dc-friend-avatar" alt="">
                            <div class="dc-friend-info">
                                <div class="dc-friend-name">${escapeHtml(friend)}</div>
                                <div class="dc-friend-status">Click to message</div>
                            </div>
                            <div class="dc-friend-actions">
                                <button class="dc-friend-action-btn" onclick="event.stopPropagation();startDCDM('${escapeHtml(friend)}')" title="Send Message">
                                    <i class="fa-solid fa-message"></i>
                                </button>
                                <button class="dc-friend-action-btn danger" onclick="event.stopPropagation();removeFriend('${escapeHtml(friend)}')" title="Remove Friend">
                                    <i class="fa-solid fa-user-minus"></i>
                                </button>
                            </div>
                        `;
                        item.onclick = () => startDCDM(friend);
                        friendsList.appendChild(item);
                    });
                }
            }
            if (friendsCount) friendsCount.innerText = (data.friends || []).length;
        })
        .catch(() => {});
}

function dcSearchUsers(q) {
    const dropdown = document.getElementById('dc-search-results-dropdown');
    if (!dropdown) return;
    clearTimeout(dcSearchTimeout);
    if (!q || q.trim().length < 1) {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
        return;
    }
    dcSearchTimeout = setTimeout(() => {
        fetch('/api/users/search?q=' + encodeURIComponent(q.trim()))
            .then(r => r.json())
            .then(data => {
                dropdown.innerHTML = '';
                if (!data.users || data.users.length === 0) {
                    dropdown.innerHTML = '<div style="padding:12px 14px;font-size:12px;color:var(--text-dim);">No users found</div>';
                    dropdown.style.display = 'block';
                    return;
                }
                data.users.forEach(u => {
                    const item = document.createElement('div');
                    item.className = 'dc-search-result-item';
                    let actionBtn = '';
                    if (u.status === 'friend') {
                        actionBtn = `<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();startDCDM('${escapeHtml(u.username)}')"><i class="fa-solid fa-message"></i> DM</button>`;
                    } else if (u.status === 'pending_out') {
                        actionBtn = `<button class="btn btn-ghost btn-xs" disabled style="opacity:0.5;"><i class="fa-solid fa-clock"></i> Pending</button>`;
                    } else if (u.status === 'pending_in') {
                        actionBtn = `<button class="btn btn-primary btn-xs" onclick="event.stopPropagation();respondFriendRequest('${escapeHtml(u.username)}','accept')"><i class="fa-solid fa-check"></i> Accept</button>`;
                    } else {
                        actionBtn = `<button class="btn btn-primary btn-xs" onclick="event.stopPropagation();sendFriendRequest('${escapeHtml(u.username)}',this)"><i class="fa-solid fa-user-plus"></i> Add</button>`;
                    }
                    item.innerHTML = `
                        <img src="/static/placeholder-art.png" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">
                        <span class="dc-search-result-username">${escapeHtml(u.username)}</span>
                        <div class="dc-search-result-action">${actionBtn}</div>
                    `;
                    dropdown.appendChild(item);
                });
                dropdown.style.display = 'block';
            })
            .catch(() => { dropdown.style.display = 'none'; });
    }, 300);
}

function sendFriendRequest(username, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
    fetch('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
    })
    .then(r => r.json())
    .then(d => {
        if (d.success) {
            if (d.auto_accepted) {
                showToast('You are now friends with ' + username + '!', 'success');
                loadDCFriends();
            } else {
                showToast('Friend request sent to ' + username, 'success');
            }
            if (btn) { btn.innerHTML = '<i class="fa-solid fa-check"></i> Sent'; btn.disabled = true; }
            // Close dropdown
            const dropdown = document.getElementById('dc-search-results-dropdown');
            if (dropdown) { dropdown.style.display = 'none'; }
            const input = document.getElementById('dc-user-search-input');
            if (input) input.value = '';
        } else {
            showToast(d.error || 'Failed to send request', 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Add'; }
        }
    })
    .catch(() => {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Add'; }
    });
}

function respondFriendRequest(username, action) {
    fetch('/api/friends/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, action })
    })
    .then(r => r.json())
    .then(d => {
        if (d.success) {
            if (action === 'accept') showToast('You are now friends with ' + username + '!', 'success');
            loadDCFriends();
        }
    });
}

function removeFriend(username) {
    if (!confirm('Remove ' + username + ' as a friend?')) return;
    fetch('/api/friends/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
    })
    .then(r => r.json())
    .then(() => loadDCFriends());
}

function startDCDM(username) {
    switchDCView('dms');
    selectDMPartner(username);
}

// Override: startDMWith (used from elsewhere)
function startDMWith(username) {
    switchTab('community');
    setTimeout(() => {
        switchDCView('dms');
        selectDMPartner(username);
    }, 800);
}

// ==========================================
// DASHBOARD NOTIFICATIONS
// ==========================================

function loadDashboardNotifications() {
    fetch('/api/notifications')
        .then(r => r.json())
        .then(data => {
            const notifs = data.notifications || [];
            const unread = notifs.filter(n => !n.read).length;

            // Update bubble
            const bubble = document.getElementById('dash-notif-count');
            if (bubble) {
                bubble.innerText = unread;
                bubble.style.display = unread > 0 ? 'inline' : 'none';
            }

            // Render list
            const container = document.getElementById('dash-notifications-list');
            if (!container) return;
            container.innerHTML = '';
            if (notifs.length === 0) {
                container.innerHTML = '<div class="dc-empty-state" style="padding:40px;"><i class="fa-solid fa-bell-slash"></i><p>No notifications yet.</p></div>';
                return;
            }
            notifs.forEach(n => {
                const item = document.createElement('div');
                item.className = 'notif-item' + (!n.read ? ' unread' : '');
                const time = new Date(n.timestamp).toLocaleString();
                item.innerHTML = `
                    <div class="notif-icon"><i class="fa-solid fa-message"></i></div>
                    <div class="notif-body">
                        <div class="notif-from"><strong>${escapeHtml(n.from)}</strong> sent you a message</div>
                        <div class="notif-preview">"${escapeHtml(n.preview)}"</div>
                        <div class="notif-time">${time}</div>
                    </div>
                    <div class="notif-action">
                        <button class="btn btn-primary btn-xs" onclick="jumpToMessage('${escapeHtml(n.from)}', '${escapeHtml(n.id)}')">
                            <i class="fa-solid fa-arrow-right"></i> Jump
                        </button>
                    </div>
                `;
                item.onclick = (e) => { if (!e.target.closest('.btn')) jumpToMessage(n.from, n.id); };
                container.appendChild(item);
            });
        })
        .catch(() => {});
}

function jumpToMessage(fromUser, notifId) {
    // Mark as read
    fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: notifId })
    }).then(() => loadDashboardNotifications());
    // Navigate to community DMs
    switchTab('community');
    setTimeout(() => {
        switchDCView('dms');
        selectDMPartner(fromUser);
    }, 800);
}

function markAllNotificationsRead() {
    fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'all' })
    }).then(() => loadDashboardNotifications());
}

// ==========================================
// FIXED WEBRTC — Audio, Screen Share, Candidates
// ==========================================

// Override all WebRTC state vars
let pendingIceCandidates = [];
let callerCandidatesProcessed = 0;
let receiverCandidatesProcessed = 0;
let outgoingIceCandidates = [];

// Override: handleWebRTCSignaling — fixed candidate deduplication + friend request notifications
function handleWebRTCSignaling(data) {
    // Friend requests notification badge
    if (data.friend_requests && data.friend_requests.length > 0) {
        const reqCount = document.getElementById('dc-friend-req-count');
        const reqGroup = document.getElementById('dc-friend-requests-group');
        if (reqCount) reqCount.innerText = data.friend_requests.length;
        if (reqGroup) reqGroup.style.display = 'block';
    }

    // DM notification count on dashboard
    if (data.unread_dm_count !== undefined) {
        const bubble = document.getElementById('dash-notif-count');
        if (bubble) {
            bubble.innerText = data.unread_dm_count;
            bubble.style.display = data.unread_dm_count > 0 ? 'inline' : 'none';
        }
    }

    // Incoming call
    if (data.incoming_call && !currentCallId) {
        const callerName = document.getElementById('incoming-caller-name');
        const callType = document.getElementById('incoming-call-type');
        if (callerName) callerName.innerText = `Incoming Call from ${data.incoming_call.caller}`;
        if (callType) callType.innerText = data.incoming_call.type === 'screenshare' ? 'Screen Share + Voice' : 'Voice Call';
        const incomingModal = document.getElementById('webrtc-incoming-modal');
        if (incomingModal) incomingModal.style.display = 'flex';
        currentCallId = data.incoming_call.id;
        callRole = 'receiver';
        setCallPollMode(true);
    }

    if (data.active_call && currentCallId === data.active_call.id) {
        const state = data.active_call.state;

        if (state === 'accepted' && callRole === 'caller' && peerConnection && !peerConnection.remoteDescription) {
            peerConnection.setRemoteDescription(new RTCSessionDescription({
                type: 'answer',
                sdp: data.active_call.sdp_answer
            })).then(() => {
                flushPendingCandidates();
                const callStatus = document.getElementById('call-status-label');
                if (callStatus) callStatus.innerHTML = '<i class="fa-solid fa-phone-volume dc-pulse"></i> Connected';
            }).catch(e => console.warn('setRemoteDescription error:', e));
        }

        // Process only NEW candidates (deduplicated by index)
        const peerCandidates = callRole === 'caller'
            ? (data.active_call.receiver_candidates || [])
            : (data.active_call.caller_candidates || []);

        const alreadyProcessed = callRole === 'caller' ? receiverCandidatesProcessed : callerCandidatesProcessed;
        const newCandidates = peerCandidates.slice(alreadyProcessed);

        newCandidates.forEach(candStr => {
            try {
                const candidate = new RTCIceCandidate(JSON.parse(candStr));
                if (peerConnection && peerConnection.remoteDescription) {
                    peerConnection.addIceCandidate(candidate).catch(e => console.warn('addICE:', e));
                } else {
                    pendingIceCandidates.push(candidate);
                }
            } catch(e) {}
        });

        if (callRole === 'caller') receiverCandidatesProcessed = peerCandidates.length;
        else callerCandidatesProcessed = peerCandidates.length;
    }

    if (!data.active_call && currentCallId) {
        cleanupCallSession();
    }
}

function flushPendingCandidates() {
    if (!peerConnection) return;
    const toAdd = [...pendingIceCandidates];
    pendingIceCandidates = [];
    toAdd.forEach(c => peerConnection.addIceCandidate(c).catch(e => console.warn('flush ICE:', e)));
}

// Send a single local ICE candidate to the signaling server.
function sendIceCandidate(candidate) {
    if (!currentCallId) return;
    fetch('/api/webrtc/call/candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            call_id: currentCallId,
            candidate: JSON.stringify(candidate)
        })
    }).catch(e => console.warn('sendIceCandidate:', e));
}

// Flush any local ICE candidates that were gathered before the call ID existed.
function flushOutgoingCandidates() {
    if (!currentCallId || !outgoingIceCandidates.length) return;
    const toSend = [...outgoingIceCandidates];
    outgoingIceCandidates = [];
    toSend.forEach(c => sendIceCandidate(c));
}

function setupPeerConnectionHandlers(callType) {
    if (!peerConnection) return;

    peerConnection.ontrack = (event) => {
        const track = event.track;
        const streams = event.streams;
        const stream = streams && streams[0] ? streams[0] : new MediaStream([track]);

        if (track.kind === 'video') {
            const remoteVideo = document.getElementById('remote-video');
            if (remoteVideo) {
                remoteVideo.srcObject = stream;
                remoteVideo.play().catch(() => {});
            }
            // Show video area
            const videoArea = document.getElementById('dc-call-video-area');
            if (videoArea) videoArea.style.display = 'block';
            remoteStream = stream;
        } else if (track.kind === 'audio') {
            const remoteAudio = document.getElementById('remote-audio');
            if (remoteAudio) {
                // Create or update stream for audio
                if (!remoteStream) remoteStream = new MediaStream();
                // Remove old audio tracks
                remoteStream.getAudioTracks().forEach(t => remoteStream.removeTrack(t));
                remoteStream.addTrack(track);
                remoteAudio.srcObject = remoteStream;
                remoteAudio.play().catch(e => {
                    console.warn('Audio autoplay blocked:', e);
                    // Try on user interaction
                    document.addEventListener('click', () => remoteAudio.play().catch(() => {}), { once: true });
                });
            }
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (!event.candidate) return;
        if (currentCallId) {
            sendIceCandidate(event.candidate);
        } else {
            // Call ID not assigned yet (caller is still awaiting /initiate).
            // Buffer candidates so the fast host candidates aren't lost.
            outgoingIceCandidates.push(event.candidate);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection ? peerConnection.connectionState : 'closed';
        const statusEl = document.getElementById('call-status-label');
        if (statusEl) {
            if (state === 'connected') statusEl.innerHTML = '<i class="fa-solid fa-phone-volume dc-pulse"></i> Connected';
            else if (state === 'connecting') statusEl.innerHTML = '<i class="fa-solid fa-spinner dc-pulse"></i> Connecting...';
            else if (state === 'failed') statusEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Connection Failed';
        }
    };
}

// Override: startWebRTCCall — fixed audio + video handling
function startWebRTCCall(type) {
    if (!currentDMPartner) return;

    currentCallId = null;
    callRole = 'caller';
    isCallMuted = false;
    isCallScreenSharing = (type === 'screenshare');
    pendingIceCandidates = [];
    outgoingIceCandidates = [];
    callerCandidatesProcessed = 0;
    receiverCandidatesProcessed = 0;
    setCallPollMode(true);

    const statusEl = document.getElementById('call-status-label');
    const partnerEl = document.getElementById('call-partner-name');
    const overlayEl = document.getElementById('webrtc-call-overlay');
    const videoArea = document.getElementById('dc-call-video-area');
    const muteBtn = document.getElementById('btn-call-mute');

    if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-phone-volume dc-pulse"></i> Calling...';
    if (partnerEl) partnerEl.innerText = currentDMPartner;
    if (overlayEl) overlayEl.style.display = 'block';
    if (videoArea) videoArea.style.display = 'none';
    if (muteBtn) muteBtn.className = 'dc-ctrl-btn';

    // Fetch partner avatar
    fetch('/api/profile/hovercard/' + currentDMPartner)
        .then(r => r.json())
        .then(d => {
            const pfpEl = document.getElementById('call-partner-pfp');
            if (pfpEl && d.profile && d.profile.pfp) pfpEl.src = d.profile.pfp;
        }).catch(() => {});

    let mediaPromise;
    if (type === 'screenshare') {
        mediaPromise = navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: true })
            .then(screenStream => {
                return navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                    .then(micStream => {
                        const tracks = [...screenStream.getVideoTracks(), ...micStream.getAudioTracks()];
                        localStream = new MediaStream(tracks);
                        // Show local screen preview
                        const localVideo = document.getElementById('local-video');
                        if (localVideo) {
                            localVideo.srcObject = screenStream;
                        }
                        if (videoArea) videoArea.style.display = 'block';
                        return localStream;
                    }).catch(() => {
                        localStream = screenStream;
                        const localVideo = document.getElementById('local-video');
                        if (localVideo) localVideo.srcObject = screenStream;
                        if (videoArea) videoArea.style.display = 'block';
                        return localStream;
                    });
            });
    } else {
        mediaPromise = navigator.mediaDevices.getUserMedia({ audio: true, video: false })
            .then(stream => { localStream = stream; return stream; });
    }

    mediaPromise
    .then(stream => loadIceConfig().then(() => stream))
    .then(stream => {
        peerConnection = new RTCPeerConnection(rtcConfig);
        setupPeerConnectionHandlers(type);

        stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));

        return peerConnection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    })
    .then(offer => peerConnection.setLocalDescription(offer).then(() => offer))
    .then(offer => {
        return fetch('/api/webrtc/call/initiate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ receiver: currentDMPartner, type, sdp: offer.sdp })
        }).then(r => r.json());
    })
    .then(data => {
        if (data.success) {
            currentCallId = data.call_id;
            flushOutgoingCandidates();
            if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-phone-volume dc-pulse"></i> Ringing...';
        } else {
            cleanupCallSession();
        }
    })
    .catch(err => {
        console.error('Call error:', err);
        cleanupCallSession();
    });
}

// Override: acceptIncomingCall — fixed audio handling
function acceptIncomingCall() {
    const incomingModal = document.getElementById('webrtc-incoming-modal');
    if (incomingModal) incomingModal.style.display = 'none';

    pendingIceCandidates = [];
    outgoingIceCandidates = [];
    callerCandidatesProcessed = 0;
    receiverCandidatesProcessed = 0;

    fetch('/api/community/poll')
        .then(r => r.json())
        .then(data => {
            const call = data.active_call;
            if (!call) { cleanupCallSession(); return; }

            const overlayEl = document.getElementById('webrtc-call-overlay');
            const statusEl = document.getElementById('call-status-label');
            const partnerEl = document.getElementById('call-partner-name');
            const videoArea = document.getElementById('dc-call-video-area');

            if (overlayEl) overlayEl.style.display = 'block';
            if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-spinner dc-pulse"></i> Connecting...';
            if (partnerEl) partnerEl.innerText = call.caller;

            // Show screen if caller is sharing
            if (call.type === 'screenshare' && videoArea) videoArea.style.display = 'block';

            navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                .then(stream => { localStream = stream; return loadIceConfig().then(() => stream); })
                .then(stream => {
                    peerConnection = new RTCPeerConnection(rtcConfig);
                    setupPeerConnectionHandlers(call.type);

                    stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));

                    return peerConnection.setRemoteDescription(new RTCSessionDescription({
                        type: 'offer',
                        sdp: call.sdp_offer
                    }));
                })
                .then(() => {
                    flushPendingCandidates();
                    return peerConnection.createAnswer();
                })
                .then(answer => peerConnection.setLocalDescription(answer).then(() => answer))
                .then(answer => {
                    return fetch('/api/webrtc/call/respond', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ call_id: currentCallId, action: 'accept', sdp: answer.sdp })
                    });
                })
                .then(() => {
                    if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-phone-volume dc-pulse"></i> Connected';
                })
                .catch(err => {
                    console.error('Accept call error:', err);
                    rejectIncomingCall();
                });
        });
}

// Override: toggleMuteCall — fixed for new button class
function toggleMuteCall() {
    if (!localStream) return;
    isCallMuted = !isCallMuted;
    localStream.getAudioTracks().forEach(track => { track.enabled = !isCallMuted; });
    const btn = document.getElementById('btn-call-mute');
    if (btn) {
        const icon = btn.querySelector('i');
        if (isCallMuted) {
            if (icon) icon.className = 'fa-solid fa-microphone-slash';
            btn.classList.add('muted');
            btn.title = 'Unmute';
        } else {
            if (icon) icon.className = 'fa-solid fa-microphone';
            btn.classList.remove('muted');
            btn.title = 'Mute';
        }
    }
}

// Override: toggleScreenshareCall — actually works now
async function toggleScreenshareCall() {
    if (!peerConnection) return;
    const btn = document.getElementById('btn-screenshare-toggle');
    const localVideo = document.getElementById('local-video');
    const videoArea = document.getElementById('dc-call-video-area');

    if (isCallScreenSharing) {
        // Stop screen share
        const senders = peerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
            videoSender.track.stop();
            try { await videoSender.replaceTrack(null); } catch(e) {}
        }
        if (localStream) {
            localStream.getVideoTracks().forEach(t => t.stop());
        }
        if (localVideo) localVideo.srcObject = null;
        if (videoArea) videoArea.style.display = 'none';
        isCallScreenSharing = false;
        if (btn) { btn.classList.remove('active'); btn.title = 'Screen Share'; }
    } else {
        // Start screen share
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' }, audio: false
            });
            const screenTrack = screenStream.getVideoTracks()[0];

            const senders = peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');

            if (videoSender) {
                await videoSender.replaceTrack(screenTrack);
            } else {
                peerConnection.addTrack(screenTrack, localStream || screenStream);
            }

            if (localVideo) {
                localVideo.srcObject = new MediaStream([screenTrack]);
            }
            if (videoArea) videoArea.style.display = 'block';
            isCallScreenSharing = true;
            if (btn) { btn.classList.add('active'); btn.title = 'Stop Sharing'; }

            screenTrack.onended = () => {
                isCallScreenSharing = false;
                if (btn) btn.classList.remove('active');
                if (localVideo) localVideo.srcObject = null;
            };
        } catch(e) {
            console.error('Screen share failed:', e);
        }
    }
}

// Override: cleanupCallSession — properly handles new overlay + audio
function cleanupCallSession() {
    const overlayEl = document.getElementById('webrtc-call-overlay');
    const incomingModal = document.getElementById('webrtc-incoming-modal');
    const videoArea = document.getElementById('dc-call-video-area');
    const remoteAudio = document.getElementById('remote-audio');
    const remoteVideo = document.getElementById('remote-video');
    const localVideo = document.getElementById('local-video');

    if (overlayEl) overlayEl.style.display = 'none';
    if (incomingModal) incomingModal.style.display = 'none';
    if (videoArea) videoArea.style.display = 'none';

    if (remoteAudio) { remoteAudio.srcObject = null; remoteAudio.pause(); }
    if (remoteVideo) remoteVideo.srcObject = null;
    if (localVideo) localVideo.srcObject = null;

    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (peerConnection) { peerConnection.close(); peerConnection = null; }

    remoteStream = null;
    currentCallId = null;
    callRole = null;
    isCallMuted = false;
    isCallScreenSharing = false;
    pendingIceCandidates = [];
    outgoingIceCandidates = [];
    callerCandidatesProcessed = 0;
    receiverCandidatesProcessed = 0;
    setCallPollMode(false);
}

// Override: pollCommunity — add notifications
function pollCommunity() {
    fetch('/api/community/poll')
        .then(res => {
            if (!res.ok) throw new Error('Poll error');
            return res.json();
        })
        .then(data => {
            if (data.announcements && data.announcements.length > 0) {
                showCelebrationModal(data.announcements[0]);
            }
            handleWebRTCSignaling(data);
            processWavelyNotifications(data);
            if (currentTab === 'community') {
                if (dcCurrentView === 'server' && currentServerId && currentChannelId) {
                    loadServerMessages();
                } else if (dcCurrentView === 'dms' && currentDMPartner) {
                    loadDMMessages();
                }
            }
            // Update notification count on dashboard
            if (data.unread_dm_count !== undefined) {
                const bubble = document.getElementById('dash-notif-count');
                if (bubble) {
                    bubble.innerText = data.unread_dm_count;
                    bubble.style.display = data.unread_dm_count > 0 ? 'inline' : 'none';
                }
            }
        })
        .catch(err => console.debug('Poll sync failed:', err));
}

// Override: switchDashTab to also load notifications
const _originalSwitchDashTab = typeof switchDashTab === 'function' ? switchDashTab : null;
function switchDashTab(tabId) {
    currentDashTab = tabId;
    document.querySelectorAll('.dash-menu-item').forEach(el => el.classList.remove('active'));
    const menuBtn = document.getElementById('menu-btn-' + tabId);
    if (menuBtn) menuBtn.classList.add('active');
    document.querySelectorAll('.dash-subtab-pane').forEach(p => p.classList.remove('active'));
    const pane = document.getElementById('dash-subtab-' + tabId);
    if (pane) pane.classList.add('active');
    // Load data for specific tabs
    if (tabId === 'battles') { loadBeatBattles(); loadLeaderboard(); }
    else if (tabId === 'profile') loadUserProfile();
    else if (tabId === 'api') loadApiDashboardData();
    else if (tabId === 'notifications') loadDashboardNotifications();
}

// ==========================================
// DC MOBILE TOGGLES
// ==========================================

function dcToggleMobileSidebar() {
    const sidebar = document.getElementById('dc-sidebar');
    const dock = document.getElementById('dc-server-dock');
    const backdrop = document.getElementById('dc-mobile-backdrop');
    const membersBar = document.getElementById('dc-members-sidebar');
    if (!sidebar) return;
    const isOpen = sidebar.classList.contains('mobile-open');
    if (isOpen) {
        sidebar.classList.remove('mobile-open');
        if (dock) dock.classList.remove('mobile-open');
        if (backdrop) { backdrop.classList.remove('mobile-open'); backdrop.style.display = 'none'; }
    } else {
        if (membersBar) membersBar.classList.remove('mobile-open');
        sidebar.classList.add('mobile-open');
        if (dock) dock.classList.add('mobile-open');
        if (backdrop) { backdrop.classList.add('mobile-open'); backdrop.style.display = 'block'; }
    }
}

function dcToggleMobileMembers() {
    const membersBar = document.getElementById('dc-members-sidebar');
    const sidebar = document.getElementById('dc-sidebar');
    const backdrop = document.getElementById('dc-mobile-backdrop');
    if (!membersBar) return;
    const isOpen = membersBar.classList.contains('mobile-open');
    if (isOpen) {
        membersBar.classList.remove('mobile-open');
        if (backdrop) { backdrop.classList.remove('mobile-open'); backdrop.style.display = 'none'; }
    } else {
        if (sidebar) sidebar.classList.remove('mobile-open');
        membersBar.classList.add('mobile-open');
        if (backdrop) { backdrop.classList.add('mobile-open'); backdrop.style.display = 'block'; }
    }
}

function dcCloseMobileOverlays() {
    const sidebar = document.getElementById('dc-sidebar');
    const dock = document.getElementById('dc-server-dock');
    const membersBar = document.getElementById('dc-members-sidebar');
    const backdrop = document.getElementById('dc-mobile-backdrop');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (dock) dock.classList.remove('mobile-open');
    if (membersBar) membersBar.classList.remove('mobile-open');
    if (backdrop) { backdrop.classList.remove('mobile-open'); backdrop.style.display = 'none'; }
}

// Override old sidebar toggles to use new DC ones
function toggleLeftCommunitySidebar() { dcToggleMobileSidebar(); }
function toggleRightCommunitySidebar() { dcToggleMobileMembers(); }
function closeAllCommunitySidebars() { dcCloseMobileOverlays(); }
function toggleDMCommunitySidebar() { dcToggleMobileSidebar(); }
function closeDMCommunitySidebar() { dcCloseMobileOverlays(); }

// Override: switchCommunityView (old tabs system — no longer exists in new layout)
function switchCommunityView(view) {
    if (view === 'dms') switchDCView('dms');
    else if (view === 'servers') switchDCView('server');
}

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================

function showToast(message, type) {
    const existing = document.getElementById('wavely-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'wavely-toast';
    const bg = type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--error)' : 'var(--primary)';
    toast.style.cssText = `position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:${bg};color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.4);pointer-events:none;animation:slideUpFade 0.3s ease;`;
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
}

// Close search dropdown when clicking outside
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('dc-search-results-dropdown');
    const searchInput = document.getElementById('dc-user-search-input');
    if (dropdown && !dropdown.contains(e.target) && e.target !== searchInput) {
        dropdown.style.display = 'none';
    }
});

// App-main community padding override
document.addEventListener('DOMContentLoaded', () => {
    const commSection = document.querySelector('.dc-community-section');
    if (commSection) {
        const appMain = document.querySelector('.app-main');
        if (appMain) { appMain.style.padding = '0'; appMain.style.maxWidth = '100%'; }
    }
});

// =============================================================
// FIX: selectChannel must show the server chat pane + channel item active state
// =============================================================

function selectChannel(channelId) {
    currentChannelId = channelId;
    const server = allServers.find(s => s.id === currentServerId);
    if (!server) return;

    const channel = server.channels.find(c => c.id === channelId);
    if (!channel) return;

    // Update active channel highlight
    document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));

    // Show server chat pane, hide welcome/empty pane
    const serverChat = document.getElementById('dc-server-chat');
    const emptyPane = document.getElementById('dc-chat-empty');
    if (serverChat) { serverChat.style.display = 'flex'; }
    if (emptyPane) { emptyPane.style.display = 'none'; }

    // Update header info
    const chanNameEl = document.getElementById('selected-channel-name');
    if (chanNameEl) chanNameEl.innerText = channel.name;
    const chatInput = document.getElementById('server-chat-input');
    if (chatInput) chatInput.placeholder = 'Message #' + channel.name;

    const slowmodeEl = document.getElementById('channel-slowmode-indicator');
    const lockedEl = document.getElementById('channel-locked-indicator');
    if (slowmodeEl) slowmodeEl.style.display = (channel.slowmode > 0) ? 'inline-block' : 'none';
    if (lockedEl) lockedEl.style.display = channel.locked ? 'inline-block' : 'none';

    const isOwner = currentUserProfile && server.owner === currentUserProfile.username;
    const myRoles = currentUserProfile ? ((server.members || {})[currentUserProfile.username] || []) : [];
    const isMod = isOwner || myRoles.includes('role-mod');
    const chanSettingsBtn = document.getElementById('btn-channel-settings');
    if (chanSettingsBtn) chanSettingsBtn.style.display = isMod ? 'inline-block' : 'none';
    const serverMembersToggle = document.getElementById('dc-server-members-toggle');
    if (serverMembersToggle) serverMembersToggle.style.display = 'flex';

    loadServerMessages();
    dcCloseMobileOverlays();
}

// FIX: switchDCView 'server' — always show chat if channel already selected, 
// and always show members sidebar when a server is active
function switchDCView(view) {
    dcCurrentView = view;
    const dmsBtn = document.getElementById('dc-dock-dms-btn');
    const dmsSidebar = document.getElementById('dc-dms-sidebar');
    const serverSidebar = document.getElementById('dc-server-sidebar');
    const serverChat = document.getElementById('dc-server-chat');
    const dmChat = document.getElementById('dc-dm-chat');
    const emptyPane = document.getElementById('dc-chat-empty');
    const membersBar = document.getElementById('dc-members-sidebar');
    const layout = document.getElementById('dc-layout');
    const membersMobileBtn = document.getElementById('dc-mobile-members-btn');
    const serverMembersToggle = document.getElementById('dc-server-members-toggle');

    // Hide everything first
    if (serverChat) serverChat.style.display = 'none';
    if (dmChat) dmChat.style.display = 'none';
    if (emptyPane) emptyPane.style.display = 'none';

    if (view === 'dms') {
        if (dmsBtn) dmsBtn.classList.add('active');
        if (dmsSidebar) dmsSidebar.style.display = 'flex';
        if (serverSidebar) serverSidebar.style.display = 'none';
        if (membersBar) membersBar.style.display = 'none';
        if (layout) layout.classList.remove('has-members');
        if (membersMobileBtn) membersMobileBtn.style.display = 'none';
        if (serverMembersToggle) serverMembersToggle.style.display = 'none';

        if (currentDMPartner) {
            if (dmChat) dmChat.style.display = 'flex';
        } else {
            if (emptyPane) emptyPane.style.display = 'flex';
        }

        document.getElementById('dc-mobile-title').innerText = 'Direct Messages';
        loadDMs();
        loadDCFriends();

    } else if (view === 'server') {
        if (dmsBtn) dmsBtn.classList.remove('active');
        if (dmsSidebar) dmsSidebar.style.display = 'none';
        if (serverSidebar) serverSidebar.style.display = 'flex';

        // Show chat if a channel is selected, otherwise show empty
        if (currentChannelId) {
            if (serverChat) serverChat.style.display = 'flex';
        } else {
            if (emptyPane) emptyPane.style.display = 'flex';
        }

        if (currentServerId) {
            if (membersBar) { membersBar.style.display = 'flex'; }
            if (layout) layout.classList.add('has-members');
            if (membersMobileBtn) membersMobileBtn.style.display = 'flex';
            if (serverMembersToggle) serverMembersToggle.style.display = 'flex';
        }

    } else {
        // empty / default
        if (dmsBtn) dmsBtn.classList.remove('active');
        if (dmsSidebar) dmsSidebar.style.display = 'none';
        if (serverSidebar) serverSidebar.style.display = 'flex';
        if (membersBar) membersBar.style.display = 'none';
        if (layout) layout.classList.remove('has-members');
        if (membersMobileBtn) membersMobileBtn.style.display = 'none';
        if (serverMembersToggle) serverMembersToggle.style.display = 'none';
        if (emptyPane) emptyPane.style.display = 'flex';
    }
}

// =============================================================
// WAVELY DESKTOP NOTIFICATIONS
// Browser notifications for new DMs and incoming calls.
// =============================================================

let wavelyNotifShownIds = [];
try { wavelyNotifShownIds = JSON.parse(localStorage.getItem('wavely_notif_shown') || '[]'); } catch(e) { wavelyNotifShownIds = []; }
let wavelyNotifEnabled = localStorage.getItem('wavely_notif_enabled') === 'true';
let wavelyNotifSeeded = false;
let wavelyLastCallNotified = null;

function wavelyNotifSupported() {
    return ('Notification' in window);
}

// User clicks "Enable Notifications" — request OS/browser permission.
function enableWavelyNotifications() {
    if (!wavelyNotifSupported()) {
        if (typeof showToast === 'function') showToast('This browser does not support notifications.', 'error');
        return;
    }
    Notification.requestPermission().then(perm => {
        if (perm === 'granted') {
            wavelyNotifEnabled = true;
            localStorage.setItem('wavely_notif_enabled', 'true');
            updateNotifToggleUI();
            try {
                new Notification('Wavely notifications enabled', {
                    body: "You'll now be notified when someone messages or calls you.",
                    icon: '/static/icon.png'
                });
            } catch(e) {}
            if (typeof showToast === 'function') showToast('Desktop notifications enabled!', 'success');
        } else if (perm === 'denied') {
            wavelyNotifEnabled = false;
            localStorage.setItem('wavely_notif_enabled', 'false');
            updateNotifToggleUI();
            if (typeof showToast === 'function') showToast('Notifications were blocked. Enable them in your browser settings.', 'error');
        }
    }).catch(() => {});
}

function disableWavelyNotifications() {
    wavelyNotifEnabled = false;
    localStorage.setItem('wavely_notif_enabled', 'false');
    updateNotifToggleUI();
    if (typeof showToast === 'function') showToast('Desktop notifications turned off.', 'success');
}

function toggleWavelyNotifications() {
    if (wavelyNotifEnabled && wavelyNotifSupported() && Notification.permission === 'granted') {
        disableWavelyNotifications();
    } else {
        enableWavelyNotifications();
    }
}

// Reflect current state in any toggle button present on the page.
function updateNotifToggleUI() {
    const btn = document.getElementById('btn-enable-notifications');
    const statusEl = document.getElementById('notif-permission-status');
    const on = wavelyNotifEnabled && wavelyNotifSupported() && Notification.permission === 'granted';
    if (btn) {
        if (!wavelyNotifSupported()) {
            btn.innerHTML = '<i class="fa-solid fa-ban"></i> Not supported';
            btn.disabled = true;
        } else if (Notification.permission === 'denied') {
            btn.innerHTML = '<i class="fa-solid fa-bell-slash"></i> Blocked in browser';
        } else if (on) {
            btn.innerHTML = '<i class="fa-solid fa-bell"></i> Notifications On';
            btn.classList.add('active');
        } else {
            btn.innerHTML = '<i class="fa-solid fa-bell"></i> Enable Notifications';
            btn.classList.remove('active');
        }
    }
    if (statusEl) {
        if (!wavelyNotifSupported()) statusEl.innerText = 'Your browser does not support desktop notifications.';
        else if (Notification.permission === 'denied') statusEl.innerText = 'Notifications are blocked. Re-enable them in your browser site settings.';
        else if (on) statusEl.innerText = "On — you'll get alerts for new messages and incoming calls.";
        else statusEl.innerText = 'Off — turn on to get alerts even when this tab is in the background.';
    }
}

// Show a browser notification (respects enabled state + permission).
function showWavelyNotification(title, body, tag, onClickUrl) {
    if (!wavelyNotifEnabled || !wavelyNotifSupported() || Notification.permission !== 'granted') return;
    try {
        const n = new Notification(title, {
            body: body || '',
            tag: tag || undefined,
            icon: '/static/icon.png',
            renotify: true
        });
        n.onclick = () => {
            window.focus();
            if (onClickUrl) { try { window.location.href = onClickUrl; } catch(e) {} }
            n.close();
        };
        setTimeout(() => { try { n.close(); } catch(e) {} }, 12000);
    } catch(e) {}
}

// Decide whether a DM notification should be suppressed because the user is
// already actively looking at that conversation.
function isViewingDMWith(user) {
    return document.hasFocus()
        && currentTab === 'community'
        && dcCurrentView === 'dms'
        && currentDMPartner === user;
}

// Process notifications + incoming call from each poll payload.
function processWavelyNotifications(data) {
    // Incoming call notification
    if (data && data.incoming_call) {
        const callId = data.incoming_call.id;
        if (wavelyLastCallNotified !== callId) {
            wavelyLastCallNotified = callId;
            showWavelyNotification(
                `${data.incoming_call.caller} is calling you`,
                'Tap to open Wavely and answer.',
                'wavely-call-' + callId,
                '/community'
            );
        }
    } else if (!data || !data.incoming_call) {
        wavelyLastCallNotified = null;
    }

    if (!data || !Array.isArray(data.notifications)) return;

    // On first poll after load, seed the backlog so we don't spam notifications
    // for messages that arrived while the user was offline. To avoid missing a
    // DM that landed in the small window right before the first poll, we still
    // notify for anything that arrived within FIRST_POLL_WINDOW of the server's
    // current time. We compare server-side timestamps only (notification
    // timestamp vs data.server_time) so this is immune to client clock skew.
    if (!wavelyNotifSeeded) {
        wavelyNotifSeeded = true;
        const FIRST_POLL_WINDOW_MS = 8000;
        const serverNow = data.server_time ? Date.parse(data.server_time) : NaN;
        let firstChanged = false;
        data.notifications.forEach(n => {
            if (!n || !n.id) return;
            const alreadyShown = wavelyNotifShownIds.includes(n.id);
            const ts = n.timestamp ? Date.parse(n.timestamp) : NaN;
            const isRecent = !isNaN(serverNow) && !isNaN(ts) && (serverNow - ts) <= FIRST_POLL_WINDOW_MS;
            if (isRecent && !alreadyShown) {
                wavelyNotifShownIds.push(n.id);
                firstChanged = true;
                if (n.type === 'dm') {
                    if (isViewingDMWith(n.from)) return;
                    showWavelyNotification(
                        `${n.from} sent a message`,
                        n.preview || 'New message',
                        'wavely-dm-' + n.from,
                        '/community'
                    );
                }
            } else if (!alreadyShown) {
                wavelyNotifShownIds.push(n.id);
                firstChanged = true;
            }
        });
        if (firstChanged) {
            wavelyNotifShownIds = wavelyNotifShownIds.slice(-300);
            localStorage.setItem('wavely_notif_shown', JSON.stringify(wavelyNotifShownIds));
        }
        return;
    }

    let changed = false;
    data.notifications.forEach(n => {
        if (!n || !n.id) return;
        if (wavelyNotifShownIds.includes(n.id)) return;
        wavelyNotifShownIds.push(n.id);
        changed = true;
        if (n.type === 'dm') {
            if (isViewingDMWith(n.from)) return;
            showWavelyNotification(
                `${n.from} sent a message`,
                n.preview || 'New message',
                'wavely-dm-' + n.from,
                '/community'
            );
        }
    });

    if (changed) {
        wavelyNotifShownIds = wavelyNotifShownIds.slice(-300);
        localStorage.setItem('wavely_notif_shown', JSON.stringify(wavelyNotifShownIds));
    }
}

// Keep the toggle UI in sync once the DOM is ready.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateNotifToggleUI);
} else {
    updateNotifToggleUI();
}
