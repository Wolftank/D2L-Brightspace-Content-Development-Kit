/* Regression suite for the lint.
   The fixtures are deliberately broken and must stay that way: these
   assertions are what prove a rule still fires. */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { lint } = require('./lint');
const profile = require('../tenant-profile.json');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  <- ' + extra : '')); }
}
const fx = n => path.join(__dirname, 'fixtures', n);
const rulesIn = r => new Set(r.findings.map(f => f.rule));
const errs = r => r.findings.filter(f => f.severity === 'error').length;

console.log('\n== bad-scorm trips every SCORM rule ==');
const bs = lint(fx('bad-scorm'), 'scorm', profile);
const bsRules = rulesIn(bs);
[
  'scorm/no-api-calls', 'scorm/no-terminate-on-load', 'scorm/no-completed-on-load',
  'scorm/credit-guard', 'scorm/commit-before-terminate', 'scorm/suspend-data-cap',
  'scorm/storage-key-learner-id', 'scorm/root-height', 'scorm/manifest',
  'shared/no-viewport-units', 'shared/external-cdn', 'shared/missing-assets',
  'a11y/alt', 'a11y/lang', 'a11y/heading-order',
  'shared/script-syntax', 'shared/text-encoding', 'shared/charset-declaration'
].forEach(id => check(id, bsRules.has(id)));
check('bad-scorm fails the gate', errs(bs) > 0);

console.log('\n== bad-topic trips every topic rule ==');
const bt = lint(fx('bad-topic'), 'topic', profile);
const btRules = rulesIn(bt);
[
  'topic/no-static-script-src', 'topic/unwrapped-storage', 'topic/namespaced-storage',
  'topic/no-storage-for-grades', 'topic/no-grade-writes', 'topic/generic-sibling-filename',
  'shared/no-viewport-units', 'shared/external-cdn', 'shared/missing-assets',
  'a11y/alt', 'a11y/lang', 'a11y/heading-order'
].forEach(id => check(id, btRules.has(id)));
check('bad-topic fails the gate', errs(bt) > 0);

console.log('\n== bad-widget trips every widget rule ==');
const bw = lint(fx('bad-widget'), 'widget', profile);
const bwRules = rulesIn(bw);
[
  'widget/unscoped-css', 'widget/global-scope-leak', 'widget/unnamespaced-id',
  'widget/role-as-boundary', 'widget/keep-it-short',
  'topic/unwrapped-storage', 'topic/namespaced-storage', 'topic/no-storage-for-grades',
  'shared/external-cdn', 'shared/missing-assets',
  'a11y/alt', 'a11y/heading-order'
].forEach(id => check(id, bwRules.has(id)));
check('bad-widget fails the gate', errs(bw) > 0);

console.log('\n== the widget starter is clean ==');
const ws = lint(path.join(__dirname, '..', '..', 'skills', 'd2l-homepage-widget', 'assets', 'starter'),
                'widget', profile);
check('no findings at all', ws.findings.length === 0,
      JSON.stringify(ws.findings.map(f => f.rule + '@' + f.line)));

console.log('\n== the SCORM starter is clean ==');
const ss = lint(path.join(__dirname, '..', '..', 'skills', 'd2l-scorm-package', 'assets', 'starter'),
                'scorm', profile);
const ssWarnings = ss.findings.filter(f => f.severity === 'warn').length;
check('SCORM starter passes the QA gate (pass, 0 errors, 0 warnings)',
      errs(ss) === 0 && ssWarnings === 0,
      JSON.stringify(ss.findings.map(f => f.severity + ' ' + f.rule + '@' + f.file + ':' + f.line)));

console.log('\n== good-topic is clean ==');
const gt = lint(fx('good-topic'), 'topic', profile);
check('no findings at all', gt.findings.length === 0,
      JSON.stringify(gt.findings.map(f => f.rule + '@' + f.file + ':' + f.line)));
check('passes the gate', errs(gt) === 0);

console.log('\n== generic sibling filenames are flagged, build-specific ones are not ==');
check('bad-topic\'s data.js is flagged', btRules.has('topic/generic-sibling-filename'));
check('good-topic\'s wk1-data.js is not', !rulesIn(gt).has('topic/generic-sibling-filename'));

console.log('\n== each accessibility rule fires on its failing fixture and nowhere on its passing one ==');
const { RULES } = require('./rules');
for (const { id } of RULES.filter(r => r.id.startsWith('a11y/'))) {
  const name = id.slice('a11y/'.length);
  const failing = lint(fx(path.join('a11y', name, 'fail')), 'topic', profile);
  const passing = lint(fx(path.join('a11y', name, 'pass')), 'topic', profile);
  check(id + ' fires on a11y/' + name + '/fail, and nothing else does',
        failing.findings.length > 0 && failing.findings.every(f => f.rule === id),
        JSON.stringify(failing.findings.map(f => f.rule + '@' + f.line)));
  check('a11y/' + name + '/pass has no findings at all', passing.findings.length === 0,
        JSON.stringify(passing.findings.map(f => f.rule + '@' + f.line)));
}

