(function initNUSyncRules(root) {
  const globalRoot = root || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
  const shared = (globalRoot.SynNovelShared = globalRoot.SynNovelShared || {});

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

  const buildPendingReleaseKeys = ({ unlockedKeys, publishedKeys } = {}) => {
    const unlocked = new Set(sortReleaseKeys(unlockedKeys || []));
    const published = new Set(sortReleaseKeys(publishedKeys || []));

    return sortReleaseKeys([...unlocked].filter((key) => !published.has(key)));
  };

  const api = {
    SyncRuleReason,
    normalizeReleaseKey,
    sortReleaseKeys,
    validateSyncInput,
    buildPendingReleaseKeys
  };

  shared.NUSyncRules = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : (typeof window !== 'undefined' ? window : globalThis));
