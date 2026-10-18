import { expect, it } from 'vitest';
import { isGuideUrl } from './help-links.js';

it('allows the guide destinations and denies arbitrary pages, schemes and query data', () => {
  expect(isGuideUrl('https://stcloudstate.learn.minnstate.edu/')).toBe(true);
  expect(isGuideUrl('https://community.d2l.com/brightspace/kb/articles/4971-import-and-manage-scorm')).toBe(true);
  for (const url of [
    'javascript:alert(1)', 'file:///C:/Windows/System32/cmd.exe',
    'https://community.d2l.com.evil.example/', 'https://community.d2l.com/',
    'https://stcloudstate.learn.minnstate.edu/?secret=data',
  ]) expect(isGuideUrl(url)).toBe(false);
});