console.log('\n== the real probe build passes the gate ==');
const probe = lint(path.join(__dirname, '..', '..', 'probes', 'scorm12-probe'), 'scorm', profile);
check('zero errors', errs(probe) === 0,
      JSON.stringify(probe.findings.filter(f => f.severity === 'error').map(f => f.rule)));
check('v3 fix held: no terminate-on-load', !rulesIn(probe).has('scorm/no-terminate-on-load'));
check('v2 fix held: root height under limit', !rulesIn(probe).has('scorm/root-height'));

console.log('\n== avenue filtering ==');
const asTopic = lint(fx('bad-scorm'), 'topic', profile);
check('SCORM rules do not run in topic mode',
      ![...rulesIn(asTopic)].some(r => r.startsWith('scorm/')));
const asScorm = lint(fx('bad-topic'), 'scorm', profile);
check('topic-only rules do not run in scorm mode',
      !rulesIn(asScorm).has('topic/no-static-script-src'));
check('shared rules run in both',
      rulesIn(asTopic).has('shared/no-viewport-units') && rulesIn(asScorm).has('shared/no-viewport-units'));

const widgetAsTopic = lint(fx('bad-widget'), 'topic', profile);
check('widget rules do not run in topic mode',
      ![...rulesIn(widgetAsTopic)].some(r => r.startsWith('widget/')));

/* Deliberate avenue difference: a widget is NOT iframed, so viewport units
   behave normally there and must not be flagged. Flagging them would teach
   the wrong lesson about the one avenue where they are fine. */
const vhWidget = lint(fx('bad-topic'), 'widget', profile);
check('viewport units are NOT flagged for widgets',
      !rulesIn(vhWidget).has('shared/no-viewport-units'));
check('...but they ARE flagged for topics',
      rulesIn(lint(fx('bad-topic'), 'topic', profile)).has('shared/no-viewport-units'));

console.log('\n== comments must not create false results ==');
const { helpers } = require('./rules');
const stripped = helpers.stripComments('var a=1; // .length guard\n/* cap */ var b=2;');
check('comment text is blanked', !/length|cap/.test(stripped));
check('line count preserved', stripped.split('\n').length === 2);
check('code survives', /var a=1;/.test(stripped) && /var b=2;/.test(stripped));

console.log('\n== script syntax and text encoding ==');
function lintFiles(files, avenue) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-lint-'));
  try {
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    return lint(dir, avenue || 'scorm', profile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const byRule = (r, id) => r.findings.filter(f => f.rule === id);

const inline = byRule(lintFiles({
  'index.html': '<html lang="en">\n<head><meta charset="utf-8"></head>\n<body>\n<script>\nvar ok = 1;\nvar broken = {;\n</script>\n</body></html>'
}), 'shared/script-syntax');
check('an inline syntax error is reported on its line of the page', inline.length === 1 && inline[0].line === 6,
      JSON.stringify(inline.map(f => f.line)));
check('a .js syntax error is reported', byRule(lintFiles({ 'app.js': 'function f( {\n' }), 'shared/script-syntax').length === 1);
check('module, data, external, and commented-out scripts are not compiled', byRule(lintFiles({
  'index.html': '<html lang="en"><head><meta charset="utf-8"></head><body>' +
    '<script type="module">import x from "./x.js";</script>' +
    '<script type="application/json">{"not": js}</script>' +
    '<script src="app.js">ignored {;</script>' +
    '<!-- <script>var broken = {;</script> -->' +
    '</body></html>',
  'app.js': 'var fine = 1;'
}), 'shared/script-syntax').length === 0);
check('bytes that are not UTF-8 are an error',
      byRule(lintFiles({ 'data.json': Buffer.from('{"title": "caf\xe9"}', 'latin1') }), 'shared/text-encoding').length === 1);
check('non-ASCII text without a UTF-8 declaration is a warning',
      byRule(lintFiles({ 'index.html': '<html lang="en"><body>Café</body></html>' }), 'shared/charset-declaration').length === 1);
check('either UTF-8 declaration, spelled utf-8 or utf8, satisfies it', byRule(lintFiles({
  'a.html': '<html lang="en"><head><meta charset="UTF-8"></head><body>Café</body></html>',
  'b.html': '<html lang="en"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>Café</body></html>',
  'c.html': '<html lang="en"><head><meta charset="utf8"></head><body>Café</body></html>',
  'd.html': '<html lang="en"><head><meta http-equiv="Content-Type" content="text/html; charset=utf8"></head><body>Café</body></html>'
}), 'shared/charset-declaration').length === 0);

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)\n');
process.exit(fail === 0 ? 0 : 1);
