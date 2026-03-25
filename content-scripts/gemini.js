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
    'div[contenteditable="true"][aria-label*="prompt"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea',
    'div[contenteditable="true"]',
  ];

  const SEND_BUTTON_SELECTORS = [
    'button[aria-label="Send message"]',
    'button[aria-label="Send"]',
    'button.send-button',
    'button[data-test-id="send-button"]',
    'button[mattooltip="Send"]',
  ];

  const RESPONSE_SELECTORS = [
    'model-response',
    'div.model-response-text',
    'message-content.model-response',
    'div[class*="response-container"]',
    'div[class*="model-response"]',
  ];

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'submitPrompt') {
      handleSubmit(msg.prompt).then(() => sendResponse({ ok: true }))
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
      // Gemini may use Enter to send
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true,
      }));
    } else {
      sendBtn.click();
    }

    chrome.runtime.sendMessage({
      type: 'status', bot: 'gemini', status: 'streaming', text: 'Waiting for response...',
    });

    await sleep(2000);

    const responseEl = await waitForNewResponse(existingResponses);
    if (!responseEl) {
      throw new Error('No response detected');
    }

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
    return null;
  }
})();
