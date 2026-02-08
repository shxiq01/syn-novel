(function initLogger(root) {
  const globalRoot = root || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
  const shared = (globalRoot.SynNovelShared = globalRoot.SynNovelShared || {});
  const constants = shared.Constants || { APP_NAME: 'SynNovel' };

  const withPrefix = (level, msg, ...args) => {
    const prefix = `[${constants.APP_NAME}] ${level}`;
    return [prefix, msg, ...args];
  };

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
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
