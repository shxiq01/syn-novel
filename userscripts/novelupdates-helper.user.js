// ==UserScript==
// @name         NovelUpdates Release Helper
// @namespace    https://github.com/shixq/syn-novel
// @version      1.4.0
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
  const createNUSyncRules = () => {
    const SyncRuleReason = Object.freeze({
      NONE: 'NONE',
      MISSING_NU_SLUG: 'MISSING_NU_SLUG'
    });

    const normalizeReleaseKey = (value) => {
      const raw = String(value || '').trim().toLowerCase();
      if (!raw) {
        return '';
      }

      const chapterMatched = raw.match(/^c\s*(\d+(?:\.\d+)?)$/i)
        || raw.match(/^chapter\s*(\d+(?:\.\d+)?)$/i)
        || raw.match(/^(\d+(?:\.\d+)?)$/i);

      if (!chapterMatched) {
        return '';
      }

      return `c${Number.parseInt(chapterMatched[1], 10)}`;
    };

    const sortReleaseKeys = (keys) => Array.from(new Set(keys || []))
      .map((key) => normalizeReleaseKey(key))
      .filter(Boolean)
      .sort((a, b) => {
        const ai = Number.parseInt(String(a).replace(/^c/i, ''), 10);
        const bi = Number.parseInt(String(b).replace(/^c/i, ''), 10);
        return ai - bi;
      });

    const validateSyncInput = ({ nuSlug } = {}) => {
      const normalizedNuSlug = String(nuSlug || '').trim();
      if (!normalizedNuSlug) {
        return {
          ok: false,
          reason: SyncRuleReason.MISSING_NU_SLUG,
          normalizedNuSlug: ''
        };
      }

      return {
        ok: true,
        reason: SyncRuleReason.NONE,
        normalizedNuSlug
      };
    };

    const shouldBlockRun = (items) => {
      const source = Array.isArray(items) ? items : [];
      return source.some((item) => item && item.ok === false);
    };

    const buildPendingReleaseKeys = ({ unlockedKeys, publishedKeys } = {}) => {
      const unlocked = new Set(sortReleaseKeys(unlockedKeys || []));
      const published = new Set(sortReleaseKeys(publishedKeys || []));
      return sortReleaseKeys([...unlocked].filter((key) => !published.has(key)));
    };

    return {
      SyncRuleReason,
      normalizeReleaseKey,
      sortReleaseKeys,
      validateSyncInput,
      shouldBlockRun,
      buildPendingReleaseKeys
    };
  };
  const loadNUSyncRules = () => {
    const sharedRules = getGlobalRoot()?.SynNovelShared?.NUSyncRules;
    return sharedRules && typeof sharedRules.validateSyncInput === 'function'
      ? sharedRules
      : createNUSyncRules();
  };

  let Logger = console;
  let Storage;
  let UI;
  let Dom;
  let SyncRules = loadNUSyncRules();
  let pendingPanelRef = null;

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
          NU_DROPDOWN_ITEM: '.livesearchresult > div, .livesearchgroup > div, .livesearch > div, .dropdown-item, .select2-results__option',
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
    }

    if (!shared.NUSyncRules) {
      shared.NUSyncRules = createNUSyncRules();
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
    SyncRules = shared.NUSyncRules || SyncRules;
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
  const NU_WAF_COOLDOWN_PATH = 'meta.nuWafCooldownUntil';
  const NU_WAF_COOLDOWN_REASON_PATH = 'meta.nuWafCooldownReason';
  const NU_WAF_COOLDOWN_MINUTES = 1;

  const pickNovelsBySelectedIds = (novels, selectedIds) => {
    const source = novels && typeof novels === 'object' ? novels : {};
    const ids = Array.isArray(selectedIds) ? selectedIds.map((id) => String(id)) : [];
    if (!ids.length) {
      return source;
    }

    const selectedSet = new Set(ids);
    const scoped = Object.fromEntries(Object.entries(source).filter(([, novel]) => {
      if (!novel || typeof novel !== 'object') {
        return false;
      }
      const id = novel.id;
      return id !== undefined && id !== null && selectedSet.has(String(id));
    }));

    return Object.keys(scoped).length ? scoped : source;
  };

  const normalizeSyncPayload = (payload, current) => {
    const payloadMeta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};
    const payloadNovels = payload?.novels && typeof payload.novels === 'object' ? payload.novels : (current.novels || {});
    const scopedNovels = pickNovelsBySelectedIds(payloadNovels, payloadMeta.selectedNovelIds);

    return {
      novels: scopedNovels,
      novelConfigs: payload?.novelConfigs && typeof payload.novelConfigs === 'object' ? payload.novelConfigs : (current.novelConfigs || {}),
      publishedReleases: payload?.publishedReleases && typeof payload.publishedReleases === 'object' ? payload.publishedReleases : (current.publishedReleases || {}),
      meta: {
        ...(current.meta || {}),
        ...payloadMeta,
        lastMirroredFromFox: new Date().toISOString()
      }
    };
  };

  const importDataFromFoxBridge = async ({ silent = false } = {}) => {
    const globalRoot = getGlobalRoot();
    const bridge = globalRoot.SynNovelFoxBridge || window.SynNovelFoxBridge;

    if (!bridge || typeof bridge.exportData !== 'function') {
      if (!silent && UI) {
        UI.toast('未检测到 Fox 数据桥，请先在 Fox 页面执行扫描', 'warn', 4200);
      }
      return false;
    }

    try {
      const snapshot = await bridge.exportData();
      const current = await Storage.get();
      const next = normalizeSyncPayload(snapshot, current);
      await Storage.set(next);

      const count = Object.keys(next.novels || {}).length;
      if (!silent && UI) {
        UI.toast(`已拉取私域数据：${count} 本`, 'info', 3200);
      }
      return count > 0;
    } catch (error) {
      Logger.warn('import data from fox bridge failed', error);
      if (!silent && UI) {
        UI.toast('拉取私域数据失败，请刷新后重试', 'error', 3800);
      }
      return false;
    }
  };

  const ensureNovelDataLoaded = async () => {
    let data = await Storage.get();
    if (Object.keys(data.novels || {}).length) {
      return data;
    }

    const mirrored = await importDataFromFoxBridge({ silent: true });
    if (!mirrored) {
      return data;
    }

    data = await Storage.get();
    return data;
  };

  const toReleaseKey = (chapterIndex) => `c${Number.parseInt(chapterIndex, 10)}`;

  const normalizeTitleKey = (value) => String(value || '')
    .toLowerCase()
    .replace(/[\u2018\u2019'"`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const safeDecodeURIComponent = (value) => {
    try {
      return decodeURIComponent(String(value || ''));
    } catch {
      return String(value || '');
    }
  };

  const slugifyNuSegment = (value) => safeDecodeURIComponent(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/&/g, ' and ')
    .replace(/[\u2018\u2019'"`]/g, '')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  const normalizeNuSlugInput = (value) => {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }

    const normalizeSegment = (segment) => {
      const decoded = safeDecodeURIComponent(String(segment || ''));
      const cleaned = decoded.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '');
      const matched = cleaned.match(/^series\/(.+)$/i);
      const extracted = matched ? String(matched[1] || '').replace(/^\/+|\/+$/g, '') : cleaned;
      if (!extracted) {
        return '';
      }
      if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(extracted)) {
        return extracted.toLowerCase();
      }
      return slugifyNuSegment(extracted);
    };

    const fromPath = (pathname) => {
      const cleaned = String(pathname || '').replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '');
      const matched = cleaned.match(/^series\/(.+)$/i);
      return normalizeSegment(matched ? String(matched[1] || '').replace(/^\/+|\/+$/g, '') : cleaned);
    };

    if (/^https?:\/\//i.test(raw)) {
      try {
        const url = new URL(raw);
        const slugFromSeries = url.pathname.match(/\/series\/([^/]+)/i)?.[1] || '';
        return slugFromSeries || fromPath(url.pathname);
      } catch {
        return normalizeSegment(raw);
      }
    }

    if (raw.startsWith('/')) {
      return fromPath(raw);
    }

    return normalizeSegment(raw);
  };

  const NU_REQUEST_GAP_MS = 560;
  const NU_SYNC_SERIES_GAP_MIN_MS = 800;
  const NU_SYNC_SERIES_GAP_MAX_MS = 1800;
  const NU_SYNC_INTRA_GAP_MIN_MS = 400;
  const NU_SYNC_INTRA_GAP_MAX_MS = 1200;
  const NU_IFRAME_FETCH_TIMEOUT_MS = 18000;
  let nuLastRequestAt = 0;
  let nuIframeRequestSeq = 0;

  const getNuFetch = () => {
    const globalRoot = getGlobalRoot();
    if (globalRoot && typeof globalRoot.fetch === 'function') {
      return globalRoot.fetch.bind(globalRoot);
    }
    if (typeof window.fetch === 'function') {
      return window.fetch.bind(window);
    }
    throw new Error('fetch API unavailable');
  };

  const nuFetch = getNuFetch();

  const isNuGetPageUrl = (url) => /^https:\/\/www\.novelupdates\.com\//i.test(String(url || '').trim());

  const sleepNuRequestGap = async () => {
    const elapsed = Date.now() - nuLastRequestAt;
    if (elapsed < NU_REQUEST_GAP_MS) {
      await sleep(NU_REQUEST_GAP_MS - elapsed);
    }
    nuLastRequestAt = Date.now();
  };

  const randomBetween = (min, max) => {
    const floorMin = Math.max(0, Number.parseInt(min, 10) || 0);
    const floorMax = Math.max(floorMin, Number.parseInt(max, 10) || floorMin);
    return floorMin + Math.floor(Math.random() * (floorMax - floorMin + 1));
  };

  const sleepNuSeriesGap = async () => {
    const delayMs = randomBetween(NU_SYNC_SERIES_GAP_MIN_MS, NU_SYNC_SERIES_GAP_MAX_MS);
    await sleep(delayMs);
    return delayMs;
  };

  const sleepNuIntraSeriesGap = async () => {
    const delayMs = randomBetween(NU_SYNC_INTRA_GAP_MIN_MS, NU_SYNC_INTRA_GAP_MAX_MS);
    await sleep(delayMs);
    return delayMs;
  };

  const parseRetryAfterMs = (response, fallbackMs = 1200) => {
    const header = String(response?.headers?.get('Retry-After') || '').trim();
    if (!header) {
      return fallbackMs;
    }

    const seconds = Number.parseInt(header, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.max(seconds * 1000, fallbackMs);
    }

    const retryAt = Date.parse(header);
    if (!Number.isNaN(retryAt)) {
      return Math.max(retryAt - Date.now(), fallbackMs);
    }

    return fallbackMs;
  };

  const fetchTextByIframeNavigation = async (url, { label = String(url || ''), timeoutMs = NU_IFRAME_FETCH_TIMEOUT_MS } = {}) => {
    const targetUrl = String(url || '').trim();
    if (!targetUrl) {
      throw new Error(`${label} failed: empty url`);
    }

    await sleepNuRequestGap();
    const seq = ++nuIframeRequestSeq;

    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.style.position = 'fixed';
      frame.style.width = '1px';
      frame.style.height = '1px';
      frame.style.opacity = '0';
      frame.style.pointerEvents = 'none';
      frame.style.border = '0';
      frame.setAttribute('aria-hidden', 'true');
      frame.dataset.synnovelIframeFetch = String(seq);

      let settled = false;
      const finalize = (fn, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        frame.removeEventListener('load', onLoad);
        frame.removeEventListener('error', onError);
        frame.remove();
        fn(value);
      };

      const onError = () => finalize(reject, new Error(`${label} iframe navigation failed`));
      const onLoad = () => {
        try {
          const doc = frame.contentDocument;
          if (!doc) {
            finalize(reject, new Error(`${label} iframe document missing`));
            return;
          }
          const text = doc.documentElement?.outerHTML || doc.body?.outerHTML || '';
          if (!String(text || '').trim()) {
            finalize(reject, new Error(`${label} iframe empty html`));
            return;
          }
          finalize(resolve, {
            status: 200,
            text,
            headers: new Headers()
          });
        } catch (error) {
          finalize(reject, error);
        }
      };

      const timer = setTimeout(() => {
        finalize(reject, new Error(`${label} iframe timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      frame.addEventListener('load', onLoad, { once: true });
      frame.addEventListener('error', onError, { once: true });
      document.body.appendChild(frame);
      frame.src = targetUrl;
    });
  };

  const fetchTextWithRetry = async (url, init = {}, options = {}) => {
    const {
      label = String(url || ''),
      maxAttempts = 4,
      retryBaseMs = 1000,
      retryStatuses = [429, 502, 503, 504],
      stopOnForbidden = true,
      allowIframeFallback = true,
      iframeTimeoutMs = NU_IFRAME_FETCH_TIMEOUT_MS
    } = options;

    const method = String(init?.method || 'GET').toUpperCase();
    const headerBag = new Headers(init?.headers || {});
    if (!headerBag.has('Accept')) {
      headerBag.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
    }
    if (method === 'POST' && !headerBag.has('X-Requested-With')) {
      headerBag.set('X-Requested-With', 'XMLHttpRequest');
    }

    const requestInit = {
      ...init,
      method,
      credentials: init?.credentials || 'include',
      headers: Object.fromEntries(headerBag.entries())
    };

    let lastError = null;
    let lastStatus = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await sleepNuRequestGap();

      try {
        const response = await nuFetch(url, requestInit);

        if (response.ok) {
          return {
            status: response.status,
            text: await response.text(),
            headers: response.headers
          };
        }

        if (response.status === 403 && stopOnForbidden) {
          lastStatus = response.status;
          lastError = new Error(`${label} failed: ${response.status}`);
          Logger.warn('NU request blocked by 403, stop retrying immediately', {
            label,
            status: response.status,
            attempt
          });
          break;
        }

        if (retryStatuses.includes(response.status) && attempt < maxAttempts) {
          const fallbackDelay = retryBaseMs * attempt;
          let retryDelay = fallbackDelay;
          if (response.status === 429) {
            retryDelay = parseRetryAfterMs(response, fallbackDelay);
          }
          retryDelay += Math.floor(Math.random() * 280);

          Logger.warn('NU request retrying due to status', {
            label,
            status: response.status,
            attempt,
            retryDelay
          });
          await sleep(retryDelay);
          continue;
        }

        lastStatus = response.status;
        lastError = new Error(`${label} failed: ${response.status}`);
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          const retryDelay = retryBaseMs * attempt;
          Logger.warn('NU request retrying after network error', {
            label,
            attempt,
            retryDelay,
            error
          });
          await sleep(retryDelay);
          continue;
        }
      }
    }

    if (method === 'GET' && allowIframeFallback && (lastStatus === 429 || (!stopOnForbidden && lastStatus === 403)) && isNuGetPageUrl(url)) {
      Logger.warn('NU request switching to iframe fallback', { label, url, status: lastStatus });
      return fetchTextByIframeNavigation(url, { label: `${label}:iframe`, timeoutMs: iframeTimeoutMs });
    }

    throw lastError || new Error(`${label} failed`);
  };

  const sortReleaseKeys = (releaseKeys) => Array.from(new Set(releaseKeys || [])).sort((a, b) => {
    const ai = Number.parseInt(String(a).replace(/^c/i, ''), 10);
    const bi = Number.parseInt(String(b).replace(/^c/i, ''), 10);
    return ai - bi;
  });

  const extractReleaseKeyFromText = (rawText) => {
    const text = String(rawText || '').trim().toLowerCase();
    if (!text) {
      return null;
    }

    const patterns = [
      /\bc\s*(\d+(?:\.\d+)?)/i,
      /\bchapter\s*(\d+(?:\.\d+)?)/i,
      /\bch\s*(\d+(?:\.\d+)?)/i,
      /\bep(?:isode)?\s*(\d+(?:\.\d+)?)/i
    ];

    for (const pattern of patterns) {
      const matched = text.match(pattern);
      if (matched) {
        return `c${Number.parseInt(matched[1], 10)}`;
      }
    }

    if (/chapter|release|episode|ep\b|ch\b/i.test(text)) {
      const loose = text.match(/\b(\d+)\b/);
      if (loose) {
        return `c${Number.parseInt(loose[1], 10)}`;
      }
    }

    return null;
  };

  const extractReleaseKeysFromHtml = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = [...doc.querySelectorAll('a')];
    const releases = [];

    links.forEach((link) => {
      const candidates = [
        link.textContent || '',
        link.getAttribute('title') || '',
        link.getAttribute('data-title') || ''
      ];

      for (const candidate of candidates) {
        const key = extractReleaseKeyFromText(candidate);
        if (key) {
          releases.push(key);
          break;
        }
      }
    });

    return sortReleaseKeys(releases);
  };

  const extractNuSlugFromHtml = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const canonicalHref = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
    const matched = canonicalHref.match(/\/series\/([^/]+)\/?/i);
    return matched ? matched[1] : '';
  };

  const isNu404Page = (html) => {
    const text = String(html || '');
    return /(error\s*404|page\s*not\s*found|the\s*page\s*you\s*requested\s*could\s*not\s*be\s*found|nothing\s*found)/i.test(text);
  };

  const isLikelyNuSeriesPage = (html) => {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    if (doc.querySelector('#mypostid')) {
      return true;
    }

    if (doc.querySelector('link[rel="canonical"][href*="/series/"]')) {
      const chapterMarkers = [
        '.chp-release',
        '.serieseditimg',
        '#myTable',
        '.serieimg',
        '.seriestitlenu'
      ];
      return chapterMarkers.some((selector) => doc.querySelector(selector));
    }

    return false;
  };

  const resolveScanTarget = async ({ nuSlug, nuSeriesName, novelTitle }) => {
    const queryName = String(nuSeriesName || novelTitle || '').trim();
    const normalizedNuSlug = normalizeNuSlugInput(nuSlug);

    const validated = SyncRules.validateSyncInput({ nuSlug: normalizedNuSlug });
    if (!validated.ok) {
      throw new Error(`${validated.reason}: ${queryName || novelTitle || 'unknown'}`);
    }

    const slugUrl = `https://www.novelupdates.com/series/${validated.normalizedNuSlug}/`;
    const slugHtml = await fetchTextWithRetry(slugUrl, { credentials: 'include' }, {
      label: `series:${validated.normalizedNuSlug}`,
      maxAttempts: 2,
      retryBaseMs: 900,
      stopOnForbidden: true,
      allowIframeFallback: false
    }).then((result) => result.text);

    if (isNu404Page(slugHtml) || !isLikelyNuSeriesPage(slugHtml)) {
      throw new Error(`INVALID_NU_SLUG: ${validated.normalizedNuSlug}`);
    }

    const resolvedSlug = extractNuSlugFromHtml(slugHtml);
    return {
      html: slugHtml,
      source: 'nuSlug',
      seriesId: '',
      nuSlug: resolvedSlug || validated.normalizedNuSlug,
      seriesName: queryName || resolvedSlug || validated.normalizedNuSlug
    };
  };

  const dedupeNovelEntriesById = (entries) => {
    const idEntryMap = new Map();

    entries.forEach(([slug, novel]) => {
      const novelId = novel?.id ? String(novel.id) : `slug:${slug}`;
      const currentScanned = Date.parse(novel?.lastScanned || '') || 0;
      const existing = idEntryMap.get(novelId);

      if (!existing) {
        idEntryMap.set(novelId, { slug, novel, scannedAt: currentScanned });
        return;
      }

      if (currentScanned >= existing.scannedAt) {
        idEntryMap.set(novelId, { slug, novel, scannedAt: currentScanned });
      }
    });

    return [...idEntryMap.values()].map((item) => [item.slug, item.novel]);
  };

  const pickScopedNovelEntries = (data) => {
    const novels = data.novels || {};
    const entries = Object.entries(novels);
    const selectedIds = Array.isArray(data.meta?.selectedNovelIds) ? data.meta.selectedNovelIds : [];

    if (!selectedIds.length) {
      return dedupeNovelEntriesById(entries);
    }

    const selectedSet = new Set(selectedIds.map((id) => String(id)));
    const scoped = entries.filter(([, novel]) => novel?.id && selectedSet.has(String(novel.id)));
    return dedupeNovelEntriesById(scoped);
  };

  const STRICT_PENDING_MODE = true;

  const SyncStatus = Object.freeze({
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED'
  });

  const SyncConfidence = Object.freeze({
    HIGH: 'HIGH',
    LOW: 'LOW'
  });

  const SyncReason = Object.freeze({
    NONE: 'NONE',
    MISSING_NU_SLUG: 'MISSING_NU_SLUG',
    SHOW_ALL_UNAVAILABLE: 'SHOW_ALL_UNAVAILABLE',
    RUN_BLOCKED: 'RUN_BLOCKED',
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    WAF_BLOCKED: 'WAF_BLOCKED',
    MAPPING_INVALID: 'MAPPING_INVALID',
    PARSER_DRIFT: 'PARSER_DRIFT',
    TEMP_NETWORK: 'TEMP_NETWORK'
  });

  const ensureSyncDiagnosticsMap = (data) => {
    data.meta = data.meta || {};
    data.meta.syncDiagnostics = data.meta.syncDiagnostics && typeof data.meta.syncDiagnostics === 'object'
      ? data.meta.syncDiagnostics
      : {};
    return data.meta.syncDiagnostics;
  };

  const readNuwafCooldownState = async () => {
    const untilText = String(await Storage.getPath(NU_WAF_COOLDOWN_PATH, '') || '').trim();
    const reason = String(await Storage.getPath(NU_WAF_COOLDOWN_REASON_PATH, '') || '').trim();
    const untilTs = Date.parse(untilText);
    if (!untilText || Number.isNaN(untilTs)) {
      return {
        active: false,
        untilText: '',
        untilTs: 0,
        reason
      };
    }

    return {
      active: untilTs > Date.now(),
      untilText,
      untilTs,
      reason
    };
  };

  const clearNuwafCooldown = async () => {
    await Storage.update(NU_WAF_COOLDOWN_PATH, '');
    await Storage.update(NU_WAF_COOLDOWN_REASON_PATH, '');
  };

  const activateNuwafCooldown = async ({ reason = SyncReason.WAF_BLOCKED, minutes = NU_WAF_COOLDOWN_MINUTES } = {}) => {
    const spanMinutes = Math.max(1, Number.parseInt(minutes, 10) || NU_WAF_COOLDOWN_MINUTES);
    const until = new Date(Date.now() + spanMinutes * 60 * 1000).toISOString();
    await Storage.update(NU_WAF_COOLDOWN_PATH, until);
    await Storage.update(NU_WAF_COOLDOWN_REASON_PATH, String(reason || SyncReason.WAF_BLOCKED));
    return until;
  };

  const formatCooldownRemain = (untilTs) => {
    const remainMs = Math.max(0, untilTs - Date.now());
    const remainMin = Math.ceil(remainMs / 60000);
    return `${remainMin} 分钟`;
  };

  const isHighConfidenceSync = (diag) => {
    if (!diag || typeof diag !== 'object') {
      return false;
    }
    return diag.status === SyncStatus.SUCCESS && diag.confidence === SyncConfidence.HIGH;
  };

  const classifySyncReasonByError = (error, fallbackReason = SyncReason.TEMP_NETWORK) => {
    const text = String(error?.message || error || '').toLowerCase();
    if (!text) {
      return fallbackReason;
    }
    if (/missing_nu_slug/.test(text)) {
      return SyncReason.MISSING_NU_SLUG;
    }
    if (/show_all_unavailable/.test(text)) {
      return SyncReason.SHOW_ALL_UNAVAILABLE;
    }
    if (/invalid_nu_slug|series not found|failed: 404/.test(text)) {
      return SyncReason.MAPPING_INVALID;
    }
    if (/403|forbidden|cloudflare|access denied|captcha|blocked/.test(text)) {
      return SyncReason.WAF_BLOCKED;
    }
    if (/401|unauthorized|login|sign in|logged in/.test(text)) {
      return SyncReason.AUTH_REQUIRED;
    }
    if (/timeout|network|failed to fetch|429|502|503|504/.test(text)) {
      return SyncReason.TEMP_NETWORK;
    }
    return fallbackReason;
  };

  const classifySyncReasonBySeriesHtml = (html) => {
    const raw = String(html || '');
    const text = raw.toLowerCase();
    if (!text.trim()) {
      return SyncReason.PARSER_DRIFT;
    }
    if (isNu404Page(raw)) {
      return SyncReason.MAPPING_INVALID;
    }
    const hasNuPostId = Boolean(new DOMParser().parseFromString(raw, 'text/html').querySelector('#mypostid'));
    if (!hasNuPostId && /(403\s*forbidden|access denied|cloudflare|cf-ray|cf-chl|attention required)/i.test(text)) {
      return SyncReason.WAF_BLOCKED;
    }
    if (/login|log in|sign in|register|lost password|wp-login/i.test(text) && !isLikelyNuSeriesPage(raw)) {
      return SyncReason.AUTH_REQUIRED;
    }
    return SyncReason.NONE;
  };

  const reasonLabel = (reason) => {
    switch (reason) {
      case SyncReason.MISSING_NU_SLUG:
        return '未配置 NU Slug';
      case SyncReason.SHOW_ALL_UNAVAILABLE:
        return '无法获取 Show All Chapters';
      case SyncReason.RUN_BLOCKED:
        return '本轮同步被阻断';
      case SyncReason.AUTH_REQUIRED:
        return '登录态失效';
      case SyncReason.WAF_BLOCKED:
        return '触发站点风控';
      case SyncReason.MAPPING_INVALID:
        return '系列映射无效';
      case SyncReason.PARSER_DRIFT:
        return '页面结构变化';
      case SyncReason.TEMP_NETWORK:
        return '临时网络异常';
      case SyncReason.NONE:
      default:
        return '正常';
    }
  };

  const extractSeriesAjaxMeta = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const readValue = (selector) => {
      const element = doc.querySelector(selector);
      if (!element) {
        return '';
      }
      return (element.getAttribute('value') || element.value || '').trim();
    };

    return {
      postId: readValue('#mypostid'),
      groupFilter: readValue('#mygrpfilter'),
      groupId: readValue('#grr_groups') || '0'
    };
  };

  const fetchAllChapterListingHtml = async (ajaxMeta) => {
    if (!ajaxMeta?.postId) {
      return '';
    }

    const form = new URLSearchParams();
    form.set('action', 'nd_getchapters');
    form.set('mypostid', ajaxMeta.postId);
    form.set('mygrpfilter', ajaxMeta.groupFilter || '');
    form.set('mygrr', ajaxMeta.groupId || '0');

    const result = await fetchTextWithRetry('https://www.novelupdates.com/wp-admin/admin-ajax.php', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: form.toString()
    }, {
      label: 'nd_getchapters',
      maxAttempts: 2,
      retryBaseMs: 900,
      stopOnForbidden: true,
      allowIframeFallback: false
    });

    const payload = result.text;
    return payload.endsWith('0') ? payload.slice(0, -1) : payload;
  };

  const hasExplicitNoReleaseHint = (html) => {
    const text = String(new DOMParser().parseFromString(String(html || ''), 'text/html').body?.textContent || '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
    return /(no\s+(chapters?|releases?)\s*(found|yet|available)?|there\s+are\s+no\s+(chapters?|releases?))/i.test(text);
  };

  const scanNovelSeries = async ({ novelSlug, nuSlug, nuSeriesName, novelTitle }) => {
    const startedAt = Date.now();
    const scannedAt = new Date().toISOString();
    const queryName = String(nuSeriesName || novelTitle || '').trim();

    try {
      const target = await resolveScanTarget({ nuSlug, nuSeriesName, novelTitle });
      const html = String(target.html || '');
      const resolvedNuSlug = target.nuSlug || nuSlug || '';
      const htmlReason = classifySyncReasonBySeriesHtml(html);

      if (htmlReason !== SyncReason.NONE) {
        return {
          novelSlug,
          seriesName: target.seriesName || queryName || resolvedNuSlug,
          resolvedNuSlug,
          source: target.source || 'unknown',
          status: SyncStatus.FAILED,
          confidence: SyncConfidence.LOW,
          reasonCode: htmlReason,
          releases: [],
          scannedAt,
          durationMs: Date.now() - startedAt,
          message: `series page invalid: ${htmlReason}`
        };
      }

      const ajaxMeta = extractSeriesAjaxMeta(html);
      if (!ajaxMeta.postId) {
        return {
          novelSlug,
          seriesName: target.seriesName || queryName || resolvedNuSlug,
          resolvedNuSlug,
          source: target.source || 'unknown',
          status: SyncStatus.FAILED,
          confidence: SyncConfidence.LOW,
          reasonCode: SyncReason.SHOW_ALL_UNAVAILABLE,
          releases: [],
          scannedAt,
          durationMs: Date.now() - startedAt,
          message: 'show_all_unavailable: missing ajax postId'
        };
      }

      let listingHtml = '';
      try {
        await sleepNuIntraSeriesGap();
        listingHtml = await fetchAllChapterListingHtml(ajaxMeta);
      } catch (error) {
        Logger.warn('scan show-all chapters failed', resolvedNuSlug, error);
        return {
          novelSlug,
          seriesName: target.seriesName || queryName || resolvedNuSlug,
          resolvedNuSlug,
          source: target.source || 'unknown',
          status: SyncStatus.FAILED,
          confidence: SyncConfidence.LOW,
          reasonCode: classifySyncReasonByError(error, SyncReason.SHOW_ALL_UNAVAILABLE),
          releases: [],
          scannedAt,
          durationMs: Date.now() - startedAt,
          message: String(error?.message || error || 'show_all_unavailable: fetch failed')
        };
      }

      const releases = SyncRules.sortReleaseKeys(extractReleaseKeysFromHtml(listingHtml));
      if (!releases.length && !hasExplicitNoReleaseHint(listingHtml)) {
        return {
          novelSlug,
          seriesName: target.seriesName || queryName || resolvedNuSlug,
          resolvedNuSlug,
          source: target.source || 'unknown',
          status: SyncStatus.FAILED,
          confidence: SyncConfidence.LOW,
          reasonCode: SyncReason.PARSER_DRIFT,
          releases: [],
          scannedAt,
          durationMs: Date.now() - startedAt,
          message: 'no release parsed from show-all payload'
        };
      }

      return {
        novelSlug,
        seriesName: target.seriesName || queryName || resolvedNuSlug,
        resolvedNuSlug,
        source: target.source || 'unknown',
        status: SyncStatus.SUCCESS,
        confidence: SyncConfidence.HIGH,
        reasonCode: SyncReason.NONE,
        releases,
        scannedAt,
        durationMs: Date.now() - startedAt,
        message: 'show-all parsed'
      };
    } catch (error) {
      return {
        novelSlug,
        seriesName: queryName || nuSlug || novelSlug,
        resolvedNuSlug: normalizeNuSlugInput(nuSlug),
        source: 'resolveScanTarget',
        status: SyncStatus.FAILED,
        confidence: SyncConfidence.LOW,
        reasonCode: classifySyncReasonByError(error, SyncReason.TEMP_NETWORK),
        releases: [],
        scannedAt,
        durationMs: Date.now() - startedAt,
        message: String(error?.message || error || 'scan failed')
      };
    }
  };

  const syncPublishedStatus = async () => {
    const data = await ensureNovelDataLoaded();
    const configs = data.novelConfigs || {};
    const scopedEntries = pickScopedNovelEntries(data);
    const slugs = scopedEntries.map(([slug]) => slug);

    if (!slugs.length) {
      UI.toast('未发现私域小说数据，请先在 Fox 页面执行扫描后再同步', 'warn', 4200);
      return;
    }

    const cooldown = await readNuwafCooldownState();
    if (cooldown.active) {
      UI.toast(`检测到近期风控记录（剩余约 ${formatCooldownRemain(cooldown.untilTs)}），本次将继续尝试同步`, 'warn', 5200);
    }

    const diagnostics = ensureSyncDiagnosticsMap(data);
    const runId = new Date().toISOString();
    const reasonStats = {};
    const scanResults = [];
    const scannedSlugs = new Set();
    let abortedByWaf = false;
    let cooldownUntilText = '';

    const preflightEntry = scopedEntries.find(([slug]) => {
      const config = configs[slug] || {};
      const nuSlug = normalizeNuSlugInput(config.nuSlug || '');
      return SyncRules.validateSyncInput({ nuSlug }).ok;
    });
    const preflightReportsBySlug = new Map();

    if (preflightEntry) {
      const [preSlug, preNovel] = preflightEntry;
      const preConfig = configs[preSlug] || {};
      const preNuSlug = normalizeNuSlugInput(preConfig.nuSlug || '');
      const preReport = await scanNovelSeries({
        novelSlug: preSlug,
        nuSlug: preNuSlug,
        nuSeriesName: preConfig.nuSeriesName || preNovel.title,
        novelTitle: preNovel.title
      });
      preflightReportsBySlug.set(preSlug, preReport);

      if (preReport.reasonCode === SyncReason.WAF_BLOCKED) {
        abortedByWaf = true;
        cooldownUntilText = await activateNuwafCooldown({ reason: SyncReason.WAF_BLOCKED });
        reasonStats[SyncReason.WAF_BLOCKED] = (reasonStats[SyncReason.WAF_BLOCKED] || 0) + 1;
        diagnostics[preSlug] = {
          runId,
          status: preReport.status,
          confidence: preReport.confidence,
          reasonCode: preReport.reasonCode,
          source: preReport.source,
          resolvedNuSlug: preReport.resolvedNuSlug || '',
          releaseCount: Array.isArray(preReport.releases) ? preReport.releases.length : 0,
          scannedAt: preReport.scannedAt || new Date().toISOString(),
          durationMs: preReport.durationMs || 0,
          message: preReport.message || 'preflight failed'
        };
        scanResults.push({
          slug: preSlug,
          novel: preNovel,
          config: preConfig,
          unlockedKeys: [],
          report: preReport
        });
        scannedSlugs.add(preSlug);
      } else {
        await clearNuwafCooldown();
      }
    }

    for (const [slug, novel] of scopedEntries) {
      if (abortedByWaf) {
        break;
      }
      if (scannedSlugs.has(slug)) {
        continue;
      }

      const config = configs[slug] || {};
      const nuSlug = normalizeNuSlugInput(config.nuSlug || '');
      const inputCheck = SyncRules.validateSyncInput({ nuSlug });
      const unlockedKeys = SyncRules.sortReleaseKeys((novel.chapters || [])
        .filter((chapter) => chapter?.unlocked && chapter?.index)
        .map((chapter) => toReleaseKey(chapter.index)));

      let report;
      if (!inputCheck.ok) {
        report = {
          novelSlug: slug,
          seriesName: config.nuSeriesName || novel.title || slug,
          resolvedNuSlug: '',
          source: 'config',
          status: SyncStatus.FAILED,
          confidence: SyncConfidence.LOW,
          reasonCode: SyncReason.MISSING_NU_SLUG,
          releases: [],
          scannedAt: new Date().toISOString(),
          durationMs: 0,
          message: 'missing nuSlug in mapping config'
        };
      } else {
        report = preflightReportsBySlug.get(slug);
        if (!report) {
          report = await scanNovelSeries({
            novelSlug: slug,
            nuSlug: inputCheck.normalizedNuSlug,
            nuSeriesName: config.nuSeriesName || novel.title,
            novelTitle: novel.title
          });
        }
      }

      const reasonCode = report.reasonCode || SyncReason.NONE;
      if (reasonCode !== SyncReason.NONE) {
        reasonStats[reasonCode] = (reasonStats[reasonCode] || 0) + 1;
      }

      diagnostics[slug] = {
        runId,
        status: report.status,
        confidence: report.confidence,
        reasonCode,
        source: report.source,
        resolvedNuSlug: report.resolvedNuSlug || '',
        releaseCount: Array.isArray(report.releases) ? report.releases.length : 0,
        scannedAt: report.scannedAt || new Date().toISOString(),
        durationMs: report.durationMs || 0,
        message: report.message || ''
      };

      if (report.status === SyncStatus.SUCCESS && report.confidence === SyncConfidence.HIGH) {
        const pendingKeys = SyncRules.buildPendingReleaseKeys({
          unlockedKeys,
          publishedKeys: report.releases || []
        });
        UI.toast(`扫描 ${slug} 完成：已解锁 ${unlockedKeys.length} / 已发布 ${(report.releases || []).length} / 待发布 ${pendingKeys.length}`, 'info', 4600);
      } else {
        UI.toast(`扫描失败：${slug}（${reasonLabel(reasonCode)}）`, 'error', 5600);
      }

      scanResults.push({ slug, novel, config, unlockedKeys, report });
      scannedSlugs.add(slug);

      if (reasonCode === SyncReason.WAF_BLOCKED) {
        abortedByWaf = true;
        cooldownUntilText = await activateNuwafCooldown({ reason: SyncReason.WAF_BLOCKED });
        break;
      }

      if (scannedSlugs.size < scopedEntries.length) {
        await sleepNuSeriesGap();
      }
    }

    if (abortedByWaf) {
      scopedEntries.forEach(([slug, novel]) => {
        if (scannedSlugs.has(slug)) {
          return;
        }
        const config = configs[slug] || {};
        const runBlockedReport = {
          novelSlug: slug,
          seriesName: config.nuSeriesName || novel.title || slug,
          resolvedNuSlug: normalizeNuSlugInput(config.nuSlug || ''),
          source: 'sync',
          status: SyncStatus.FAILED,
          confidence: SyncConfidence.LOW,
          reasonCode: SyncReason.RUN_BLOCKED,
          releases: [],
          scannedAt: new Date().toISOString(),
          durationMs: 0,
          message: 'scan skipped due to earlier waf block'
        };
        diagnostics[slug] = {
          runId,
          status: runBlockedReport.status,
          confidence: runBlockedReport.confidence,
          reasonCode: runBlockedReport.reasonCode,
          source: runBlockedReport.source,
          resolvedNuSlug: runBlockedReport.resolvedNuSlug || '',
          releaseCount: 0,
          scannedAt: runBlockedReport.scannedAt,
          durationMs: 0,
          message: runBlockedReport.message
        };
        reasonStats[SyncReason.RUN_BLOCKED] = (reasonStats[SyncReason.RUN_BLOCKED] || 0) + 1;
        scanResults.push({
          slug,
          novel,
          config,
          unlockedKeys: [],
          report: runBlockedReport
        });
      });
    }

    const blocked = SyncRules.shouldBlockRun(scanResults.map((item) => ({
      slug: item.slug,
      ok: item.report.status === SyncStatus.SUCCESS && item.report.confidence === SyncConfidence.HIGH,
      reason: item.report.reasonCode
    })));

    let persisted = 0;
    let success = 0;
    let failed = 0;
    if (!blocked) {
      data.publishedReleases = data.publishedReleases || {};
      scanResults.forEach((item) => {
        const { slug, config, report } = item;
        if (!(report.status === SyncStatus.SUCCESS && report.confidence === SyncConfidence.HIGH)) {
          failed += 1;
          return;
        }

        data.publishedReleases[slug] = {
          ...(data.publishedReleases[slug] || {}),
          nuSlug: report.resolvedNuSlug || normalizeNuSlugInput(config.nuSlug || ''),
          lastScanned: report.scannedAt || new Date().toISOString(),
          releases: SyncRules.sortReleaseKeys(report.releases || [])
        };
        if (report.resolvedNuSlug && report.resolvedNuSlug !== config.nuSlug) {
          data.novelConfigs = data.novelConfigs || {};
          data.novelConfigs[slug] = {
            ...(data.novelConfigs[slug] || {}),
            ...config,
            nuSlug: report.resolvedNuSlug
          };
        }
        persisted += 1;
        success += 1;
      });
    } else {
      failed = scanResults.length;
    }

    data.meta = data.meta || {};
    data.meta.lastSyncRunId = runId;
    data.meta.lastSyncMode = STRICT_PENDING_MODE ? 'strict' : 'legacy';
    data.meta.lastSyncFinishedAt = new Date().toISOString();
    data.meta.lastSyncBlocked = blocked;
    data.meta.lastSyncBlockedAt = blocked ? new Date().toISOString() : null;
    data.meta.lastSyncAbortByWaf = abortedByWaf;
    data.meta.lastSyncCooldownUntil = cooldownUntilText || '';
    await Storage.set(data);

    const reasonSummary = Object.entries(reasonStats)
      .map(([code, count]) => `${code}:${count}`)
      .join(', ');
    Logger.info('sync published summary', {
      runId,
      blocked,
      abortedByWaf,
      success,
      failed,
      persisted,
      reasonStats
    });

    const summaryText = blocked
      ? `同步阻断：${scanResults.length} 本中存在失败，已停止落盘并清空待发布候选`
      : `同步完成：成功 ${success} / 失败 ${failed} / 已落盘 ${persisted}`;
    const cooldownNote = abortedByWaf && cooldownUntilText
      ? `，风控冷却至 ${new Date(cooldownUntilText).toLocaleTimeString()}`
      : '';
    if (abortedByWaf) {
      UI.toast(`触发站点风控，已立即停止本轮${cooldownNote}`, 'error', 7200);
    }
    UI.toast(reasonSummary ? `${summaryText}${cooldownNote}（${reasonSummary}）` : `${summaryText}${cooldownNote}`, blocked ? 'error' : 'info', 6400);

    if (isAddReleasePage()) {
      renderPendingPanel().catch((error) => Logger.error('refresh pending panel failed', error));
    }
  };

  const buildPendingList = async () => {
    const data = await ensureNovelDataLoaded();
    const configs = data.novelConfigs || {};
    const published = data.publishedReleases || {};
    const diagnostics = ensureSyncDiagnosticsMap(data);
    const scopedEntries = pickScopedNovelEntries(data);
    const globalBlocked = Boolean(data.meta?.lastSyncBlocked);

    if (STRICT_PENDING_MODE && globalBlocked) {
      return [];
    }

    const pending = [];

    scopedEntries.forEach(([slug, novel]) => {
      if (STRICT_PENDING_MODE) {
        const diag = diagnostics[slug];
        if (!isHighConfidenceSync(diag)) {
          return;
        }
      }

      const config = configs[slug] || {};
      const unlockedKeys = (novel.chapters || [])
        .filter((chapter) => chapter?.unlocked && chapter?.index)
        .map((chapter) => toReleaseKey(chapter.index));
      const pendingKeys = new Set(SyncRules.buildPendingReleaseKeys({
        unlockedKeys,
        publishedKeys: published[slug]?.releases || []
      }));

      (novel.chapters || []).forEach((chapter) => {
        if (!chapter.unlocked) {
          return;
        }
        const releaseKey = SyncRules.normalizeReleaseKey(toReleaseKey(chapter.index));
        if (!pendingKeys.has(releaseKey)) {
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

  const pickFirstElement = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        return el;
      }
    }
    return null;
  };

  const readFirstValue = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) {
        continue;
      }
      const value = String(el.value || '').trim();
      if (value) {
        return value;
      }
    }
    return '';
  };

  const normalizeText = (value) => String(value || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizeLookupQuery = (value) => String(value || '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const isVisibleElement = (el) => {
    if (!el) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const fillNuAutocompleteField = async ({
    inputSelectors,
    hiddenSelectors = [],
    searchText,
    fieldType,
    timeout = 7000,
    interval = 120
  }) => {
    const query = String(searchText || '').trim();
    if (!query) {
      return false;
    }

    const queryForSearch = normalizeLookupQuery(query);

    const input = pickFirstElement(inputSelectors);
    if (!input) {
      throw new Error(`NU input not found: ${inputSelectors.join(', ')}`);
    }

    const readHiddenValue = () => readFirstValue(hiddenSelectors);
    const currentHidden = readHiddenValue();
    if (normalizeText(input.value) === normalizeText(query) && currentHidden) {
      return true;
    }

    input.focus();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(40);

    input.value = queryForSearch;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const idMatch = String(input.id || '').match(/_(\d+)$/);
    const showResultParam = idMatch?.[1] || '100';
    const canCallShowResult = typeof window.showResult === 'function' && (fieldType === 'series' || fieldType === 'group');

    const dropdownSelector = '.change_list, .livesearchresult > div, .livesearchgroup > div, .livesearch > div, .dropdown-item, .select2-results__option';
    const startedAt = Date.now();
    let didRetryWithShowResult = false;
    let didRetryWithRawQuery = false;

    while (Date.now() - startedAt < timeout) {
      if (readHiddenValue()) {
        return true;
      }

      const options = [...document.querySelectorAll(dropdownSelector)].filter((item) => {
        const text = String(item.textContent || '').trim();
        if (!text || /loading/i.test(text)) {
          return false;
        }
        if (item.classList?.contains('change_list')) {
          return true;
        }
        return isVisibleElement(item);
      });

      if (options.length > 0) {
        const matcher = normalizeTitleKey(queryForSearch || query);
        const target = options.find((item) => normalizeTitleKey(item.textContent || '') === matcher)
          || options.find((item) => {
            const candidate = normalizeTitleKey(item.textContent || '');
            return candidate && matcher && (candidate.includes(matcher) || matcher.includes(candidate));
          })
          || options[0];

        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        target.click();
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        const onclickText = target.getAttribute('onclick') || '';
        const changeMatch = onclickText.match(/changeitem\('([^']+)','([^']+)','([^']+)'/i);
        if (changeMatch && typeof window.changeitem === 'function') {
          window.changeitem(changeMatch[1], changeMatch[2], changeMatch[3], target);
        }

        const clickStartedAt = Date.now();
        while (Date.now() - clickStartedAt < 700) {
          if (!hiddenSelectors.length || readHiddenValue()) {
            return true;
          }
          await sleep(80);
        }
      }

      if (!didRetryWithShowResult && canCallShowResult && Date.now() - startedAt > 900) {
        window.showResult(queryForSearch || query, showResultParam, fieldType);
        didRetryWithShowResult = true;
      }

      if (!didRetryWithRawQuery && canCallShowResult && queryForSearch !== query && Date.now() - startedAt > 1700) {
        window.showResult(query, showResultParam, fieldType);
        didRetryWithRawQuery = true;
      }

      await sleep(interval);
    }

    return !hiddenSelectors.length ? true : Boolean(readHiddenValue());
  };

  const fillReleaseForm = async (item) => {
    try {
      const seriesFilled = await fillNuAutocompleteField({
        inputSelectors: ['#title_change_100', 'input[name="series"]', 'input#series', 'input.select2-search__field'],
        hiddenSelectors: ['#title100', 'input[name="artitle"]'],
        searchText: item.nuSeriesName,
        fieldType: 'series',
        timeout: 8000
      });

      if (!seriesFilled) {
        throw new Error('series livesearch not matched');
      }
    } catch (error) {
      Logger.warn('fill series by dropdown failed, fallback to plain input', error);
      fillBySelectors(['#title_change_100', 'input[name="series"]', 'input#series'], item.nuSeriesName);
    }

    fillBySelectors(['#arrelease', 'input[name="arrelease"]', 'input[name="release"]', '#release'], item.releaseText);
    fillBySelectors(['#arlink', 'input[name="arlink"]', 'input[name="url"]', 'input[name="link"]', '#link'], item.link);

    await sleep(320);

    const hasGroupName = Boolean(String(item.nuGroupName || '').trim());

    if (hasGroupName) {
      try {
        const groupFilled = await fillNuAutocompleteField({
          inputSelectors: ['#group_change_100', 'input[name="group"]', 'input#group', 'input.select2-search__field'],
          hiddenSelectors: ['#group100', 'input[name="argroup"]'],
          searchText: item.nuGroupName,
          fieldType: 'group',
          timeout: 8000
        });

        if (!groupFilled) {
          throw new Error('group livesearch not matched');
        }
      } catch (error) {
        Logger.warn('fill group by dropdown failed, fallback to plain input', error);
        fillBySelectors(['#group_change_100', 'input[name="group"]', '#group'], item.nuGroupName);
      }
    } else {
      UI.toast('未配置 NU Group 名称，请手动选择 Group', 'warn', 3800);
    }

    const seriesHiddenValue = readFirstValue(['#title100', 'input[name="artitle"]']);
    const groupHiddenValue = hasGroupName ? readFirstValue(['#group100', 'input[name="argroup"]']) : '';

    if (!seriesHiddenValue) {
      UI.toast('Series 可能未命中候选，请手动点选 Series 后再提交', 'warn', 5000);
    }

    if (hasGroupName && !groupHiddenValue) {
      UI.toast('Group 可能未命中候选，请手动点选 Group 后再提交', 'warn', 5000);
    }

    const canSubmit = Boolean(seriesHiddenValue) && (!hasGroupName || Boolean(groupHiddenValue));
    if (canSubmit) {
      UI.toast(`已填充：${item.novelTitle} ${item.releaseText}，请点击 Submit，提交后点“同步已发布”确认`, 'info', 5600);
    } else {
      UI.toast('已填充但 Series/Group 可能未命中，请手动检查后再提交', 'warn', 5600);
    }

    if (isAddReleasePage()) {
      renderPendingPanel().catch((error) => Logger.error('refresh pending panel after fill failed', error));
    }
  };

  const renderPendingPanel = async () => {
    const pending = await buildPendingList();

    [...document.querySelectorAll('[data-synnovel-panel="pending"]')].forEach((panel) => panel.remove());

    if (pendingPanelRef?.isConnected) {
      pendingPanelRef.remove();
    }

    const panel = UI.createFloatingPanel({
      title: `待发布章节 (${pending.length})`,
      actions: [
        { label: '🔄 刷新状态', onClick: () => renderPendingPanel() },
        { label: '🧲 拉取私域', onClick: () => importDataFromFoxBridge().then(() => renderPendingPanel()) },
        { label: '📡 同步已发布', primary: true, onClick: () => syncPublishedStatus() }
      ]
    });
    panel.dataset.synnovelPanel = 'pending';
    pendingPanelRef = panel;

    const listWrap = document.createElement('div');
    listWrap.style.marginTop = '8px';
    listWrap.style.maxHeight = '280px';
    listWrap.style.overflow = 'auto';

    if (!pending.length) {
      const empty = document.createElement('div');
      empty.textContent = STRICT_PENDING_MODE
        ? '暂无待发布章节（严格模式仅展示高可信同步结果，请先点击“同步已发布”）'
        : '暂无待发布章节';
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

    await importDataFromFoxBridge({ silent: true });

    if (isAddReleasePage()) {
      renderPendingPanel().catch((error) => Logger.error('init add release panel failed', error));
    }
  };

  bootstrap().catch((error) => {
    console.error('[SynNovel] bootstrap failed', error);
  });
})();
