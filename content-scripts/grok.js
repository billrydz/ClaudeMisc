/**
 * Grok content script (grok.com)
 */
(() => {
  if (window.__multiAIGrokLoaded) return;
  window.__multiAIGrokLoaded = true;
  window.__currentBot = 'grok';

  const INPUT_SELECTORS = [
    '.tiptap.ProseMirror[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'textarea',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
  ];

  const SEND_BUTTON_SELECTORS = [
    'button[aria-label="Submit"]',
    'button[aria-label="Send"]',
    'button[aria-label*="Send" i]',
    'button[type="submit"]',
  ];

  const RESPONSE_SELECTORS = [
    'div[data-role="assistant"]',
    'div[class*="message"][class*="assistant"]',
    'div[class*="response"]',
    'div[class*="markdown"]',
  ];

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'submitPrompt') {
      handleSubmit(msg.prompt)
        .then(() => sendResponse({ ok: true }))
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
    if (detectLoginPage()) {
      throw new Error('Not logged in. Please log in to Grok first.');
    }

    const existingResponses = countResponses();

    const input = await withTimeout(
      waitForElement(INPUT_SELECTORS),
      10000,
      'Could not find Grok input field. The UI may have changed.'
    );

    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      setNativeValue(input, prompt);
    } else {
      setContentEditable(input, prompt);
    }

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
      type: 'status', bot: 'grok', status: 'streaming', text: 'Waiting for response...',
    });

    await sleep(2000);

    const responseEl = await withTimeout(
      waitForNewResponse(existingResponses),
      30000,
      'No response from Grok within 30s'
    );

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
      await sleep(500);
    }
    throw new Error('No response detected');
  }
})();
