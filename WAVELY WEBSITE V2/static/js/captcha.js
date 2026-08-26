// =========================================================================
// WAVELY ANTI-BOT CAPTCHA CONTROLLER
// Handles dynamic captcha loading, refreshing, and token attachment
// =========================================================================

async function refreshCaptcha() {
  const container = document.getElementById('captcha-image-container');
  const tokenInput = document.getElementById('captcha-token-input');
  const answerInput = document.getElementById('captcha-answer-input');

  if (!container) return;

  container.innerHTML = '<div style="color:#94a3b8;font-size:0.85rem;padding:1rem;">Loading security challenge...</div>';

  try {
    const res = await fetch('/api/captcha');
    const data = await res.json();

    if (data && data.image) {
      container.innerHTML = `<img src="${data.image}" alt="Security Captcha" style="display:block; width:220px; height:70px; border-radius:8px;" />`;
      if (tokenInput) tokenInput.value = data.token;
      if (answerInput) {
        answerInput.value = '';
        answerInput.placeholder = data.is_math ? 'Enter math result...' : 'Enter letters/numbers...';
      }
    }
  } catch (err) {
    container.innerHTML = '<div style="color:#f87171;font-size:0.85rem;padding:1rem;">Failed to load captcha. Click Refresh.</div>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('captcha-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', (e) => {
      e.preventDefault();
      refreshCaptcha();
    });
  }

  // Auto load on page render if container exists
  if (document.getElementById('captcha-image-container')) {
    refreshCaptcha();
  }
});
