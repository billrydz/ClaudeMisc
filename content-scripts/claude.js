/**
 * Claude content script (claude.ai)
 */
(() => {
  if (window.__multiAIClaudeLoaded) return;
  window.__multiAIClaudeLoaded = true;
  window.__currentBot = 'claude';

  const INPUT_SELECTORS = [
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][data-placeholder]',
    'fieldset div[contenteditable="true"]',
    'div[contenteditable="true"]',
  ];

  const SEND_BUTTON_SELECTORS = [
    'button[aria-label="Send Message"]',
    'button[aria-label="Send message"]',
    'button[aria-label*="Send" i]',
    'button[data-testid="send-button"]',
  ];

  const RESPONSE_SELECTORS = [
    'div[data-is-streaming]',
    'div.font-claude-message',
    'div[data-testid*="assistant-message"]',
    'div[data-testid*="message-content"]',
  ];

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'submitPrompt') {
      handleSubmit(msg.prompt)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          chrome.runtime.sendMessage({
            type: 'status', bot: 'claude', status: 'error', text: err.message,
          });
          sendResponse({ error: err.message });
        });
      return true;
    }
  });

  async function handleSubmit(prompt) {
    if (detectLoginPage()) {
      throw new Error('Not logged in. Please log in to Claude first.');
    }

    const existingMessages = countAssistantMessages();

    const input = await withTimeout(
      waitForElement(INPUT_SELECTORS),
      10000,
      'Could not find Claude input field. The UI may have changed.'
    );

    setContentEditable(input, prompt);
    await sleep(300);

    const sendBtn = findNearbyButton(input, SEND_BUTTON_SELECTORS);
    if (!sendBtn) {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true,
      }));
    } else {
      sendBtn.click();
    }

    chrome.runtime.sendMessage({
      type: 'status', bot: 'claude', status: 'streaming', text: 'Waiting for response...',
    });

    await sleep(2000);

    const responseEl = await withTimeout(
      waitForNewResponse(existingMessages),
      30000,
      'No response from Claude within 30s'
    );

    const finalText = await waitForResponseSettle(responseEl, 2000, 120000);

    chrome.runtime.sendMessage({
      type: 'status', bot: 'claude', status: 'done', text: finalText,
    });
  }

  function countAssistantMessages() {
    return document.querySelectorAll(RESPONSE_SELECTORS.join(', ')).length;
  }

  async function waitForNewResponse(previousCount) {
    const maxWait = 30000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      // Look for streaming indicator first
      const streaming = document.querySelector('div[data-is-streaming="true"]');
      if (streaming) return streaming;

      const messages = document.querySelectorAll(RESPONSE_SELECTORS.join(', '));
      if (messages.length > previousCount) {
        return messages[messages.length - 1];
      }
      await sleep(500);
    }
    throw new Error('No response detected');
  }
})();
