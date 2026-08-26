let allDevices = [];
let activeFilter = 'all';
let selectedDeviceForBan = null;
let pollIntervalTimer = null;

// Auth Token Management
function getAdminToken() {
  return localStorage.getItem('wavely_admin_token') || sessionStorage.getItem('wavely_admin_token') || '';
}

function setAdminToken(token, remember = true) {
  if (remember) {
    localStorage.setItem('wavely_admin_token', token);
  } else {
    sessionStorage.setItem('wavely_admin_token', token);
  }
}

function clearAdminToken() {
  localStorage.removeItem('wavely_admin_token');
  sessionStorage.removeItem('wavely_admin_token');
}

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const adminApp = document.getElementById('adminApp');
const loginForm = document.getElementById('loginForm');
const passwordInput = document.getElementById('passwordInput');
const loginErrorMsg = document.getElementById('loginErrorMsg');
const loginErrorText = document.getElementById('loginErrorText');
const logoutBtn = document.getElementById('logoutBtn');

// Dashboard Elements
const totalDevicesCountEl = document.getElementById('totalDevicesCount');
const onlineDevicesCountEl = document.getElementById('onlineDevicesCount');
const bannedDevicesCountEl = document.getElementById('bannedDevicesCount');
const tamperAlertsCountEl = document.getElementById('tamperAlertsCount');
const devicesTableBody = document.getElementById('devicesTableBody');
const tableCountBadge = document.getElementById('tableCountBadge');
const searchInput = document.getElementById('searchInput');
const filterBtns = document.querySelectorAll('.filter-btn');
const refreshBtn = document.getElementById('refreshBtn');

// Ban Modal Elements
const banModal = document.getElementById('banModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const confirmBanBtn = document.getElementById('confirmBanBtn');
const modalPcName = document.getElementById('modalPcName');
const modalHwid = document.getElementById('modalHwid');
const banReasonInput = document.getElementById('banReasonInput');

// Change Password Modal Elements
const changePassBtn = document.getElementById('changePassBtn');
const changePasswordModal = document.getElementById('changePasswordModal');
const closePassModalBtn = document.getElementById('closePassModalBtn');
const cancelPassModalBtn = document.getElementById('cancelPassModalBtn');
const confirmPassChangeBtn = document.getElementById('confirmPassChangeBtn');
const currPassInput = document.getElementById('currPassInput');
const newPassInput = document.getElementById('newPassInput');
const passChangeError = document.getElementById('passChangeError');

// --- AUTHENTICATED FETCH HELPER ---
async function adminFetch(url, options = {}) {
  const token = getAdminToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    'Authorization': `Bearer ${token}`
  };

  const response = await fetch(url, { ...options, headers });
  
  if (response.status === 401) {
    // Unauthorized -> Token expired or invalid
    clearAdminToken();
    showLoginScreen();
    throw new Error('Unauthorized');
  }

  return response;
}

// --- LOGIN & LOGOUT FLOW ---
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = passwordInput.value.trim();
  loginErrorMsg.classList.add('hidden');

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();

    if (data.success && data.token) {
      setAdminToken(data.token, true);
      showDashboard();
    } else {
      loginErrorText.textContent = data.error || 'Incorrect password';
      loginErrorMsg.classList.remove('hidden');
      if (window.lucide) window.lucide.createIcons();
    }
  } catch (err) {
    loginErrorText.textContent = 'Server connection error';
    loginErrorMsg.classList.remove('hidden');
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await adminFetch('/api/admin/logout', { method: 'POST' });
  } catch (e) {}
  clearAdminToken();
  showLoginScreen();
});

