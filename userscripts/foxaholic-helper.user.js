// ==UserScript==
// @name         Foxaholic Helper
// @namespace    https://github.com/shixq/syn-novel
// @version      1.1.0
// @description  私域小说平台辅助：状态扫描、映射配置、章节导入填充
// @match        https://18.foxaholic.com/wp-admin/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(function foxaholicHelper() {
  'use strict';

  const getGlobalRoot = () => (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let Logger = console;
  let Storage;
  let UI;
  let Parser;
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

    if (!shared.Contracts) {
      const CONTRACT_VERSION = '1.0.0';
      shared.Contracts = {
        CONTRACT_VERSION,
        STORAGE_KEY: 'synNovelData',
        RELEASE_FORMAT: Object.freeze({
          CHAPTER: 'chapter',
          C: 'c'
        }),
        CHAPTER_NUMBER_PATTERNS: Object.freeze([
          /第\s*(\d+)\s*[章节回]/i,
          /chapter\s*(\d+)/i,
          /\bc\s*(\d+)\b/i,
          /^\s*(\d+)(?:[.\s]|$)/i
        ]),
        CHAPTER_URL_TEMPLATE: 'https://18.foxaholic.com/novel/{slug}/chapter-{num}/',
        DEFAULT_DATA: Object.freeze({
          novels: {},
          novelConfigs: {},
          publishedReleases: {},
          meta: {
            version: CONTRACT_VERSION,
            lastUpdated: ''
          }
        })
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

    if (!shared.Parser) {
      const chapterNumberPatterns = [
        /第\s*(\d+)\s*[章节回]/i,
        /chapter\s*(\d+)/i,
        /\bc\s*(\d+)\b/i,
        /^\s*(\d+)(?:[.\s]|$)/i
      ];

      const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      shared.Parser = {
        extractChapterNum(title) {
          const raw = String(title || '').trim();
          for (const pattern of chapterNumberPatterns) {
            const matched = raw.match(pattern);
            if (matched) {
              return Number.parseInt(matched[1], 10);
            }
          }
          return null;
        },

        parseSplitFile(content, separator = '===') {
          const text = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const sep = escapeRegex(separator);
          const regex = new RegExp(`(?:^|\\n)${sep}(.+?)${sep}\\n([\\s\\S]*?)(?=(?:\\n${sep})|$)`, 'g');
          const chapters = [];
          let matched;

          while ((matched = regex.exec(text)) !== null) {
            const chapterTitle = matched[1].trim();
            const body = matched[2].trim();
            chapters.push({
              title: chapterTitle,
              content: body,
              index: this.extractChapterNum(chapterTitle)
            });
          }

          return chapters;
        },

        buildChapterUrl(baseUrl, chapterNum) {
          if (!baseUrl || !chapterNum) {
            return '';
          }
          const cleanBase = String(baseUrl).replace(/\/$/, '');
          return `${cleanBase}/chapter-${chapterNum}/`;
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
    Parser = shared.Parser;
    Dom = shared.Dom;
    return {
      ready: Boolean(Storage && UI && Parser && Dom),
      usedFallback: Boolean(shared.__singleFileFallbackReady)
    };
  };

  const showMissingSharedNotice = () => {
    const noticeId = 'synnovel-shared-missing-notice';
    if (document.getElementById(noticeId)) {
      return;
    }

    const render = () => {
      if (document.getElementById(noticeId) || !document.body) {
        return;
      }

      const panel = document.createElement('div');
      panel.id = noticeId;
      panel.style.position = 'fixed';
      panel.style.right = '16px';
      panel.style.bottom = '16px';
      panel.style.maxWidth = '360px';
      panel.style.background = '#fff4f4';
      panel.style.border = '1px solid #f3b8b8';
      panel.style.borderRadius = '10px';
      panel.style.padding = '10px 12px';
      panel.style.zIndex = '999999';
      panel.style.boxShadow = '0 6px 20px rgba(0,0,0,0.18)';
      panel.style.fontSize = '12px';
      panel.style.lineHeight = '1.5';
      panel.innerHTML = [
        '<div style="font-weight:600;margin-bottom:4px;">SynNovel 初始化失败</div>',
        '<div>未检测到 shared 模块，请先安装并启用以下脚本：</div>',
        '<div style="margin-top:4px;">constants / logger / contracts / storage / parser / dom / ui</div>',
        '<div style="margin-top:6px;opacity:.82;">控制台自检：window.SynNovelShared</div>'
      ].join('');
      document.body.appendChild(panel);
    };

    if (document.body) {
      render();
      return;
    }

    window.addEventListener('DOMContentLoaded', render, { once: true });
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

  const isNovelListPage = () => {
    return location.pathname.includes('/wp-admin/edit.php') && location.search.includes('post_type=wp-manga');
  };

  const isNovelEditPage = () => {
    return location.pathname.includes('/wp-admin/post.php') && location.search.includes('action=edit');
  };

  const isTextChapterPage = () => {
    if (!location.pathname.includes('/wp-admin/')) {
      return false;
    }
    if (location.search.includes('page=wp-manga-chapter') || location.search.includes('text-chapter')) {
      return true;
    }
    return Boolean(document.querySelector('input[name="chapter_name"], input#chapter_name, input[name="wp-manga-chapter-name"], #wp-manga-chapter-name, #wp-manga-content-chapter-create, textarea[name="chapter_content"], textarea#content'));
  };

  const slugify = (text) =>
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .trim();

  const getRowNovelMeta = (row) => {
    const rowId = row.id || '';
    const idMatch = rowId.match(/post-(\d+)/);
    const id = idMatch ? Number.parseInt(idMatch[1], 10) : null;
    const titleEl = row.querySelector('.row-title');
    const title = titleEl ? titleEl.textContent.trim() : `novel-${id || Date.now()}`;
    const statusText = (row.querySelector('.column-status, .status, .comment_status, [data-colname="Project Status"], td[class*="status"]')?.textContent || '').trim();
    return {
      id,
      title,
      statusText,
      slug: slugify(title)
    };
  };

  const parseUnlockTime = (text) => {
    const matched = String(text || '').match(/Unlock on\s+([^\n]+)/i);
    return matched ? matched[1].trim() : '';
  };

  const extractSlugAndBaseUrl = (doc) => {
    const permalink = doc.querySelector('#sample-permalink a, #edit-slug-box a, a[href*="/novel/"]');
    if (!permalink || !permalink.href) {
      return { slug: '', baseUrl: '' };
    }

    try {
      const url = new URL(permalink.href, location.origin);
      const matched = url.pathname.match(/\/novel\/([^/]+)/i);
      if (!matched) {
        return { slug: '', baseUrl: '' };
      }
      const slug = matched[1];
      return {
        slug,
        baseUrl: `${url.origin}/novel/${slug}`
      };
    } catch {
      return { slug: '', baseUrl: '' };
    }
  };

  const parseChapterNodes = (doc, baseUrl) => {
    const chapterNodes = doc.querySelectorAll('.chapter-item, .manga-chapter-item, .wp-manga-chapter, li.chapter-item, tr.chapter-item, a.wp-manga-edit-chapter, .wp-manga-chapter-item a');
    const chapters = [];

    chapterNodes.forEach((node) => {
      const container = node.closest('li, tr, .wp-manga-chapter-item, .wp-manga-chapter') || node;
      const text = (container.textContent || node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) {
        return;
      }

      const chapterId = text.match(/\[(\d+)\]/)?.[1] || node.getAttribute('data-id') || '';
      const chapterIndex = Parser.extractChapterNum(text) || Number.parseInt(node.getAttribute('data-index') || container.getAttribute?.('data-index') || '', 10) || null;
      if (!chapterIndex) {
        return;
      }

      const unlockTime = parseUnlockTime(text);
      const unlocked = !text.includes('🔒') && !/Unlock on/i.test(text);
      const link = node.matches('a') ? node : node.querySelector('a[href]');
      const rawUrl = link?.href || '';
      const chapterUrl = /\/novel\/.+\/chapter-\d+/i.test(rawUrl) ? rawUrl : Parser.buildChapterUrl(baseUrl, chapterIndex);

      chapters.push({
        id: chapterId ? Number.parseInt(chapterId, 10) : chapterIndex,
        index: chapterIndex,
        name: text,
        unlocked,
        unlockTime,
        url: chapterUrl
      });
    });

    const deduped = new Map();
    chapters.forEach((chapter) => {
      if (!deduped.has(chapter.index)) {
        deduped.set(chapter.index, chapter);
      }
    });

    return [...deduped.values()].sort((a, b) => a.index - b.index);
  };

  const scanNovelById = async (novelMeta) => {
    if (!novelMeta.id) {
      throw new Error(`invalid novel id: ${novelMeta.title}`);
    }

    const editUrl = `${location.origin}/wp-admin/post.php?post=${novelMeta.id}&action=edit`;
    const html = await fetch(editUrl, { credentials: 'include' }).then((r) => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const permalinkTitle = (doc.querySelector('#title')?.value || novelMeta.title || '').trim();
    const { slug, baseUrl } = extractSlugAndBaseUrl(doc);
    const chapters = parseChapterNodes(doc, baseUrl);

    return {
      id: novelMeta.id,
      title: permalinkTitle || novelMeta.title,
      slug: slug || novelMeta.slug,
      baseUrl,
      group: '',
      lastScanned: new Date().toISOString(),
      chapters
    };
  };

  const saveNovelData = async (record) => {
    const data = await Storage.get();
    data.novels = data.novels || {};
    data.novels[record.slug] = record;
    await Storage.set(data);
    return record;
  };

  const ensureSelection = async () => {
    const selected = await Storage.getPath('meta.selectedNovelIds', []);
    return Array.isArray(selected) ? selected : [];
  };

  const persistSelection = async (ids) => {
    await Storage.update('meta.selectedNovelIds', ids);
  };

  const collectSelectedNovelIdsFromTable = () => {
    const rows = [...document.querySelectorAll('#the-list tr[id^="post-"]')];
    return rows
      .map((row) => {
        const meta = getRowNovelMeta(row);
        const box = row.querySelector('.synnovel-checkbox, .check-column input[type="checkbox"][name="post[]"]');
        if (!meta.id || !box?.checked) {
          return null;
        }
        return meta.id;
      })
      .filter(Boolean);
  };

  const injectRowCheckboxes = async () => {
    const selectedIds = await ensureSelection();
    const rows = [...document.querySelectorAll('#the-list tr[id^="post-"]')];

    rows.forEach((row) => {
      const meta = getRowNovelMeta(row);
      if (!meta.id) {
        return;
      }

      const cell = row.querySelector('.check-column') || row.firstElementChild;
      if (!cell) {
        return;
      }

      let checkbox = row.querySelector('.check-column input[type="checkbox"][name="post[]"]');
      if (!checkbox) {
        checkbox = row.querySelector('.synnovel-checkbox');
      }

      if (!checkbox) {
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.marginLeft = '6px';
        cell.appendChild(checkbox);
      }

      checkbox.classList.add('synnovel-checkbox');
      checkbox.dataset.novelId = String(meta.id);

      if (selectedIds.includes(meta.id)) {
        checkbox.checked = true;
      }

      if (!checkbox.dataset.synnovelBound) {
        checkbox.addEventListener('change', async () => {
          const ids = collectSelectedNovelIdsFromTable();
          await persistSelection(ids);
        });
        checkbox.dataset.synnovelBound = '1';
      }
    });
  };

  const scanSelectedNovels = async () => {
    let selectedIds = await ensureSelection();
    if (!selectedIds.length) {
      selectedIds = collectSelectedNovelIdsFromTable();
      if (selectedIds.length) {
        await persistSelection(selectedIds);
      }
    }

    if (!selectedIds.length) {
      UI.toast('请先勾选要扫描的小说', 'warn');
      return;
    }

    UI.toast(`开始扫描 ${selectedIds.length} 本小说`);

    const rows = [...document.querySelectorAll('#the-list tr[id^="post-"]')];
    const rowMap = new Map(rows.map((row) => {
      const meta = getRowNovelMeta(row);
      return [meta.id, meta];
    }));

    let success = 0;
    for (const novelId of selectedIds) {
      const meta = rowMap.get(novelId);
      if (!meta) {
        continue;
      }

      try {
        const record = await scanNovelById(meta);
        await saveNovelData(record);
        success += 1;
        UI.toast(`已扫描 ${record.title}：${record.chapters.length} 章`);
      } catch (error) {
        Logger.error('scan failed', meta.title, error);
        UI.toast(`扫描失败：${meta.title}`, 'error');
      }
    }

    UI.toast(`扫描完成：${success}/${selectedIds.length}`, 'info', 4000);
  };

  const selectActiveRows = async () => {
    const rows = [...document.querySelectorAll('#the-list tr[id^="post-"]')];
    const selectedIds = [];
    rows.forEach((row) => {
      const meta = getRowNovelMeta(row);
      const isActive = /active/i.test(meta.statusText);
      const box = row.querySelector('.synnovel-checkbox, .check-column input[type="checkbox"][name="post[]"]');
      if (box) {
        box.checked = isActive;
      }
      if (isActive && meta.id) {
        selectedIds.push(meta.id);
      }
    });

    await persistSelection(selectedIds);
    UI.toast(`已选中活跃小说 ${selectedIds.length} 本`);
  };

  const clearSelection = async () => {
    const boxes = [...document.querySelectorAll('.synnovel-checkbox, .check-column input[type="checkbox"][name="post[]"]')];
    boxes.forEach((box) => {
      box.checked = false;
    });
    await persistSelection([]);
    UI.toast('已清空选择');
  };

  const openConfigForCurrentNovel = async () => {
    const postId = Number.parseInt(new URLSearchParams(location.search).get('post') || '', 10);
    if (!postId) {
      UI.toast('未识别到当前小说 ID', 'warn');
      return;
    }

    const title = (document.querySelector('#title')?.value || '').trim() || `post-${postId}`;
    const inferredSlug = slugify(title);

    const data = await Storage.get();
    data.novelConfigs = data.novelConfigs || {};
    const prev = data.novelConfigs[inferredSlug] || {};

    const nuSeriesName = prompt('NU 小说名称', prev.nuSeriesName || title);
    if (nuSeriesName === null) {
      return;
    }

    const nuGroupName = prompt('NU 翻译组名称', prev.nuGroupName || '');
    if (nuGroupName === null) {
      return;
    }

    const releaseFormat = prompt('Release 格式（chapter/c）', prev.releaseFormat || 'chapter');
    if (releaseFormat === null) {
      return;
    }

    data.novelConfigs[inferredSlug] = {
      nuSeriesName: nuSeriesName.trim(),
      nuGroupName: nuGroupName.trim(),
      releaseFormat: releaseFormat.trim() === 'c' ? 'c' : 'chapter'
    };

    await Storage.set(data);
    UI.toast(`配置已保存：${inferredSlug}`);
  };

  const autoScanCurrentNovel = async () => {
    const postId = Number.parseInt(new URLSearchParams(location.search).get('post') || '', 10);
    if (!postId) {
      return;
    }

    const meta = {
      id: postId,
      title: (document.querySelector('#title')?.value || '').trim() || `post-${postId}`,
      slug: slugify((document.querySelector('#title')?.value || '').trim())
    };

    try {
      const record = await scanNovelById(meta);
      await saveNovelData(record);
      UI.toast(`自动扫描完成：${record.title} (${record.chapters.length}章)`);
    } catch (error) {
      Logger.warn('auto scan current novel failed', error);
    }
  };

  const guessCurrentNovelSlug = async () => {
    const data = await Storage.get();
    const keys = Object.keys(data.novels || {});
    if (!keys.length) {
      return '';
    }
    return keys[0];
  };

  const fillChapterForm = async (chapter) => {
    const chapterTab = document.querySelector('a[href="#chapter-content"], a[href*="chapter-content"]');
    if (chapterTab) {
      chapterTab.click();
    }

    const nameSelectors = [
      'input[name="chapter_name"]',
      '#chapter_name',
      'input[name="wp-manga-chapter-name"]',
      '#wp-manga-chapter-name',
      'input[name="wp-manga-chapter-name-extend"]',
      '#wp-manga-chapter-name-extend',
      'input[name="post_title"]'
    ];
    const indexSelectors = [
      'input[name="chapter_index"]',
      '#chapter_index',
      'input[name="wp-manga-chapter-index"]',
      '#wp-manga-chapter-index',
      'input[name="menu_order"]'
    ];
    const contentSelectors = [
      'textarea[name="chapter_content"]',
      'textarea[name="wp-manga-chapter-content"]',
      '#wp-manga-chapter-content',
      'textarea[name="wp-manga-chapter-content-wp-editor"]',
      '#wp-manga-chapter-content-wp-editor',
      'textarea[name="post_content"]'
    ];

    const tryFill = (selectors, value) => {
      for (const selector of selectors) {
        if (Dom.fillInput(selector, value)) {
          return true;
        }
      }
      return false;
    };

    const fillEditorContent = (value) => {
      const content = String(value || '');
      const html = content.replace(/\n/g, '<br />');
      const editorA = window.tinymce?.get?.('wp-manga-chapter-content');
      const editorB = window.tinymce?.get?.('wp-manga-chapter-content-wp-editor');
      if (editorA || editorB) {
        editorA?.setContent(html);
        editorB?.setContent(html);
        window.tinymce?.triggerSave?.();
        return true;
      }

      const iframe = document.querySelector('#wp-manga-chapter-content_ifr');
      const body = iframe?.contentDocument?.body;
      if (body) {
        body.innerHTML = html;
        body.dispatchEvent(new Event('input', { bubbles: true }));
        const textareas = [
          'textarea[name="wp-manga-chapter-content"]',
          '#wp-manga-chapter-content',
          'textarea[name="wp-manga-chapter-content-wp-editor"]',
          '#wp-manga-chapter-content-wp-editor'
        ];
        textareas.forEach((selector) => {
          Dom.fillInput(selector, content);
        });
        return true;
      }

      return false;
    };

    const filledTitle = tryFill(nameSelectors, chapter.title);
    tryFill(indexSelectors, chapter.index || '');
    const filledEditorContent = fillEditorContent(chapter.content);
    const filledTextareaContent = tryFill(contentSelectors, chapter.content);
    const filledContent = filledEditorContent || filledTextareaContent;

    if (!filledTitle || !filledContent) {
      throw new Error('chapter form selector mismatch');
    }
  };

  const mountUploadModal = (chapters, onStart) => {
    const modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(0,0,0,0.45)';
    modal.style.zIndex = '999998';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';

    const card = document.createElement('div');
    card.style.width = '640px';
    card.style.maxHeight = '80vh';
    card.style.overflow = 'auto';
    card.style.background = '#fff';
    card.style.borderRadius = '10px';
    card.style.padding = '14px';

    const title = document.createElement('h3');
    title.textContent = `已解析 ${chapters.length} 个章节`;
    title.style.margin = '0 0 12px 0';
    card.appendChild(title);

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '4px';

    chapters.forEach((chapter, idx) => {
      const line = document.createElement('label');
      line.style.display = 'flex';
      line.style.gap = '8px';
      line.style.alignItems = 'center';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.dataset.index = String(idx);

      const span = document.createElement('span');
      span.textContent = chapter.title;
      span.style.fontSize = '12px';

      line.appendChild(checkbox);
      line.appendChild(span);
      list.appendChild(line);
    });

    card.appendChild(list);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.justifyContent = 'flex-end';
    actions.style.marginTop = '12px';

    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => modal.remove());

    const start = document.createElement('button');
    start.textContent = '开始填充';
    start.style.background = '#1976d2';
    start.style.color = '#fff';
    start.addEventListener('click', () => {
      const selected = [...list.querySelectorAll('input[type="checkbox"]:checked')].map((el) => chapters[Number.parseInt(el.dataset.index, 10)]);
      modal.remove();
      onStart(selected);
    });

    actions.appendChild(cancel);
    actions.appendChild(start);
    card.appendChild(actions);
    modal.appendChild(card);
    document.body.appendChild(modal);
  };

  const uploadQueue = {
    chapters: [],
    cursor: 0,
    active: false,

    start(chapters) {
      this.chapters = chapters;
      this.cursor = 0;
      this.active = chapters.length > 0;
      if (!this.active) {
        UI.toast('未选择任何章节', 'warn');
        return;
      }
      UI.toast(`已开始上传队列，共 ${chapters.length} 章`);
      this.fillNext();
    },

    async fillNext() {
      if (!this.active) {
        UI.toast('当前没有上传队列', 'warn');
        return;
      }

      if (this.cursor >= this.chapters.length) {
        this.active = false;
        UI.toast('队列已完成，请检查并提交最后一章', 'info', 5000);
        await autoScanCurrentNovel();
        return;
      }

      const chapter = this.chapters[this.cursor];
      try {
        await fillChapterForm(chapter);
        this.cursor += 1;
        UI.toast(`已填充：${chapter.title}（${this.cursor}/${this.chapters.length}）`, 'info', 4000);
      } catch (error) {
        Logger.error('fill chapter failed', error);
        UI.toast('填充失败，请检查表单选择器', 'error', 4500);
      }
    }
  };

  const openImportFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,text/plain';
    input.style.display = 'none';

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) {
        return;
      }

      const content = await file.text();
      const chapters = Parser.parseSplitFile(content, '===');
      if (!chapters.length) {
        UI.toast('未解析到章节，请检查分隔格式', 'warn');
        return;
      }

      mountUploadModal(chapters, (selected) => uploadQueue.start(selected));
    });

    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 1000);
  };

  const initListPage = async () => {
    await injectRowCheckboxes();
    UI.createFloatingPanel({
      title: 'SynNovel 扫描助手',
      actions: [
        { label: '🔄 扫描选中', primary: true, onClick: () => scanSelectedNovels() },
        { label: '✅ 全选活跃', onClick: () => selectActiveRows() },
        { label: '🧹 清除选择', onClick: () => clearSelection() }
      ]
    });
  };

  const initEditPage = async () => {
    UI.createFloatingPanel({
      title: 'SynNovel 当前小说',
      actions: [
        { label: '⚙️ 配置映射', onClick: () => openConfigForCurrentNovel() },
        { label: '🔄 立即扫描', primary: true, onClick: () => autoScanCurrentNovel() }
      ]
    });

    await Dom.retry(() => autoScanCurrentNovel(), { attempts: 2, delay: 1000 }).catch(() => undefined);
  };

  const initTextChapterPage = async () => {
    const slug = await guessCurrentNovelSlug();
    UI.createFloatingPanel({
      title: slug ? `SynNovel 上传助手 (${slug})` : 'SynNovel 上传助手',
      actions: [
        { label: '📁 导入章节', primary: true, onClick: () => openImportFile() },
        { label: '➡️ 填充下一章', onClick: () => uploadQueue.fillNext() },
        { label: '🔄 刷新状态', onClick: () => autoScanCurrentNovel() }
      ]
    });
  };

  const bootstrap = async () => {
    const targetPage = isNovelListPage() || isNovelEditPage() || isTextChapterPage();
    if (!targetPage) {
      return;
    }

    const { ready: sharedReady, usedFallback } = await ensureSharedModules();
    if (!sharedReady) {
      console.warn('[SynNovel] shared modules missing');
      showMissingSharedNotice();
      return;
    }

    if (usedFallback) {
      Logger.info('shared modules loaded from single-file fallback');
      UI.toast('SynNovel 单文件模式已启用', 'info', 2200);
    }

    if (isNovelListPage()) {
      initListPage().catch((error) => Logger.error('init list page failed', error));
    }

    if (isNovelEditPage()) {
      initEditPage().catch((error) => Logger.error('init edit page failed', error));
    }

    if (isTextChapterPage()) {
      initTextChapterPage().catch((error) => Logger.error('init text chapter page failed', error));
    }
  };

  bootstrap().catch((error) => {
    console.error('[SynNovel] bootstrap failed', error);
  });
})();
