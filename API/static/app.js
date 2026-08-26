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
            if (res.ok) {
                return res.json();
            }
            throw new Error('Not logged in');
        })
        .then(data => {
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
        .catch(() => {
            currentUser = null;
            updateAuthHeader(false);
            loadFavorites();
            if (currentTab === 'dashboard' || currentTab === 'admin' || currentTab === 'community') {
                switchTab('login');
            }
        });
}

function updateAuthHeader(isLoggedIn, isAdmin = false, username = '') {
    const authSection = document.getElementById('header-auth-section');
    const adminNavBtn = document.getElementById('nav-admin-btn');
    
    if (isLoggedIn) {
        authSection.innerHTML = `
            <span class="user-greeting" style="margin-right: 15px; font-size: 13px; color: rgba(255,255,255,0.7); display: inline-flex; align-items: center; gap: 6px;">
                <i class="fa-regular fa-user" style="color: var(--primary-color);"></i> Logged in as <strong style="color: #fff;">${escapeHtml(username)}</strong>
            </span>
            <button class="btn btn-secondary btn-sm" onclick="handleLogout()"><i class="fa-solid fa-right-from-bracket"></i> Sign Out</button>
        `;
        
        if (adminNavBtn) {
            adminNavBtn.style.display = isAdmin ? 'inline-block' : 'none';
        }
    } else {
        authSection.innerHTML = `
            <button class="btn btn-secondary btn-sm" onclick="switchTab('login')">Sign In</button>
            <button class="btn btn-primary btn-sm" onclick="switchTab('signup')">Register</button>
        `;
        if (adminNavBtn) {
            adminNavBtn.style.display = 'none';
        }
    }
}

// --- TAB ROUTING SYSTEM ---
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

// --- DEVELOPER DASHBOARD ACTIONS ---
function loadDashboard() {
    loadUserProfile();
    startCommunityPolling();
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
    // 1. Render Metrics
    document.getElementById('stat-total-requests').innerText = data.stats.totalRequests;
    document.getElementById('stat-success-rate').innerText = data.stats.successRate;
    document.getElementById('stat-most-used').innerText = data.stats.mostUsed;
    document.getElementById('stat-errors').innerText = data.stats.errorCount;

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

    // 3. Render Chart
    renderTrafficChart(data.chart.labels, data.chart.data);

    // 4. Render Logs Table
    allLogs = data.logs;
    filterLogs();
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
            loadDashboard();
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
                loadDashboard();
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

// --- HTML ESCAPE UTILITY ---
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

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
            document.getElementById('dash-username').innerText = data.username;
            document.getElementById('dash-elo-val').innerText = data.profile.elo || 0;
            document.getElementById('dash-rank-val').innerText = data.profile.global_rank || '--';
            document.getElementById('dash-upvotes-val').innerText = data.profile.upvotes || 0;
            document.getElementById('dash-downvotes-val').innerText = data.profile.downvotes || 0;
            
            if (data.profile.pfp) {
                const pfpTs = '?t=' + Date.now();
                document.getElementById('dash-user-pfp').src = data.profile.pfp + pfpTs;
                document.getElementById('profile-edit-pfp-preview').src = data.profile.pfp + pfpTs;
            } else {
                document.getElementById('dash-user-pfp').src = '/static/placeholder-art.png';
                document.getElementById('profile-edit-pfp-preview').src = '/static/placeholder-art.png';
            }
            
            // Fill profile editing form fields
            document.getElementById('profile-bio-input').value = data.profile.bio || '';
            updateBioCharCount();
            const socials = data.profile.socials || {};
            document.getElementById('profile-sc-input').value = socials.soundcloud || '';
            document.getElementById('profile-yt-input').value = socials.youtube || '';
            document.getElementById('profile-tw-input').value = socials.twitter || '';
            document.getElementById('profile-sp-input').value = socials.spotify || '';
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
            return b.tracks && b.tracks.some(t => t.username === currentUserProfile.username);
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
    
    let submitSection = '';
    if (battle.status === 'active') {
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
            <div><strong>UTC Deadline:</strong> ${new Date(b.deadline).toLocaleString()}</div>
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
}

function loadDMMessages() {
    if (!currentDMPartner) return;
    fetch(`/api/dms/messages/${currentDMPartner}`)
        .then(res => res.json())
        .then(data => {
            const container = document.getElementById('dm-chat-messages');
            container.innerHTML = '';
            
            (data.messages || []).forEach(m => {
                const msg = document.createElement('div');
                msg.className = 'chat-message-item';
                msg.innerHTML = `
                    <img src="/static/placeholder-art.png" class="message-user-pfp" alt="PFP" style="width:32px; height:32px; border-radius:50%; object-fit:cover;">
                    <div class="message-content-wrap">
                        <div class="message-meta">
                            <span class="message-username">${escapeHtml(m.sender)}</span>
                            <span class="message-timestamp">${new Date(m.created_at).toLocaleTimeString()}</span>
                        </div>
                        <div class="message-text">${escapeHtml(m.content)}</div>
                    </div>
                `;
                container.appendChild(msg);
            });
            container.scrollTop = container.scrollHeight;
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
    
    server.categories.forEach(cat => {
        const catWrap = document.createElement('div');
        catWrap.className = 'channel-category-wrap';
        catWrap.innerHTML = `
            <div class="channel-category-header">
                <span>${escapeHtml(cat.name)}</span>
            </div>
        `;
        
        const channels = server.channels.filter(c => c.category_id === cat.id);
        channels.forEach(chan => {
            if (chan.allowed_roles && chan.allowed_roles.length > 0) {
                const myRoles = server.members[currentUserProfile.username] || [];
                const isOwner = server.owner === currentUserProfile.username;
                const hasRole = isOwner || myRoles.some(rid => chan.allowed_roles.includes(rid));
                if (!hasRole) return;
            }
            
            const item = document.createElement('div');
            item.className = `channel-item ${currentChannelId === chan.id ? 'active' : ''}`;
            item.onclick = (e) => {
                e.stopPropagation();
                selectChannel(chan.id);
            };
            item.innerHTML = `
                <span># ${escapeHtml(chan.name)}</span>
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
}

function loadServerMessages() {
    if (!currentServerId || !currentChannelId) return;
    fetch(`/api/servers/messages/${currentServerId}/${currentChannelId}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) return;
            const container = document.getElementById('server-chat-messages');
            container.innerHTML = '';
            
            (data.messages || []).forEach(m => {
                const msg = document.createElement('div');
                msg.className = 'chat-message-item';
                msg.innerHTML = `
                    <img src="/static/placeholder-art.png" class="message-user-pfp" alt="PFP" style="width:32px; height:32px; border-radius:50%; object-fit:cover;">
                    <div class="message-content-wrap">
                        <div class="message-meta">
                            <span class="message-username user-hoverable" onmouseover="showHovercard(event, '${m.username}')" style="font-weight:700; cursor:pointer;">${escapeHtml(m.username)}</span>
                            <span class="message-timestamp">${new Date(m.created_at).toLocaleTimeString()}</span>
                        </div>
                        <div class="message-text">${escapeHtml(m.content)}</div>
                    </div>
                `;
                container.appendChild(msg);
            });
            container.scrollTop = container.scrollHeight;
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
    
    Object.keys(server.members).forEach(mname => {
        const mroles = server.members[mname] || [];
        const isOwner = server.owner === mname;
        
        let tagsHtml = '';
        if (isOwner) {
            tagsHtml += `<span class="member-role-tag" style="background:rgba(230,126,34,0.2); color:#e67e22;">OWNER</span> `;
        }
        
        mroles.forEach(rid => {
            const role = server.roles.find(r => r.id === rid);
            if (role) {
                tagsHtml += `<span class="member-role-tag" style="background:rgba(255,255,255,0.05); color:${role.color};">${role.name.toUpperCase()}</span> `;
            }
        });
        
        let kickBanBtns = '';
        const myRoles = server.members[currentUserProfile.username] || [];
        const hasKickBanPerm = server.owner === currentUserProfile.username || myRoles.includes('role-mod');
        if (hasKickBanPerm && mname !== server.owner && mname !== currentUserProfile.username) {
            kickBanBtns = `
                <div style="margin-left:auto; display:flex; gap:4px;">
                    <button class="btn btn-secondary btn-xs" onclick="kickServerMember('${mname}')">Kick</button>
                    <button class="btn btn-error btn-xs" style="background:#ef4444;" onclick="banServerMember('${mname}')">Ban</button>
                </div>
            `;
        }
        
        const mitem = document.createElement('div');
        mitem.className = 'member-item';
        mitem.innerHTML = `
            <img src="/static/placeholder-art.png" class="user-avatar-small" alt="Avatar" style="width:24px; height:24px; border-radius:50%; object-fit:cover; margin-right:8px;">
            <div style="display:flex; flex-direction:column;">
                <span class="user-hoverable" onmouseover="showHovercard(event, '${mname}')" style="font-weight:700; cursor:pointer;">${escapeHtml(mname)}</span>
                <div style="margin-top:2px;">${tagsHtml}</div>
            </div>
            ${kickBanBtns}
        `;
        container.appendChild(mitem);
    });
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
            hideChannelSettingsModal();
            loadServers();
        }
    });
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
    
    fetch('/api/servers/roles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_id: currentServerId, name, color, permissions: perms })
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
                if (p.socials.soundcloud) socialsHtml += `<a href="https://soundcloud.com/${p.socials.soundcloud}" target="_blank" style="color:var(--text-muted); margin-right:8px;"><i class="fa-brands fa-soundcloud"></i></a>`;
                if (p.socials.youtube) socialsHtml += `<a href="https://youtube.com/${p.socials.youtube}" target="_blank" style="color:var(--text-muted); margin-right:8px;"><i class="fa-brands fa-youtube"></i></a>`;
                if (p.socials.twitter) socialsHtml += `<a href="https://twitter.com/${p.socials.twitter}" target="_blank" style="color:var(--text-muted); margin-right:8px;"><i class="fa-brands fa-twitter"></i></a>`;
                if (p.socials.spotify) socialsHtml += `<a href="https://open.spotify.com/search/${p.socials.spotify}" target="_blank" style="color:var(--text-muted); margin-right:8px;"><i class="fa-brands fa-spotify"></i></a>`;
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

function startCommunityPolling() {
    if (communityPollInterval) clearInterval(communityPollInterval);
    pollCommunity();
    communityPollInterval = setInterval(pollCommunity, 5000);
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

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

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


