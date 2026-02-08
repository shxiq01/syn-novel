(function initConstants(root) {
  const globalRoot = root || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
  const shared = (globalRoot.SynNovelShared = globalRoot.SynNovelShared || {});

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
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
