/**
 * Gemini content script (gemini.google.com)
 */
(() => {
  if (window.__multiAIGeminiLoaded) return;
  window.__multiAIGeminiLoaded = true;
  window.__currentBot = 'gemini';

  const INPUT_SELECTORS = [
    'div.ql-editor[contenteditable="true"]',
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"][aria-label*="prompt" i]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="Enter" i]',
    'textarea',
  ];

  const SEND_BUTTON_SELECTORS = [
    'button[aria-label="Send message"]',
    'button[aria-label="Send"]',
    'button[aria-label*="Send" i]',
    'button[mattooltip="Send"]',
    'button.send-button',
  ];

  const RESPONSE_SELECTORS = [
    'model-response',
    'message-content.model-response',
    'div.model-response-text',
    'div[class*="model-response"]',
    'div[class*="response-container"]',
  ];

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'submitPrompt') {
      handleSubmit(msg.prompt)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          chrome.runtime.sendMessage({
            type: 'status', bot: 'gemini', status: 'error', text: err.message,
          });
          sendResponse({ error: err.message });
        });
      return true;
    }
  });

  async function handleSubmit(prompt) {
    if (detectLoginPage()) {
      throw new Error('Not logged in. Please log in to Gemini first.');
    }

    const existingResponses = countResponses();

    const input = await withTimeout(
      waitForElement(INPUT_SELECTORS),
      10000,
      'Could not find Gemini input field. The UI may have changed.'
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
      type: 'status', bot: 'gemini', status: 'streaming', text: 'Waiting for response...',
    });

    await sleep(2000);

    const responseEl = await withTimeout(
      waitForNewResponse(existingResponses),
      30000,
      'No response from Gemini within 30s'
    );

    const finalText = await waitForResponseSettle(responseEl, 2000, 120000);

    chrome.runtime.sendMessage({
      type: 'status', bot: 'gemini', status: 'done', text: finalText,
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