function showLoginScreen() {
  if (pollIntervalTimer) clearInterval(pollIntervalTimer);
  loginScreen.classList.remove('hidden');
  adminApp.classList.add('hidden');
  passwordInput.value = '';
  loginErrorMsg.classList.add('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function showDashboard() {
  loginScreen.classList.add('hidden');
  adminApp.classList.remove('hidden');
  fetchDevices();
  if (pollIntervalTimer) clearInterval(pollIntervalTimer);
  pollIntervalTimer = setInterval(fetchDevices, 4000);
  if (window.lucide) window.lucide.createIcons();
}

// --- DATA FETCHING & RENDERING ---
async function fetchDevices() {
  try {
    const res = await adminFetch('/api/admin/devices');
    const data = await res.json();
    if (data.success) {
      allDevices = data.devices || [];
      updateStats(data.stats);
      renderDevicesTable();
    }
  } catch (err) {
    console.error('Failed to fetch devices:', err);
  }
}

function updateStats(stats) {
  if (!stats) return;
  totalDevicesCountEl.textContent = stats.totalDevices || 0;
  onlineDevicesCountEl.textContent = stats.onlineDevices || 0;
  bannedDevicesCountEl.textContent = (stats.bannedDevices || 0) + (stats.bannedIpsCount ? ` (${stats.bannedIpsCount} IPs)` : '');
  tamperAlertsCountEl.textContent = stats.tamperAlerts || 0;
}

function formatRelativeTime(isoDateStr) {
  if (!isoDateStr) return 'Never';
  const diffMs = Date.now() - new Date(isoDateStr).getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

function isDeviceOnline(device) {
  if (!device.lastSeen) return false;
  const diffMs = Date.now() - new Date(device.lastSeen).getTime();
  return diffMs < 30 * 60 * 1000 && device.status === 'active';
}

function renderDevicesTable() {
  const query = (searchInput.value || '').toLowerCase();
  
  const filtered = allDevices.filter(d => {
    const matchSearch = 
      (d.pcName || '').toLowerCase().includes(query) ||
      (d.username || '').toLowerCase().includes(query) ||
      (d.hwid || '').toLowerCase().includes(query) ||
      (d.ip || '').toLowerCase().includes(query) ||
      (d.platform || '').toLowerCase().includes(query);
    
    if (!matchSearch) return false;

    if (activeFilter === 'online') return isDeviceOnline(d);
    if (activeFilter === 'banned') return d.status === 'banned';
    if (activeFilter === 'tampered') return d.status === 'tampered' || d.tamperFlag;

    return true;
  });

  tableCountBadge.textContent = `${filtered.length} Machines`;

  if (filtered.length === 0) {
    devicesTableBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 40px; color: var(--text-muted);">
          No machines found matching current filter or search criteria.
        </td>
      </tr>
    `;
    return;
  }

  devicesTableBody.innerHTML = filtered.map(d => {
    const isOnline = isDeviceOnline(d);
    let statusBadge = `<span class="status-pill active">Active</span>`;
    if (d.status === 'banned') {
      statusBadge = `<span class="status-pill banned" title="${d.banReason || 'Banned'}">Banned</span>`;
    } else if (d.status === 'tampered' || d.tamperFlag) {
      statusBadge = `<span class="status-pill tampered" title="Tamper flag detected">Tampered</span>`;
    } else if (!isOnline) {
      statusBadge = `<span class="status-pill" style="background: rgba(255,255,255,0.06); color: #9ca3af; border: 1px solid rgba(255,255,255,0.1);">Offline</span>`;
    }

    const actionBtn = d.status === 'banned'
      ? `<button class="btn-unban-action" onclick="unbanDevice('${d.hwid}')">Unban</button>`
      : `<button class="btn-ban-action" onclick="openBanModal('${d.hwid}', '${d.pcName}')">Ban Device</button>`;

    return `
      <tr>
        <td>${statusBadge}</td>
        <td>
          <strong style="color: var(--text-main); font-size: 0.88rem;">${escapeHtml(d.pcName)}</strong>
          <div style="font-size: 0.74rem; color: var(--text-muted);">User: ${escapeHtml(d.username)}</div>
        </td>
        <td>
          <code class="hwid-code" title="${d.fullHash || d.hwid}">${escapeHtml(d.hwid)}</code>
        </td>
        <td>
          <span class="ip-text">${escapeHtml(d.ip || '127.0.0.1')}</span>
        </td>
        <td>
          <div style="font-size: 0.78rem; color: var(--text-main);">${escapeHtml(d.cpuModel || d.platform)}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted);">${d.totalMemoryGB ? d.totalMemoryGB + ' GB RAM • ' : ''}${d.arch || 'x64'}</div>
        </td>
        <td>
          <span style="font-size: 0.78rem; font-weight: 700; color: #a78bfa;">v${escapeHtml(d.appVersion || '1.0.0')}</span>
        </td>
        <td>
          <span style="font-size: 0.78rem; color: var(--text-muted);">${formatRelativeTime(d.lastSeen)}</span>
        </td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center;">
            ${actionBtn}
            <button class="btn-ban-action" style="padding: 5px 8px; font-size: 0.7rem;" title="Ban IP" onclick="banIpAddress('${d.ip}')">Ban IP</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}

// --- BAN MODAL CONTROLS ---
window.openBanModal = function(hwid, pcName) {
  selectedDeviceForBan = hwid;
  modalPcName.textContent = pcName || 'Unknown PC';
  modalHwid.textContent = hwid;
  banReasonInput.value = 'Access suspended by administrator.';
  banModal.classList.remove('hidden');
};

function closeBanModal() {
  banModal.classList.add('hidden');
  selectedDeviceForBan = null;
}

closeModalBtn.addEventListener('click', closeBanModal);
cancelModalBtn.addEventListener('click', closeBanModal);

confirmBanBtn.addEventListener('click', async () => {
  if (!selectedDeviceForBan) return;
  const reason = banReasonInput.value.trim() || 'Access suspended by administrator.';

  try {
    const res = await adminFetch('/api/admin/ban', {
      method: 'POST',
      body: JSON.stringify({ hwid: selectedDeviceForBan, reason })
    });
    const data = await res.json();
    if (data.success) {
      closeBanModal();
      fetchDevices();
    } else {
      alert('Failed to ban: ' + data.error);
    }
  } catch (err) {
    alert('Error connecting to admin API');
  }
});

window.unbanDevice = async function(hwid) {
  if (!confirm(`Are you sure you want to unban device ${hwid}?`)) return;

  try {
    const res = await adminFetch('/api/admin/unban', {
      method: 'POST',
      body: JSON.stringify({ hwid })
    });
    const data = await res.json();
    if (data.success) {
      fetchDevices();
    }
  } catch (err) {
    alert('Failed to unban device');
  }
};

window.banIpAddress = async function(ip) {
  if (!ip || ip === '127.0.0.1') {
    alert('Cannot ban localhost IP');
    return;
  }
  const reason = prompt(`Enter reason for banning IP ${ip}:`, 'IP banned for abuse/unauthorized access');
  if (!reason) return;

  try {
    const res = await adminFetch('/api/admin/ban-ip', {
      method: 'POST',
      body: JSON.stringify({ ip, reason })
    });
    const data = await res.json();
    if (data.success) {
      alert(`IP ${ip} banned.`);
      fetchDevices();
    }
  } catch (err) {
    alert('Failed to ban IP');
  }
};

// --- CHANGE PASSWORD MODAL CONTROLS ---
changePassBtn.addEventListener('click', () => {
  currPassInput.value = '';
  newPassInput.value = '';
  passChangeError.classList.add('hidden');
  changePasswordModal.classList.remove('hidden');
});

function closePassModal() {
  changePasswordModal.classList.add('hidden');
}

closePassModalBtn.addEventListener('click', closePassModal);
cancelPassModalBtn.addEventListener('click', closePassModal);

confirmPassChangeBtn.addEventListener('click', async () => {
  const currentPassword = currPassInput.value;
  const newPassword = newPassInput.value;

  if (!newPassword || newPassword.length < 4) {
    passChangeError.textContent = 'New password must be at least 4 characters';
    passChangeError.classList.remove('hidden');
    return;
  }

  try {
    const res = await adminFetch('/api/admin/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();

    if (data.success) {
      alert('Master password updated successfully! Please keep it secure.');
      closePassModal();
    } else {
      passChangeError.textContent = data.error || 'Failed to update password';
      passChangeError.classList.remove('hidden');
    }
  } catch (err) {
    passChangeError.textContent = 'Server connection error';
    passChangeError.classList.remove('hidden');
  }
});

// --- FILTER PILLS & SEARCH ---
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderDevicesTable();
  });
});

searchInput.addEventListener('input', () => {
  renderDevicesTable();
});

refreshBtn.addEventListener('click', () => {
  fetchDevices();
});

// --- INITIALIZE & CHECK EXISTING SESSION ---
async function checkAuthSession() {
  const token = getAdminToken();
  if (!token) {
    showLoginScreen();
    return;
  }

  try {
    const res = await fetch('/api/admin/verify-session', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      showDashboard();
    } else {
      clearAdminToken();
      showLoginScreen();
    }
  } catch (e) {
    showLoginScreen();
  }
}

checkAuthSession();
