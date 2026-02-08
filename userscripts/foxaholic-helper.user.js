// ==UserScript==
// @name         Foxaholic Helper
// @namespace    https://github.com/shixq/syn-novel
// @version      1.1.0
// @description  私域小说平台辅助：状态扫描、映射配置、章节导入填充
// @match        https://18.foxaholic.com/wp-admin/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function foxaholicHelper() {
  'use strict';

  const shared = window.SynNovelShared || {};
  const Logger = shared.Logger || console;
  const Storage = shared.Storage;
  const UI = shared.UI;
  const Parser = shared.Parser;
  const Dom = shared.Dom;

  if (!Storage || !UI || !Parser || !Dom) {
    console.warn('[SynNovel] shared modules missing');
    return;
  }

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
    return Boolean(document.querySelector('input[name="chapter_name"], input#chapter_name, textarea[name="chapter_content"], textarea#content'));
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
    const statusText = (row.querySelector('.column-status, .status')?.textContent || '').trim();
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
    const chapterNodes = doc.querySelectorAll('.chapter-item, .manga-chapter-item, .wp-manga-chapter, li.chapter-item, tr.chapter-item');
    const chapters = [];

    chapterNodes.forEach((node) => {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) {
        return;
      }

      const chapterId = text.match(/\[(\d+)\]/)?.[1] || node.getAttribute('data-id') || '';
      const chapterIndex = Parser.extractChapterNum(text) || Number.parseInt(node.getAttribute('data-index') || '', 10) || null;
      if (!chapterIndex) {
        return;
      }

      const unlockTime = parseUnlockTime(text);
      const unlocked = !text.includes('🔒') && !/Unlock on/i.test(text);
      const link = node.querySelector('a[href*="chapter-"]');
      const chapterUrl = link?.href || Parser.buildChapterUrl(baseUrl, chapterIndex);

      chapters.push({
        id: chapterId ? Number.parseInt(chapterId, 10) : chapterIndex,
        index: chapterIndex,
        name: text,
        unlocked,
        unlockTime,
        url: chapterUrl
      });
    });

    return chapters.sort((a, b) => a.index - b.index);
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

  const injectRowCheckboxes = async () => {
    const selectedIds = await ensureSelection();
    const rows = [...document.querySelectorAll('#the-list tr[id^="post-"]')];

    rows.forEach((row) => {
      if (row.querySelector('.synnovel-checkbox')) {
        return;
      }

      const meta = getRowNovelMeta(row);
      if (!meta.id) {
        return;
      }

      const cell = row.querySelector('.check-column') || row.firstElementChild;
      if (!cell) {
        return;
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'synnovel-checkbox';
      checkbox.dataset.novelId = String(meta.id);
      checkbox.style.marginLeft = '6px';
      checkbox.checked = selectedIds.includes(meta.id);
      checkbox.addEventListener('change', async () => {
        const allBoxes = [...document.querySelectorAll('.synnovel-checkbox')];
        const ids = allBoxes.filter((box) => box.checked).map((box) => Number.parseInt(box.dataset.novelId, 10));
        await persistSelection(ids);
      });

      cell.appendChild(checkbox);
    });
  };

  const scanSelectedNovels = async () => {
    const selectedIds = await ensureSelection();
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
      const box = row.querySelector('.synnovel-checkbox');
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
    const boxes = [...document.querySelectorAll('.synnovel-checkbox')];
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
    const nameSelectors = ['input[name="chapter_name"]', '#chapter_name', 'input[name="post_title"]'];
    const indexSelectors = ['input[name="chapter_index"]', '#chapter_index', 'input[name="menu_order"]'];
    const contentSelectors = ['textarea[name="chapter_content"]', '#content', 'textarea[name="post_content"]'];

    const tryFill = (selectors, value) => {
      for (const selector of selectors) {
        if (Dom.fillInput(selector, value)) {
          return true;
        }
      }
      return false;
    };

    const filledTitle = tryFill(nameSelectors, chapter.title);
    tryFill(indexSelectors, chapter.index || '');
    const filledContent = tryFill(contentSelectors, chapter.content);

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

  if (isNovelListPage()) {
    initListPage().catch((error) => Logger.error('init list page failed', error));
  }

  if (isNovelEditPage()) {
    initEditPage().catch((error) => Logger.error('init edit page failed', error));
  }

  if (isTextChapterPage()) {
    initTextChapterPage().catch((error) => Logger.error('init text chapter page failed', error));
  }
})();
