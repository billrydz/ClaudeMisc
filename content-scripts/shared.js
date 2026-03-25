/**
 * Shared utilities for Multi-AI Prompt content scripts.
 */

// Guard against double-injection
if (!window.__multiAISharedLoaded) {
  window.__multiAISharedLoaded = true;

  /**
   * Wait for an element matching any of the given selectors to appear.
   * Returns the first match found.
   */
  window.waitForElement = function (selectors, timeout = 10000) {
    const selectorList = Array.isArray(selectors) ? selectors : [selectors];
    return new Promise((resolve, reject) => {
      // Check immediately
      for (const sel of selectorList) {
        const el = document.querySelector(sel);
        if (el) return resolve(el);
      }

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element not found: ${selectorList.join(', ')}`));
      }, timeout);

      const observer = new MutationObserver(() => {
        for (const sel of selectorList) {
          const el = document.querySelector(sel);
          if (el) {
            clearTimeout(timer);
            observer.disconnect();
            resolve(el);
            return;
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    });
  };

  /**
   * Set value on a native input/textarea, triggering React/Vue change detection.
   */
  window.setNativeValue = function (element, value) {
    const proto = element.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };

  /**
   * Set content in a contenteditable element (ProseMirror, etc.)
   */
  window.setContentEditable = function (element, text) {
    element.focus();
    // Clear existing content
    element.innerHTML = '';
    // Use execCommand for better framework compatibility
    document.execCommand('insertText', false, text);
    // Also dispatch input event
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
  };

  /**
   * Wait for a response to "settle" — no DOM mutations for stableMs.
   * Watches the given container element.
   * Returns the final text content.
   */
  window.waitForResponseSettle = function (container, stableMs = 2000, maxWait = 120000) {
    return new Promise((resolve, reject) => {
      let settleTimer = null;
      let lastText = '';

      const maxTimer = setTimeout(() => {
        observer.disconnect();
        resolve(lastText || container.textContent.trim());
      }, maxWait);

      const observer = new MutationObserver(() => {
        const currentText = container.textContent.trim();
        if (currentText !== lastText) {
          lastText = currentText;
          // Report streaming progress
          try {
            chrome.runtime.sendMessage({
              type: 'status',
              bot: window.__currentBot,
              status: 'streaming',
              text: currentText,
            });
          } catch { /* popup may be closed */ }
        }
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          clearTimeout(maxTimer);
          observer.disconnect();
          resolve(currentText);
        }, stableMs);
      });

      observer.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      // Start the initial settle timer
      settleTimer = setTimeout(() => {
        clearTimeout(maxTimer);
        observer.disconnect();
        resolve(container.textContent.trim());
      }, stableMs);
    });
  };

  /**
   * Find the closest button to an element (e.g., send button near input)
   */
  window.findNearbyButton = function (element, selectors) {
    const selectorList = Array.isArray(selectors) ? selectors : [selectors];
    // Try each selector
    for (const sel of selectorList) {
      const btn = document.querySelector(sel);
      if (btn) return btn;
    }
    // Fallback: look for a button in the same form or parent container
    const container = element.closest('form') || element.parentElement?.parentElement;
    if (container) {
      const btn = container.querySelector('button[type="submit"], button:not([disabled])');
      if (btn) return btn;
    }
    return null;
  };

  /**
   * Sleep utility
   */
  window.sleep = function (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  // Respond to ping from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ ok: true });
      return true;
    }
  });
}
