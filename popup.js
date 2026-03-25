const BOTS = ['chatgpt', 'claude', 'grok', 'gemini'];

const sendBtn = document.getElementById('send-btn');
const promptEl = document.getElementById('prompt');

// Restore last prompt from storage
chrome.storage.local.get(['lastPrompt'], (result) => {
  if (result.lastPrompt) {
    promptEl.value = result.lastPrompt;
  }
});

// Listen for status updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status') {
    updateCard(msg.bot, msg.status, msg.text);
  }
});

// On popup open, request current state from background
chrome.runtime.sendMessage({ action: 'getState' }, (state) => {
  if (chrome.runtime.lastError || !state) return;
  for (const bot of BOTS) {
    if (state[bot]) {
      updateCard(bot, state[bot].status, state[bot].text);
    }
  }
});

sendBtn.addEventListener('click', () => {
  const prompt = promptEl.value.trim();
  if (!prompt) return;

  // Save prompt
  chrome.storage.local.set({ lastPrompt: prompt });

  // Reset all cards
  for (const bot of BOTS) {
    updateCard(bot, 'sending', '');
  }

  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';

  chrome.runtime.sendMessage({ action: 'sendToAll', prompt }, () => {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send to All';
  });
});

// Allow Ctrl+Enter to send
promptEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    sendBtn.click();
  }
});

function updateCard(bot, status, text) {
  const card = document.querySelector(`.card[data-bot="${bot}"]`);
  if (!card) return;

  const badge = card.querySelector('.status-badge');
  badge.dataset.status = status;
  badge.textContent = status;

  if (text !== undefined && text !== null) {
    const responseEl = card.querySelector('.response-text');
    responseEl.textContent = text;
    // Auto-scroll to bottom
    const body = card.querySelector('.card-body');
    body.scrollTop = body.scrollHeight;
  }
}
