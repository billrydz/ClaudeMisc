/**
 * Grok content script (grok.com)
 */
(() => {
  if (window.__multiAIGrokLoaded) return;
  window.__multiAIGrokLoaded = true;
  window.__currentBot = 'grok';

  const INPUT_SELECTORS = [
    'textarea',
    'div[contenteditable="true"]',
    'input[type="text"]',
  ];

  const SEND_BUTTON_SELECTORS = [
    'button[aria-label="Send"]',
    'button[aria-label="Send message"]',
    'button[type="submit"]',
    'button[data-testid="send-button"]',
  ];

  const RESPONSE_SELECTORS = [
    'div[class*="message"][class*="assistant"]',
    'div[class*="response"]',
    'div[class*="markdown"]',
    'div[data-role="assistant"]',
  ];

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'submitPrompt') {
      handleSubmit(msg.prompt).then(() => sendResponse({ ok: true }))
        .catch((err) => {
          chrome.runtime.sendMessage({
            type: 'status', bot: 'grok', status: 'error', text: err.message,
          });
          sendResponse({ error: err.message });
        });
      return true;
    }
  });

  async function handleSubmit(prompt) {
    const existingResponses = countResponses();

    // Find and fill input
    const input = await waitForElement(INPUT_SELECTORS);

    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      setNativeValue(input, prompt);
    } else {
      setContentEditable(input, prompt);
    }

    await sleep(300);

    // Find and click send
    const sendBtn = findNearbyButton(input, SEND_BUTTON_SELECTORS);
    if (!sendBtn) {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true,
      }));
    } else {
      sendBtn.click();
    }

    chrome.runtime.sendMessage({
      type: 'status', bot: 'grok', status: 'streaming', text: 'Waiting for response...',
    });

    await sleep(2000);

    const responseEl = await waitForNewResponse(existingResponses);
    if (!responseEl) {
      throw new Error('No response detected');
    }

    const finalText = await waitForResponseSettle(responseEl, 2000, 120000);

    chrome.runtime.sendMessage({
      type: 'status', bot: 'grok', status: 'done', text: finalText,
    });
  }

  function countResponses() {
    return document.querySelectorAll(RESPONSE_SELECTORS.join(', ')).length;
  }

  async function waitForNewResponse(previousCount) {
    const maxWait = 30000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const responses = document.querySelectorAll(RESPONSE_SELECTORS.join(', '));
      if (responses.length > previousCount) {
        return responses[responses.length - 1];
      }
      // Also look for any new content being added to the conversation area
      await sleep(500);
    }
    return null;
  }
})();
