(function initUi(root) {
  const globalRoot = root || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
  const shared = (globalRoot.SynNovelShared = globalRoot.SynNovelShared || {});
  const logger = shared.Logger || console;

  const ensureHost = () => {
    let host = document.getElementById('syn-novel-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'syn-novel-host';
      host.style.position = 'fixed';
      host.style.right = '16px';
      host.style.bottom = '16px';
      host.style.zIndex = '999999';
      host.style.display = 'flex';
      host.style.flexDirection = 'column';
      host.style.gap = '8px';
      document.body.appendChild(host);
    }
    return host;
  };

  const createButton = (label, onClick, opts = {}) => {
    const button = document.createElement('button');
    button.textContent = label;
    button.type = 'button';
    button.style.padding = '6px 10px';
    button.style.border = '1px solid #cfd8dc';
    button.style.borderRadius = '6px';
    button.style.background = '#fff';
    button.style.color = '#263238';
    button.style.cursor = 'pointer';
    button.style.fontSize = '12px';
    button.style.whiteSpace = 'nowrap';
    button.style.lineHeight = '1.4';
    if (opts.primary) {
      button.style.background = '#1976d2';
      button.style.color = '#fff';
      button.style.borderColor = '#1976d2';
    }
    button.addEventListener('click', (event) => {
      try {
        onClick(event);
      } catch (error) {
        logger.error('UI button click failed', error);
      }
    });
    return button;
  };

  shared.UI = {
    toast(message, type = 'info', timeout = 2500) {
      const host = ensureHost();
      const el = document.createElement('div');
      el.textContent = message;
      el.style.padding = '10px 12px';
      el.style.borderRadius = '8px';
      el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      el.style.fontSize = '12px';
      el.style.maxWidth = '360px';
      el.style.background = type === 'error' ? '#ffebee' : type === 'warn' ? '#fff8e1' : '#e3f2fd';
      el.style.color = '#263238';
      host.appendChild(el);
      setTimeout(() => {
        el.remove();
      }, timeout);
    },

    createFloatingPanel({ title, actions = [] }) {
      const host = ensureHost();
      const panel = document.createElement('div');
      panel.style.background = '#ffffff';
      panel.style.border = '1px solid #eceff1';
      panel.style.borderRadius = '10px';
      panel.style.padding = '10px';
      panel.style.minWidth = '220px';
      panel.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)';

      const titleEl = document.createElement('div');
      titleEl.textContent = title;
      titleEl.style.fontWeight = '600';
      titleEl.style.marginBottom = '8px';
      titleEl.style.fontSize = '13px';
      panel.appendChild(titleEl);

      const actionWrap = document.createElement('div');
      actionWrap.style.display = 'flex';
      actionWrap.style.flexWrap = 'wrap';
      actionWrap.style.gap = '6px';

      actions.forEach((action) => {
        const button = createButton(action.label, action.onClick, { primary: !!action.primary });
        actionWrap.appendChild(button);
      });

      panel.appendChild(actionWrap);
      host.appendChild(panel);
      return panel;
    }
  };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
