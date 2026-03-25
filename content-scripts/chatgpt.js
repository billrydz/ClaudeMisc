/**
 * ChatGPT content script (chatgpt.com / chat.openai.com)
 */
(() => {
  if (window.__multiAIChatGPTLoaded) return;
  window.__multiAIChatGPTLoaded = true;
  window.__currentBot = 'chatgpt';

  const INPUT_SELECTORS = [
    '#prompt-textarea',
    'div[contenteditable="true"][id="prompt-textarea"]',
    'div.ProseMirror[contenteditable="true"]',
    'textarea[placeholder]',
  ];

  const SEND_BUTTON_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send"]',
    'button[aria-label*="Send" i]',
  ];

  const RESPONSE_SELECTORS = [
    'div[data-message-author-role="assistant"]',
    'div.markdown.prose',
    'div.agent-turn',
  ];

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'submitPrompt') {
      handleSubmit(msg.prompt)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          chrome.runtime.sendMessage({
            type: 'status', bot: 'chatgpt', status: 'error', text: err.message,
          });
          sendResponse({ error: err.message });
        });
      return true;
    }
  });

  async function handleSubmit(prompt) {
    // Check for login page
    if (detectLoginPage()) {
      throw new Error('Not logged in. Please log in to ChatGPT first.');
    }

    // Count existing responses before submitting
    const existingResponses = document.querySelectorAll(RESPONSE_SELECTORS.join(', ')).length;

    // Find and fill input
    const input = await withTimeout(
      waitForElement(INPUT_SELECTORS),
      10000,
      'Could not find ChatGPT input field. The UI may have changed.'
    );

    if (input.tagName === 'TEXTAREA') {
      setNativeValue(input, prompt);
    } else if (input.contentEditable === 'true') {
      setContentEditable(input, prompt);
    }

    await sleep(300);

    // Find and click send button
    const sendBtn = findNearbyButton(input, SEND_BUTTON_SELECTORS);
    if (!sendBtn) {
      // Try pressing Enter as fallback
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true,
      }));
    } else {
      sendBtn.click();
    }

    chrome.runtime.sendMessage({
      type: 'status', bot: 'chatgpt', status: 'streaming', text: 'Waiting for response...',
    });

    // Wait for new response to appear
    await sleep(2000);

    const responseEl = await withTimeout(
      waitForNewResponse(existingResponses),
      30000,
      'No response from ChatGPT within 30s'
    );

    const finalText = await waitForResponseSettle(responseEl, 2000, 120000);

    chrome.runtime.sendMessage({
      type: 'status', bot: 'chatgpt', status: 'done', text: finalText,
    });
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
