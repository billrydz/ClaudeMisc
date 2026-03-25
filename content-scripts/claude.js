/**
 * Claude content script (claude.ai)
 */
(() => {
  if (window.__multiAIClaudeLoaded) return;
  window.__multiAIClaudeLoaded = true;
  window.__currentBot = 'claude';

  const INPUT_SELECTORS = [
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"]',
    'fieldset div[contenteditable="true"]',
  ];

  const SEND_BUTTON_SELECTORS = [
    'button[aria-label="Send Message"]',
    'button[aria-label="Send message"]',
    'button[data-testid="send-button"]',
    'fieldset button:last-of-type',
  ];

  const RESPONSE_SELECTORS = [
    'div[data-is-streaming]',
    'div.font-claude-message',
    'div[class*="response"]',
    'div[data-testid*="message"]',
  ];

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'submitPrompt') {
      handleSubmit(msg.prompt).then(() => sendResponse({ ok: true }))
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
    // Count existing assistant messages
    const existingMessages = countAssistantMessages();

    // Find and fill input
    const input = await waitForElement(INPUT_SELECTORS);

    setContentEditable(input, prompt);
    await sleep(300);

    // Find and click send button
    const sendBtn = findNearbyButton(input, SEND_BUTTON_SELECTORS);
    if (!sendBtn) {
      // Try Enter key
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true,
      }));
    } else {
      sendBtn.click();
    }

    chrome.runtime.sendMessage({
      type: 'status', bot: 'claude', status: 'streaming', text: 'Waiting for response...',
    });

    await sleep(2000);

    // Wait for new response
    const responseEl = await waitForNewResponse(existingMessages);
    if (!responseEl) {
      throw new Error('No response detected');
    }

    const finalText = await waitForResponseSettle(responseEl, 2000, 120000);

    chrome.runtime.sendMessage({
      type: 'status', bot: 'claude', status: 'done', text: finalText,
    });
  }

  function countAssistantMessages() {
    // Claude shows messages in a conversation thread
    const all = document.querySelectorAll(
      'div[data-is-streaming], div.font-claude-message, div[class*="response"]'
    );
    return all.length;
  }

  async function waitForNewResponse(previousCount) {
    const maxWait = 30000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      // Look for streaming indicator or new message
      const streaming = document.querySelector('div[data-is-streaming="true"]');
      if (streaming) return streaming;

      const messages = document.querySelectorAll(
        'div[data-is-streaming], div.font-claude-message, div[class*="response"]'
      );
      if (messages.length > previousCount) {
        return messages[messages.length - 1];
      }
      await sleep(500);
    }
    return null;
  }
})();
