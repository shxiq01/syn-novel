// ==UserScript==
// @name         NovelUpdates Release Helper
// @namespace    https://github.com/shixq/syn-novel
// @version      1.0.0
// @description  同步已发布章节并在 Add Release 页面自动填表
// @match        https://www.novelupdates.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function novelUpdatesHelper() {
  'use strict';

  const shared = window.SynNovelShared || {};
  const Logger = shared.Logger || console;
  const Storage = shared.Storage;
  const UI = shared.UI;
  const Dom = shared.Dom;

  if (!Storage || !UI || !Dom) {
    console.warn('[SynNovel] shared modules missing');
    return;
  }

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

  if (isAddReleasePage()) {
    renderPendingPanel().catch((error) => Logger.error('init add release panel failed', error));
  } else {
    initCommonPanel();
  }
})();
