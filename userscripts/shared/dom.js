(function initDom(root) {
  const globalRoot = root || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
  const shared = (globalRoot.SynNovelShared = globalRoot.SynNovelShared || {});
  const constants = shared.Constants || { SELECTORS: {} };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  shared.Dom = {
    async waitFor(selector, { timeout = 5000, interval = 120, root = document } = {}) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeout) {
        const element = root.querySelector(selector);
        if (element) {
          return element;
        }
        await sleep(interval);
      }
      throw new Error(`Element not found: ${selector}`);
    },

    fillInput(selector, value, { eventType = 'input' } = {}) {
      const input = document.querySelector(selector);
      if (!input) {
        return false;
      }
      input.value = value;
      input.dispatchEvent(new Event(eventType, { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },

    async retry(task, { attempts = 3, delay = 300 } = {}) {
      let lastError;
      for (let idx = 1; idx <= attempts; idx += 1) {
        try {
          return await task(idx);
        } catch (error) {
          lastError = error;
          if (idx < attempts) {
            await sleep(delay);
          }
        }
      }
      throw lastError || new Error('retry failed');
    },

    async fillSearchDropdown(inputSelector, searchText, options = {}) {
      const dropdownSelector = options.dropdownSelector || constants.SELECTORS.NU_DROPDOWN_ITEM || '.dropdown-item';
      const input = document.querySelector(inputSelector);
      if (!input) {
        throw new Error(`Input not found: ${inputSelector}`);
      }

      input.focus();
      input.value = searchText;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));

      await this.waitFor(dropdownSelector, {
        timeout: options.timeout || 5000,
        interval: options.interval || 100
      });

      const candidates = [...document.querySelectorAll(dropdownSelector)];
      const matcher = options.matcherText ? String(options.matcherText).toLowerCase() : '';
      const target = matcher
        ? candidates.find((item) => (item.textContent || '').toLowerCase().includes(matcher))
        : candidates[0];

      if (!target) {
        throw new Error(`Dropdown option not found: ${searchText}`);
      }

      target.click();
      return true;
    }
  };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
