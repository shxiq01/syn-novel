// ==UserScript==
// @name         NovelUpdates Release Helper
// @namespace    https://github.com/shixq/syn-novel
// @version      1.0.0
// @description  同步已发布章节并在 Add Release 页面自动填表
// @match        https://www.novelupdates.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(function novelUpdatesHelper() {
  'use strict';

  const getGlobalRoot = () => (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let Logger = console;
  let Storage;
  let UI;
  let Dom;

  const initFallbackShared = () => {
    const globalRoot = getGlobalRoot();
    const shared = (globalRoot.SynNovelShared = globalRoot.SynNovelShared || {});

    if (shared.__singleFileFallbackReady) {
      return shared;
    }

    if (!shared.Constants) {
      shared.Constants = {
        APP_NAME: 'SynNovel',
        STORAGE_KEY: 'synNovelData',
        VERSION: '1.0.0',
        RELEASE_FORMAT: {
          CHAPTER: 'chapter',
          C: 'c'
        },
        SELECTORS: {
          NU_DROPDOWN_ITEM: '.dropdown-item, .select2-results__option',
          NU_MODAL_CHAPTER_LINK: '.chapter-listing-modal a'
        }
      };
    }

    if (!shared.Logger) {
      const constants = shared.Constants || { APP_NAME: 'SynNovel' };
      const withPrefix = (level, msg, ...args) => [`[${constants.APP_NAME}] ${level}`, msg, ...args];
      shared.Logger = {
        info(msg, ...args) {
          console.log(...withPrefix('ℹ️', msg, ...args));
        },
        warn(msg, ...args) {
          console.warn(...withPrefix('⚠️', msg, ...args));
        },
        error(msg, ...args) {
          console.error(...withPrefix('❌', msg, ...args));
        }
      };
    }

    if (!shared.Storage) {
      const constants = shared.Constants || { STORAGE_KEY: 'synNovelData', VERSION: '1.0.0' };

      const getPath = (obj, path) => path.split('.').reduce((acc, key) => (acc && key in acc ? acc[key] : undefined), obj);

      const setPath = (obj, path, value) => {
        const parts = path.split('.');
        let cursor = obj;
        for (let i = 0; i < parts.length - 1; i += 1) {
          const key = parts[i];
          if (!cursor[key] || typeof cursor[key] !== 'object') {
            cursor[key] = {};
          }
          cursor = cursor[key];
        }
        cursor[parts[parts.length - 1]] = value;
      };

      const defaultData = () => ({
        novels: {},
        novelConfigs: {},
        publishedReleases: {},
        meta: {
          version: constants.VERSION,
          lastUpdated: new Date().toISOString()
        }
      });

      async function gmGetValue(key, fallbackValue) {
        if (typeof GM_getValue === 'function') {
          return GM_getValue(key, fallbackValue);
        }
        const raw = localStorage.getItem(key);
        if (!raw) {
          return fallbackValue;
        }
        try {
          return JSON.parse(raw);
        } catch {
          return fallbackValue;
        }
      }

      async function gmSetValue(key, value) {
        if (typeof GM_setValue === 'function') {
          return GM_setValue(key, value);
        }
        localStorage.setItem(key, JSON.stringify(value));
        return undefined;
      }

      shared.Storage = {
        async get() {
          const raw = await gmGetValue(constants.STORAGE_KEY, null);
          const data = raw && typeof raw === 'object' ? raw : defaultData();
          if (!data.meta) {
            data.meta = { version: constants.VERSION, lastUpdated: new Date().toISOString() };
          }
          if (!data.meta.version) {
            data.meta.version = constants.VERSION;
          }
          return data;
        },

        async set(data) {
          const next = data && typeof data === 'object' ? data : defaultData();
          next.meta = next.meta || {};
          next.meta.version = next.meta.version || constants.VERSION;
          next.meta.lastUpdated = new Date().toISOString();
          await gmSetValue(constants.STORAGE_KEY, next);
          return next;
        },

        async update(path, value) {
          const data = await this.get();
          setPath(data, path, value);
          return this.set(data);
        },

        async getPath(path, fallbackValue = undefined) {
          const data = await this.get();
          const value = getPath(data, path);
          return value === undefined ? fallbackValue : value;
        },

        async upsertNovel(slug, novelPayload) {
          const data = await this.get();
          data.novels = data.novels || {};
          data.novels[slug] = {
            ...(data.novels[slug] || {}),
            ...novelPayload
          };
          await this.set(data);
          return data.novels[slug];
        },

        async setPublishedRecord(slug, record) {
          const data = await this.get();
          data.publishedReleases = data.publishedReleases || {};
          data.publishedReleases[slug] = {
            ...(data.publishedReleases[slug] || {}),
            ...record,
            releases: Array.from(new Set(record.releases || [])).sort((a, b) => {
              const ai = Number.parseInt(String(a).replace(/^c/i, ''), 10);
              const bi = Number.parseInt(String(b).replace(/^c/i, ''), 10);
              return ai - bi;
            })
          };
          await this.set(data);
          return data.publishedReleases[slug];
        },

        async addPublishedRelease(slug, releaseKey) {
          const current = (await this.getPath(`publishedReleases.${slug}.releases`, [])) || [];
          const next = Array.from(new Set([...current, releaseKey]));
          await this.update(`publishedReleases.${slug}.releases`, next);
          await this.update(`publishedReleases.${slug}.lastScanned`, new Date().toISOString());
          return next;
        }
      };
    }

    if (!shared.Dom) {
      const constants = shared.Constants || { SELECTORS: {} };

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
    }

    if (!shared.UI) {
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
        button.style.cursor = 'pointer';
        button.style.fontSize = '12px';
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
    }

    shared.__singleFileFallbackReady = true;
    return shared;
  };

  const hydrateSharedModules = () => {
    const globalRoot = getGlobalRoot();
    const shared = globalRoot.SynNovelShared || window.SynNovelShared || {};
    Logger = shared.Logger || console;
    Storage = shared.Storage;
    UI = shared.UI;
    Dom = shared.Dom;
    return {
      ready: Boolean(Storage && UI && Dom),
      usedFallback: Boolean(shared.__singleFileFallbackReady)
    };
  };

  const ensureSharedModules = async () => {
    let result = hydrateSharedModules();
    if (result.ready) {
      return result;
    }

    initFallbackShared();
    result = hydrateSharedModules();
    if (!result.ready) {
      await sleep(300);
      result = hydrateSharedModules();
    }
    return result;
  };

  const isAddReleasePage = () => location.pathname.startsWith('/add-release');

  const toReleaseKey = (chapterIndex) => `c${Number.parseInt(chapterIndex, 10)}`;

  const extractReleaseKeysFromHtml = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = [...doc.querySelectorAll('a')];
    const releases = [];

    links.forEach((link) => {
      const text = (link.textContent || '').trim().toLowerCase();
      const matched = text.match(/^(?:chapter\s*)?c?(\d+)$/i) || text.match(/\bc(\d+)\b/i);
      if (matched) {
        releases.push(`c${Number.parseInt(matched[1], 10)}`);
      }
    });

    return Array.from(new Set(releases)).sort((a, b) => {
      const ai = Number.parseInt(a.replace(/^c/i, ''), 10);
      const bi = Number.parseInt(b.replace(/^c/i, ''), 10);
      return ai - bi;
    });
  };

  const scanNovelSeries = async (novelSlug, nuSlug) => {
    const url = `https://www.novelupdates.com/series/${nuSlug}/`;
    const html = await fetch(url, { credentials: 'include' }).then((r) => r.text());
    const releases = extractReleaseKeysFromHtml(html);

    await Storage.setPublishedRecord(novelSlug, {
      nuSlug,
      lastScanned: new Date().toISOString(),
      releases
    });

    return releases;
  };

  const syncPublishedStatus = async () => {
    const data = await Storage.get();
    const novels = data.novels || {};
    const configs = data.novelConfigs || {};
    const slugs = Object.keys(novels);

    if (!slugs.length) {
      UI.toast('未发现私域小说数据，请先在私域脚本执行扫描', 'warn', 4000);
      return;
    }

    let success = 0;
    for (const slug of slugs) {
      const config = configs[slug] || {};
      const nuSlug = config.nuSlug || data.publishedReleases?.[slug]?.nuSlug || slug;

      try {
        const releases = await scanNovelSeries(slug, nuSlug);
        success += 1;
        UI.toast(`同步 ${slug} 完成：${releases.length} 条`, 'info');
      } catch (error) {
        Logger.error('sync series failed', slug, error);
        UI.toast(`同步失败：${slug}`, 'error');
      }
    }

    UI.toast(`已发布状态同步完成 ${success}/${slugs.length}`, 'info', 4500);
  };

  const buildPendingList = async () => {
    const data = await Storage.get();
    const novels = data.novels || {};
    const configs = data.novelConfigs || {};
    const published = data.publishedReleases || {};

    const pending = [];

    Object.entries(novels).forEach(([slug, novel]) => {
      const config = configs[slug] || {};
      const publishedSet = new Set((published[slug]?.releases || []).map((item) => item.toLowerCase()));

      (novel.chapters || []).forEach((chapter) => {
        if (!chapter.unlocked) {
          return;
        }
        const releaseKey = toReleaseKey(chapter.index).toLowerCase();
        if (publishedSet.has(releaseKey)) {
          return;
        }

        const releaseFormat = config.releaseFormat === 'c' ? `c${chapter.index}` : `Chapter ${chapter.index}`;
        pending.push({
          slug,
          novelTitle: novel.title,
          chapterName: chapter.name,
          chapterIndex: chapter.index,
          releaseKey,
          releaseText: releaseFormat,
          link: chapter.url,
          nuSeriesName: config.nuSeriesName || novel.title,
          nuGroupName: config.nuGroupName || novel.group || ''
        });
      });
    });

    return pending.sort((a, b) => a.chapterIndex - b.chapterIndex);
  };

  const fillBySelectors = (selectors, value) => {
    for (const selector of selectors) {
      if (Dom.fillInput(selector, value)) {
        return true;
      }
    }
    return false;
  };

  const fillReleaseForm = async (item) => {
    try {
      await Dom.fillSearchDropdown('input[name="series"], input#series, input.select2-search__field', item.nuSeriesName, {
        matcherText: item.nuSeriesName,
        timeout: 5000
      });
    } catch (error) {
      Logger.warn('fill series by dropdown failed, fallback to plain input', error);
      fillBySelectors(['input[name="series"]', 'input#series'], item.nuSeriesName);
    }

    fillBySelectors(['input[name="release"]', '#release'], item.releaseText);
    fillBySelectors(['input[name="url"]', 'input[name="link"]', '#link'], item.link);

    try {
      await Dom.fillSearchDropdown('input[name="group"], input#group, input.select2-search__field', item.nuGroupName, {
        matcherText: item.nuGroupName,
        timeout: 5000
      });
    } catch (error) {
      Logger.warn('fill group by dropdown failed, fallback to plain input', error);
      fillBySelectors(['input[name="group"]', '#group'], item.nuGroupName);
    }

    await Storage.addPublishedRelease(item.slug, item.releaseKey);
    UI.toast(`已填充：${item.novelTitle} ${item.releaseText}`, 'info', 4500);
  };

  const renderPendingPanel = async () => {
    const pending = await buildPendingList();

    const panel = UI.createFloatingPanel({
      title: `待发布章节 (${pending.length})`,
      actions: [
        { label: '🔄 刷新状态', onClick: () => renderPendingPanel() },
        { label: '📡 同步已发布', primary: true, onClick: () => syncPublishedStatus() }
      ]
    });

    const listWrap = document.createElement('div');
    listWrap.style.marginTop = '8px';
    listWrap.style.maxHeight = '280px';
    listWrap.style.overflow = 'auto';

    if (!pending.length) {
      const empty = document.createElement('div');
      empty.textContent = '暂无待发布章节';
      empty.style.fontSize = '12px';
      listWrap.appendChild(empty);
    } else {
      pending.slice(0, 30).forEach((item) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.padding = '4px 0';

        const label = document.createElement('span');
        label.textContent = `${item.novelTitle} - ${item.releaseText}`;
        label.style.fontSize = '12px';

        const btn = document.createElement('button');
        btn.textContent = '填充';
        btn.style.fontSize = '11px';
        btn.addEventListener('click', () => {
          fillReleaseForm(item).catch((error) => {
            Logger.error('fill release form failed', error);
            UI.toast(`填充失败：${item.releaseText}`, 'error');
          });
        });

        row.appendChild(label);
        row.appendChild(btn);
        listWrap.appendChild(row);
      });
    }

    panel.appendChild(listWrap);
  };

  const initCommonPanel = () => {
    UI.createFloatingPanel({
      title: 'NovelUpdates 同步助手',
      actions: [
        { label: '📡 同步已发布', primary: true, onClick: () => syncPublishedStatus() }
      ]
    });
  };

  const bootstrap = async () => {
    const { ready, usedFallback } = await ensureSharedModules();
    if (!ready) {
      console.warn('[SynNovel] shared modules missing');
      return;
    }

    if (usedFallback) {
      Logger.info('shared modules loaded from single-file fallback');
      UI.toast('SynNovel 单文件模式已启用', 'info', 2200);
    }

    if (isAddReleasePage()) {
      renderPendingPanel().catch((error) => Logger.error('init add release panel failed', error));
    } else {
      initCommonPanel();
    }
  };

  bootstrap().catch((error) => {
    console.error('[SynNovel] bootstrap failed', error);
  });
})();
