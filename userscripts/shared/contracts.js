(function initContracts(root) {
  const globalRoot = root || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
  const shared = (globalRoot.SynNovelShared = globalRoot.SynNovelShared || {});

  const CONTRACT_VERSION = '1.0.0';
  const STORAGE_KEY = 'synNovelData';

  const RELEASE_FORMAT = Object.freeze({
    CHAPTER: 'chapter',
    C: 'c'
  });

  const CHAPTER_NUMBER_PATTERNS = Object.freeze([
    /第\s*(\d+)\s*[章节回]/i,
    /chapter\s*(\d+)/i,
    /\bc\s*(\d+)\b/i,
    /^\s*(\d+)(?:[.\s]|$)/i
  ]);

  const CHAPTER_URL_TEMPLATE = 'https://18.foxaholic.com/novel/{slug}/chapter-{num}/';

  const DEFAULT_DATA = Object.freeze({
    novels: {},
    novelConfigs: {},
    publishedReleases: {},
    meta: {
      version: CONTRACT_VERSION,
      lastUpdated: ''
    }
  });

  shared.Contracts = {
    CONTRACT_VERSION,
    STORAGE_KEY,
    RELEASE_FORMAT,
    CHAPTER_NUMBER_PATTERNS,
    CHAPTER_URL_TEMPLATE,
    DEFAULT_DATA
  };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
