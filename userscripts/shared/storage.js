(function initStorage(root) {
  const globalRoot = root || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
  const shared = (globalRoot.SynNovelShared = globalRoot.SynNovelShared || {});
  const constants = shared.Constants || { STORAGE_KEY: 'synNovelData', VERSION: '1.0.0' };

  const getPath = (obj, path) => {
    return path.split('.').reduce((acc, key) => (acc && key in acc ? acc[key] : undefined), obj);
  };

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

  const api = {
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

  shared.Storage = api;
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
