// Wavely client interactions
async function handleStripeCheckout(planType) {
  const btn = document.getElementById(`checkout-btn-${planType}`);
  const originalLabel = btn ? btn.innerHTML : '';
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Opening secure checkout…';
  }

  try {
    const response = await fetch('/api/checkout/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({ plan: planType })
    });
    const data = await response.json();

    if (response.ok && data.checkout_url) {
      window.location.assign(data.checkout_url);
      return;
    }
    throw new Error(data.error || 'Checkout could not be opened.');
  } catch (error) {
    window.alert(error.message || 'Checkout is temporarily unavailable. Please try again.');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    }
  }
}

let currentAudio = null;
let activePlayBtn = null;

function toggleAudioPreview(url, btnElement) {
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    if (activePlayBtn) activePlayBtn.innerText = '▶';
    if (activePlayBtn === btnElement) {
      currentAudio = null;
      activePlayBtn = null;
      return;
    }
  }
  currentAudio = new Audio(url);
  activePlayBtn = btnElement;
  btnElement.innerText = '⏸';
  currentAudio.play();
  currentAudio.onended = () => {
    btnElement.innerText = '▶';
    currentAudio = null;
    activePlayBtn = null;
  };
}
