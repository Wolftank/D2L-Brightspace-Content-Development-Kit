const GUIDE_URLS = new Set([
  'https://stcloudstate.learn.minnstate.edu/',
  'https://community.d2l.com/brightspace/kb/articles/4971-import-and-manage-scorm',
  'https://community.d2l.com/brightspace/kb/articles/3382-hide-content-topics-modules-and-downloads',
  'https://community.d2l.com/brightspace/kb/articles/35011',
]);

/** Identifies the guide's approved browser destinations. */
export function isGuideUrl(url: string): boolean {
  return GUIDE_URLS.has(url);
}
