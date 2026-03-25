const BOTS = ['chatgpt', 'claude', 'grok', 'gemini'];

const sendBtn = document.getElementById('send-btn');
const promptEl = document.getElementById('prompt');
let isSending = false;

// Restore last prompt from storage
chrome.storage.local.get(['lastPrompt'], (result) => {
  if (result.lastPrompt) {
    promptEl.value = result.lastPrompt;
  }
});

// Restore bot state from session storage (survives popup close/reopen)
chrome.storage.session.get(['botState'], (result) => {
  if (result.botState) {
    for (const bot of BOTS) {
      if (result.botState[bot]) {
        updateCard(bot, result.botState[bot].status, result.botState[bot].text);
      }
    }
    checkIfDone(result.botState);
  }
});

// Also request live state from background (may have newer data)
chrome.runtime.sendMessage({ action: 'getState' }, (state) => {
  if (chrome.runtime.lastError || !state) return;
  for (const bot of BOTS) {
    if (state[bot]) {
      updateCard(bot, state[bot].status, state[bot].text);
    }
  }
  if (state.isSending) {
    isSending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
  }
});

// Listen for status updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status') {
    updateCard(msg.bot, msg.status, msg.text);
    // Check if all bots are done
    checkIfAllDone();
  }
  if (msg.type === 'allDone') {
    isSending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send to All';
  }
});

sendBtn.addEventListener('click', () => {
  const prompt = promptEl.value.trim();
  if (!prompt || isSending) return;

  // Save prompt
  chrome.storage.local.set({ lastPrompt: prompt });

  // Reset all cards
  for (const bot of BOTS) {
    updateCard(bot, 'sending', '');
  }

  isSending = true;
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';

  chrome.runtime.sendMessage({ action: 'sendToAll', prompt }, (response) => {
    if (chrome.runtime.lastError || (response && !response.ok)) {
      isSending = false;
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send to All';
    }
    // Button re-enables when 'allDone' message arrives or all bots reach terminal state
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

function checkIfDone(botState) {
  if (!botState) return;
  const allTerminal = BOTS.every((bot) => {
    const s = botState[bot]?.status;
    return s === 'done' || s === 'error' || s === 'idle';
  });
  if (allTerminal) {
    isSending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send to All';
  }
}

function checkIfAllDone() {
  // Read current card statuses from the DOM
  const allTerminal = BOTS.every((bot) => {
    const card = document.querySelector(`.card[data-bot="${bot}"]`);
    if (!card) return true;
    const status = card.querySelector('.status-badge')?.dataset.status;
    return status === 'done' || status === 'error' || status === 'idle';
  });
  if (allTerminal && isSending) {
    isSending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send to All';
  }
}
