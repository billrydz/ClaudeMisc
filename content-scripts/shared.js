/**
 * Shared utilities for Multi-AI Prompt content scripts.
 */

// Guard against double-injection
if (!window.__multiAISharedLoaded) {
  window.__multiAISharedLoaded = true;

  /**
   * Wait for an element matching any of the given selectors to appear.
   * Uses a debounced MutationObserver to avoid thrashing on heavy React sites.
   */
  window.waitForElement = function (selectors, timeout = 10000) {
    const selectorList = Array.isArray(selectors) ? selectors : [selectors];
    return new Promise((resolve, reject) => {
      function findMatch() {
        for (const sel of selectorList) {
          const el = document.querySelector(sel);
          if (el && isElementVisible(el)) return el;
        }
        // Fallback: return first match even if not visibly confirmed
        for (const sel of selectorList) {
          const el = document.querySelector(sel);
          if (el) return el;
        }
        return null;
      }

      // Check immediately
      const immediate = findMatch();
      if (immediate) return resolve(immediate);

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element not found: ${selectorList.join(', ')}`));
      }, timeout);

      let debounceTimer = null;
      const observer = new MutationObserver(() => {
        // Debounce: check at most every 200ms to avoid perf issues on React sites
        if (debounceTimer) return;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          const el = findMatch();
          if (el) {
            clearTimeout(timer);
            observer.disconnect();
            resolve(el);
          }
        }, 200);
      });

      observer.observe(document.body, { childList: true, subtree: true });
    });
  };

  /**
   * Check if an element is visible on the page.
   */
  window.isElementVisible = function (el) {
    if (!el) return false;
    // offsetParent is null for hidden elements (display:none), except for body/fixed
    if (el.offsetParent === null && el.tagName !== 'BODY' && getComputedStyle(el).position !== 'fixed') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  /**
   * Set value on a native input/textarea, triggering React/Vue change detection.
   */
  window.setNativeValue = function (element, value) {
    element.focus();
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
   * Set content in a contenteditable element (ProseMirror, Tiptap, etc.)
   * Uses execCommand which properly triggers framework state updates.
   */
  window.setContentEditable = function (element, text) {
    element.focus();

    // Select all existing content and delete it
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);

    // Try execCommand insertText — works with ProseMirror/Tiptap
    const inserted = document.execCommand('insertText', false, text);

    if (!inserted) {
      // Fallback: set textContent and dispatch synthetic events
      element.textContent = text;

      // Move cursor to end
      const newRange = document.createRange();
      newRange.selectNodeContents(element);
      newRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(newRange);

      // Dispatch events that frameworks listen to
      element.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text,
      }));
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true, inputType: 'insertText', data: text,
      }));
    }
  };

  /**
   * Wait for a response to "settle" — no DOM mutations for stableMs.
   * Uses innerText to avoid capturing hidden UI elements.
   */
  window.waitForResponseSettle = function (container, stableMs = 2000, maxWait = 120000) {
    return new Promise((resolve) => {
      let settleTimer = null;
      let lastText = '';

      const maxTimer = setTimeout(() => {
        observer.disconnect();
        resolve(lastText || container.innerText?.trim() || container.textContent.trim());
      }, maxWait);

      const observer = new MutationObserver(() => {
        const currentText = (container.innerText || container.textContent || '').trim();
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
        resolve(lastText || (container.innerText || container.textContent || '').trim());
      }, stableMs);
    });
  };

  /**
   * Find a nearby button using cascading selectors.
   * Validates that found buttons are visible.
   */
  window.findNearbyButton = function (element, selectors) {
    const selectorList = Array.isArray(selectors) ? selectors : [selectors];
    // Try each selector, prefer visible buttons
    for (const sel of selectorList) {
      const btn = document.querySelector(sel);
      if (btn && isElementVisible(btn)) return btn;
    }
    // Retry without visibility check
    for (const sel of selectorList) {
      const btn = document.querySelector(sel);
      if (btn) return btn;
    }
    // Fallback: look for a button in the same form or parent container
    let container = element.closest('form');
    if (!container) {
      // Walk up a few levels to find a reasonable container
      container = element.parentElement;
      for (let i = 0; i < 5 && container && container !== document.body; i++) {
        const btn = container.querySelector('button[type="submit"], button[aria-label*="Send" i]');
        if (btn && isElementVisible(btn)) return btn;
        container = container.parentElement;
      }
    }
    if (container) {
      const btn = container.querySelector('button[type="submit"], button:not([disabled])');
      if (btn) return btn;
    }
    return null;
  };

  /**
   * Wrap a promise with a timeout.
   */
  window.withTimeout = function (promise, ms, msg = 'Operation timed out') {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
    ]);
  };

  /**
   * Sleep utility
   */
  window.sleep = function (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  /**
   * Detect if the current page is a login/signup page.
   */
  window.detectLoginPage = function () {
    const url = window.location.href;
    const loginIndicators = [
      'login', 'signin', 'sign-in', 'signup', 'sign-up', 'auth',
      'accounts.google.com', 'auth0',
    ];
    if (loginIndicators.some((s) => url.toLowerCase().includes(s))) return true;

    // Check for prominent login forms
    const loginForms = document.querySelectorAll(
      'form[action*="login"], form[action*="signin"], input[type="password"]'
    );
    return loginForms.length > 0;
  };

  // Respond to ping from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ ok: true });
    }
  });
}
