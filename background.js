const BOT_CONFIG = {
  chatgpt: {
    urls: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    openUrl: 'https://chatgpt.com/',
  },
  claude: {
    urls: ['https://claude.ai/*'],
    openUrl: 'https://claude.ai/new',
  },
  grok: {
    urls: ['https://grok.com/*'],
    openUrl: 'https://grok.com/',
  },
  gemini: {
    urls: ['https://gemini.google.com/*'],
    openUrl: 'https://gemini.google.com/app',
  },
};

const BOTS = Object.keys(BOT_CONFIG);
const SEND_MESSAGE_TIMEOUT = 15000;

// In-memory state (also persisted to storage.session)
const state = {};
for (const bot of BOTS) {
  state[bot] = { status: 'idle', text: '' };
}

// Track tab IDs
const botTabs = {};
let isSending = false;

// Clean up dead tab references
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const bot of BOTS) {
    if (botTabs[bot] === tabId) {
      delete botTabs[bot];
    }
  }
});

// Service worker keepalive alarm (no-op listener keeps worker alive)
chrome.alarms.onAlarm.addListener(() => {});

// Restore state from session storage on worker restart
chrome.storage.session.get(['botState'], (result) => {
  if (result.botState) {
    Object.assign(state, result.botState);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'sendToAll') {
    if (isSending) {
      sendResponse({ ok: false, error: 'Already sending' });
      return true;
    }
    handleSendToAll(msg.prompt);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'getState') {
    sendResponse({ ...state, isSending });
    return true;
  }

  // Status updates from content scripts
  if (msg.type === 'status' && msg.bot) {
    state[msg.bot] = { status: msg.status, text: msg.text || '' };
    persistState();
    broadcastToPopup(msg);
    return true;
  }
});

async function handleSendToAll(prompt) {
  isSending = true;

  // Start keepalive alarm (fires every 24s to prevent service worker termination)
  chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });

  // Reset all bots
  for (const bot of BOTS) {
    updateBotStatus(bot, 'sending', '');
  }

  const promises = BOTS.map((bot) =>
    sendToBot(bot, prompt).catch((err) => {
      updateBotStatus(bot, 'error', `Failed: ${err.message}`);
    })
  );
  await Promise.all(promises);

  isSending = false;
  chrome.alarms.clear('keepalive');

  // Notify popup that all bots are done
  broadcastToPopup({ type: 'allDone' });
  persistState();
}

async function sendToBot(bot, prompt) {
  const config = BOT_CONFIG[bot];
  const tabId = await getOrCreateTab(bot, config);

  // Small delay to let SPA hydrate
  await sleep(1500);

  // Ensure content script is ready
  await ensureContentScript(tabId, bot);

  // Send the prompt to content script (with timeout)
  await sendTabMessage(tabId, {
    action: 'submitPrompt',
    prompt,
    bot,
  }, SEND_MESSAGE_TIMEOUT);
}

async function getOrCreateTab(bot, config) {
  // Check cached tab is still alive
  if (botTabs[bot]) {
    try {
      const tab = await chrome.tabs.get(botTabs[bot]);
      if (tab) {
        if (tab.status !== 'complete') {
          await waitForTabLoad(tab.id);
        }
        return tab.id;
      }
    } catch {
      // Tab no longer exists
      delete botTabs[bot];
    }
  }

  // Search for existing tab
  for (const pattern of config.urls) {
    const tabs = await chrome.tabs.query({ url: pattern });
    if (tabs.length > 0) {
      botTabs[bot] = tabs[0].id;
      if (tabs[0].status !== 'complete') {
        await waitForTabLoad(tabs[0].id);
      }
      return tabs[0].id;
    }
  }

  // Create new tab
  const tab = await chrome.tabs.create({ url: config.openUrl, active: false });
  botTabs[bot] = tab.id;
  await waitForTabLoad(tab.id);
  return tab.id;
}

async function ensureContentScript(tabId, bot) {
  try {
    await sendTabMessage(tabId, { action: 'ping' }, 3000);
  } catch {
    // Content script not ready — inject manually
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/shared.js', `content-scripts/${bot}.js`],
    });
    await sleep(500);
  }
}

/**
 * Send a message to a tab with a timeout to avoid hanging on dead tabs.
 */
function sendTabMessage(tabId, message, timeout = SEND_MESSAGE_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Message to tab ${tabId} timed out after ${timeout}ms`));
    }, timeout);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, 30000);

    // Check if already complete
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        clearTimeout(timeout);
        reject(new Error('Tab not found'));
        return;
      }
      if (tab.status === 'complete') {
        clearTimeout(timeout);
        resolve();
        return;
      }
    });

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function updateBotStatus(bot, status, text) {
  state[bot] = { status, text: text || '' };
  persistState();
  broadcastToPopup({ type: 'status', bot, status, text: text || '' });
}

function persistState() {
  chrome.storage.session.set({ botState: state }).catch(() => {});
}

function broadcastToPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Popup may be closed, ignore
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
