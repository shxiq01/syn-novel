(function initParser(root) {
  const globalRoot = root || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
  const shared = (globalRoot.SynNovelShared = globalRoot.SynNovelShared || {});

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
        const title = matched[1].trim();
        const body = matched[2].trim();
        chapters.push({
          title,
          content: body,
          index: this.extractChapterNum(title)
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
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
