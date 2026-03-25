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

// Current state for each bot
const state = {
  chatgpt: { status: 'idle', text: '' },
  claude: { status: 'idle', text: '' },
  grok: { status: 'idle', text: '' },
  gemini: { status: 'idle', text: '' },
};

// Track tab IDs
const botTabs = {};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'sendToAll') {
    handleSendToAll(msg.prompt);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'getState') {
    sendResponse(state);
    return true;
  }

  // Status updates from content scripts
  if (msg.type === 'status') {
    state[msg.bot] = { status: msg.status, text: msg.text || '' };
    broadcastToPopup(msg);
    return true;
  }
});

async function handleSendToAll(prompt) {
  const promises = Object.keys(BOT_CONFIG).map((bot) =>
    sendToBot(bot, prompt).catch((err) => {
      updateBotStatus(bot, 'error', `Failed: ${err.message}`);
    })
  );
  await Promise.all(promises);
}

async function sendToBot(bot, prompt) {
  const config = BOT_CONFIG[bot];
  updateBotStatus(bot, 'sending', '');

  // Find existing tab
  let tab = await findBotTab(bot);

  if (!tab) {
    // Open new tab
    tab = await chrome.tabs.create({ url: config.openUrl, active: false });
    botTabs[bot] = tab.id;
    // Wait for the tab to finish loading
    await waitForTabLoad(tab.id);
  } else {
    botTabs[bot] = tab.id;
    // If tab exists, make sure it's loaded
    if (tab.status !== 'complete') {
      await waitForTabLoad(tab.id);
    }
  }

  // Small delay to let SPA hydrate
  await sleep(1500);

  // Inject content scripts if not already present, then send prompt
  try {
    await chrome.tabs.sendMessage(tab.id || botTabs[bot], { action: 'ping' });
  } catch {
    // Content script not ready, inject manually
    await chrome.scripting.executeScript({
      target: { tabId: tab.id || botTabs[bot] },
      files: ['content-scripts/shared.js', `content-scripts/${bot}.js`],
    });
    await sleep(500);
  }

  // Send the prompt to content script
  await chrome.tabs.sendMessage(tab.id || botTabs[bot], {
    action: 'submitPrompt',
    prompt,
    bot,
  });
}

async function findBotTab(bot) {
  const config = BOT_CONFIG[bot];
  for (const pattern of config.urls) {
    const tabs = await chrome.tabs.query({ url: pattern });
    if (tabs.length > 0) {
      return tabs[0];
    }
  }
  return null;
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, 30000);

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
  broadcastToPopup({ type: 'status', bot, status, text: text || '' });
}

function broadcastToPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Popup may be closed, ignore
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
