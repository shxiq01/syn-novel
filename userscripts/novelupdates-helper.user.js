// ==UserScript==
// @name         NovelUpdates Release Helper
// @namespace    https://github.com/shixq/syn-novel
// @version      1.3.4
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
  let pendingPanelRef = null;
  let commonPanelRef = null;

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

  const PENDING_SUBMIT_PATH = 'meta.pendingSubmit';

  const toPendingSubmitToken = (payload) => {
    if (!payload?.slug || !payload?.releaseKey) {
      return '';
    }
    return `${payload.slug}:${String(payload.releaseKey).toLowerCase()}`;
  };

  const readPendingSubmit = async () => {
    const pending = await Storage.getPath(PENDING_SUBMIT_PATH, null);
    if (!pending || typeof pending !== 'object') {
      return null;
    }

    const slug = String(pending.slug || '').trim();
    const releaseKey = String(pending.releaseKey || '').trim().toLowerCase();
    if (!slug || !releaseKey) {
      return null;
    }

    return {
      ...pending,
      slug,
      releaseKey
    };
  };

  const setPendingSubmit = async (item) => {
    const payload = {
      slug: String(item?.slug || '').trim(),
      releaseKey: String(item?.releaseKey || '').trim().toLowerCase(),
      releaseText: String(item?.releaseText || '').trim(),
      novelTitle: String(item?.novelTitle || '').trim(),
      at: new Date().toISOString()
    };

    if (!payload.slug || !payload.releaseKey) {
      return null;
    }

    await Storage.update(PENDING_SUBMIT_PATH, payload);
    return payload;
  };

  const clearPendingSubmit = async () => {
    await Storage.update(PENDING_SUBMIT_PATH, null);
  };

  const hasSubmitSuccessHint = () => {
    const params = new URLSearchParams(location.search || '');
    const successParamMatched = ['success', 'submitted', 'result', 'status']
      .map((key) => String(params.get(key) || '').toLowerCase())
      .some((value) => ['1', 'true', 'ok', 'done', 'success', 'submitted'].includes(value));

    if (successParamMatched) {
      return true;
    }

    const selectors = [
      '.alert-success',
      '.notice-success',
      '.updated',
      '.message.success',
      '#message',
      '.entry-content .alert',
      '.entry-content .notice',
      '.entry-content .updated'
    ];

    const textSegments = selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .map((node) => String(node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const bodyText = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    textSegments.push(bodyText.slice(0, 2000));

    const successPattern = /(release.{0,60}(submitted|added|accepted|received)|thank\s*you.{0,40}(submission|release)|successfully.{0,40}(submitted|added))/i;
    const errorPattern = /(required|invalid|error|failed|duplicate|already\s+exist)/i;

    return textSegments.some((segment) => successPattern.test(segment) && !errorPattern.test(segment));
  };

  const reconcilePendingSubmitAfterSuccess = async () => {
    if (!isAddReleasePage()) {
      return false;
    }

    const pendingSubmit = await readPendingSubmit();
    if (!pendingSubmit) {
      return false;
    }

    const pendingAt = Date.parse(pendingSubmit.at || '');
    if (pendingAt && Date.now() - pendingAt > 12 * 60 * 60 * 1000) {
      await clearPendingSubmit();
      return false;
    }

    if (!hasSubmitSuccessHint()) {
      return false;
    }

    await Storage.addPublishedRelease(pendingSubmit.slug, pendingSubmit.releaseKey);
    await clearPendingSubmit();
    UI.toast(`提交成功，已移除：${pendingSubmit.novelTitle || pendingSubmit.slug} ${pendingSubmit.releaseText || pendingSubmit.releaseKey}`, 'info', 5200);
    return true;
  };

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

  const parseSeriesSearchCandidates = (html, queryText) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const queryKey = normalizeTitleKey(queryText);

    const candidates = [...doc.querySelectorAll('.change_list')].map((node) => {
      const text = (node.textContent || '').trim();
      const onclick = node.getAttribute('onclick') || '';
      const matched = onclick.match(/changeitem\('\d+','(\d+)','title'/i);
      return {
        text,
        textKey: normalizeTitleKey(text),
        seriesId: matched ? matched[1] : ''
      };
    }).filter((item) => item.seriesId);

    if (!candidates.length) {
      return null;
    }

    const exact = candidates.find((item) => item.textKey === queryKey);
    if (exact) {
      return exact;
    }

    const contains = candidates.find((item) => {
      if (!item.textKey || !queryKey) {
        return false;
      }
      if (queryKey.length < 6 || item.textKey.length < 6) {
        return false;
      }
      return item.textKey.includes(queryKey) || queryKey.includes(item.textKey);
    });

    return contains || null;
  };

  const resolveSeriesInfoByName = async (seriesName) => {
    const keyword = String(seriesName || '').trim();
    if (!keyword) {
      return null;
    }

    const form = new URLSearchParams();
    form.set('action', 'nd_ajaxsearch');
    form.set('str', keyword);
    form.set('strID', '100');
    form.set('strType', 'series');

    const response = await fetch('https://www.novelupdates.com/wp-admin/admin-ajax.php', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: form.toString()
    });

    if (!response.ok) {
      throw new Error(`nd_ajaxsearch failed: ${response.status}`);
    }

    const payload = await response.text();
    const html = payload.endsWith('0') ? payload.slice(0, -1) : payload;
    return parseSeriesSearchCandidates(html, keyword);
  };

  const extractNuSlugFromHtml = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const canonicalHref = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
    const matched = canonicalHref.match(/\/series\/([^/]+)\/?/i);
    return matched ? matched[1] : '';
  };

  const isNu404Page = (html) => /Error\s*404\s*-\s*page\s*not\s*found/i.test(String(html || ''));

  const resolveScanTarget = async ({ nuSlug, nuSeriesName, novelTitle }) => {
    const queryName = String(nuSeriesName || novelTitle || '').trim();

    if (nuSlug) {
      try {
        const slugUrl = `https://www.novelupdates.com/series/${nuSlug}/`;
        const slugHtml = await fetch(slugUrl, { credentials: 'include' }).then((r) => r.text());
        if (!isNu404Page(slugHtml)) {
          const resolvedSlug = extractNuSlugFromHtml(slugHtml);
          return {
            html: slugHtml,
            source: 'nuSlug',
            seriesId: '',
            nuSlug: resolvedSlug || nuSlug,
            seriesName: queryName || nuSlug
          };
        }
      } catch (error) {
        Logger.warn('resolve series by nuSlug failed, fallback to name', nuSlug, error);
      }
    }

    if (queryName) {
      try {
        const matched = await resolveSeriesInfoByName(queryName);
        if (matched?.seriesId) {
          const detailUrl = `https://www.novelupdates.com/?p=${matched.seriesId}`;
          const detailHtml = await fetch(detailUrl, { credentials: 'include' }).then((r) => r.text());
          if (!isNu404Page(detailHtml)) {
            const resolvedSlug = extractNuSlugFromHtml(detailHtml);
            return {
              html: detailHtml,
              source: 'nd_ajaxsearch',
              seriesId: matched.seriesId,
              nuSlug: resolvedSlug || nuSlug || '',
              seriesName: matched.text || queryName
            };
          }
        }
      } catch (error) {
        Logger.warn('resolve series by name failed', queryName, error);
      }
    }

    throw new Error(`unable to resolve NU series: ${queryName || nuSlug || novelTitle || 'unknown'}`);
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

    const response = await fetch('https://www.novelupdates.com/wp-admin/admin-ajax.php', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: form.toString()
    });

    if (!response.ok) {
      throw new Error(`nd_getchapters failed: ${response.status}`);
    }

    const payload = await response.text();
    return payload.endsWith('0') ? payload.slice(0, -1) : payload;
  };

  const scanNovelSeries = async ({ novelSlug, nuSlug, nuSeriesName, novelTitle }) => {
    const target = await resolveScanTarget({ nuSlug, nuSeriesName, novelTitle });
    const html = target.html;
    const releasesFromPage = extractReleaseKeysFromHtml(html);

    let releasesFromShowAll = [];
    const ajaxMeta = extractSeriesAjaxMeta(html);
    if (ajaxMeta.postId) {
      try {
        const listingHtml = await fetchAllChapterListingHtml(ajaxMeta);
        releasesFromShowAll = extractReleaseKeysFromHtml(listingHtml);
      } catch (error) {
        Logger.warn('scan show-all chapters failed, fallback to page table', target.nuSlug || nuSlug, error);
      }
    }

    const releases = sortReleaseKeys([...releasesFromPage, ...releasesFromShowAll]);

    if (!releases.length && isNu404Page(html)) {
      throw new Error(`NU series not found for novel: ${novelSlug}`);
    }

    await Storage.setPublishedRecord(novelSlug, {
      nuSlug: target.nuSlug || nuSlug,
      lastScanned: new Date().toISOString(),
      releases
    });

    return {
      releases,
      resolvedNuSlug: target.nuSlug || nuSlug,
      source: target.source
    };
  };

  const syncPublishedStatus = async () => {
    const data = await ensureNovelDataLoaded();
    const novels = data.novels || {};
    const configs = data.novelConfigs || {};
    const scopedEntries = pickScopedNovelEntries(data);
    const slugs = scopedEntries.map(([slug]) => slug);

    if (!slugs.length) {
      UI.toast('未发现私域小说数据，请先在 Fox 页面执行扫描后再同步', 'warn', 4200);
      return;
    }

    let success = 0;
    for (const [slug, novel] of scopedEntries) {
      const config = configs[slug] || {};
      const nuSlug = config.nuSlug || data.publishedReleases?.[slug]?.nuSlug || slug;
      const unlockedKeys = new Set((novel.chapters || [])
        .filter((chapter) => chapter?.unlocked && chapter?.index)
        .map((chapter) => toReleaseKey(chapter.index).toLowerCase()));

      try {
        const { releases, resolvedNuSlug } = await scanNovelSeries({
          novelSlug: slug,
          nuSlug,
          nuSeriesName: config.nuSeriesName || novel.title,
          novelTitle: novel.title
        });
        const publishedSet = new Set(releases.map((item) => String(item).toLowerCase()));
        let publishedUnlocked = 0;
        unlockedKeys.forEach((releaseKey) => {
          if (publishedSet.has(releaseKey)) {
            publishedUnlocked += 1;
          }
        });
        const pendingCount = Math.max(unlockedKeys.size - publishedUnlocked, 0);

        success += 1;
        UI.toast(`同步 ${slug} 完成：已解锁 ${unlockedKeys.size} / 已发布 ${publishedUnlocked} / 待发布 ${pendingCount}`, 'info', 4600);

        if (resolvedNuSlug && resolvedNuSlug !== config.nuSlug) {
          data.novelConfigs = data.novelConfigs || {};
          data.novelConfigs[slug] = {
            ...(data.novelConfigs[slug] || {}),
            ...config,
            nuSlug: resolvedNuSlug
          };
          await Storage.set(data);
        }
      } catch (error) {
        Logger.error('sync series failed', slug, error);
        UI.toast(`同步失败：${slug}`, 'error');
      }

      await sleep(380);
    }

    UI.toast(`已发布状态同步完成 ${success}/${slugs.length}`, 'info', 4500);

    if (isAddReleasePage()) {
      renderPendingPanel().catch((error) => Logger.error('refresh pending panel failed', error));
    }
  };

  const buildPendingList = async () => {
    const data = await ensureNovelDataLoaded();
    const configs = data.novelConfigs || {};
    const published = data.publishedReleases || {};
    const scopedEntries = pickScopedNovelEntries(data);

    const pending = [];

    scopedEntries.forEach(([slug, novel]) => {
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

    const canQueueSubmit = Boolean(seriesHiddenValue) && (!hasGroupName || Boolean(groupHiddenValue));
    if (canQueueSubmit) {
      await setPendingSubmit(item);
      UI.toast(`已填充：${item.novelTitle} ${item.releaseText}，请点击 Submit；提交成功后自动移除`, 'info', 5200);
      if (isAddReleasePage()) {
        renderPendingPanel().catch((error) => Logger.error('refresh pending panel after fill failed', error));
      }
      return;
    }

    UI.toast('已填充基础字段，但未标记为待提交，请先完成 Series/Group 选择', 'warn', 5200);
  };

  const renderPendingPanel = async () => {
    const pending = await buildPendingList();
    const pendingSubmit = await readPendingSubmit();
    const pendingSubmitToken = toPendingSubmitToken(pendingSubmit);

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

        const itemToken = toPendingSubmitToken(item);
        const isPendingSubmit = pendingSubmitToken && itemToken === pendingSubmitToken;

        const label = document.createElement('span');
        label.textContent = `${item.novelTitle} - ${item.releaseText}${isPendingSubmit ? '（待提交）' : ''}`;
        label.style.fontSize = '12px';

        const btn = document.createElement('button');
        btn.textContent = isPendingSubmit ? '待提交' : '填充';
        btn.style.fontSize = '11px';
        btn.disabled = Boolean(isPendingSubmit);
        if (isPendingSubmit) {
          btn.style.opacity = '0.65';
          btn.style.cursor = 'not-allowed';
        }

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
    [...document.querySelectorAll('[data-synnovel-panel="common"]')].forEach((panel) => panel.remove());

    if (commonPanelRef?.isConnected) {
      return;
    }

    const panel = UI.createFloatingPanel({
      title: 'NovelUpdates 同步助手',
      actions: [
        { label: '🧲 拉取私域', onClick: () => importDataFromFoxBridge() },
        { label: '📡 同步已发布', primary: true, onClick: () => syncPublishedStatus() }
      ]
    });
    panel.dataset.synnovelPanel = 'common';
    commonPanelRef = panel;
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
      await reconcilePendingSubmitAfterSuccess();
      renderPendingPanel().catch((error) => Logger.error('init add release panel failed', error));
    } else {
      initCommonPanel();
    }
  };

  bootstrap().catch((error) => {
    console.error('[SynNovel] bootstrap failed', error);
  });
})();
