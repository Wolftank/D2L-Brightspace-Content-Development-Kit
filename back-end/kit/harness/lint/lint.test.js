/* Regression suite for the lint.
   The fixtures are deliberately broken and must stay that way: these
   assertions are what prove a rule still fires. */

'use strict';

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
  'shared/no-viewport-units', 'shared/external-cdn', 'shared/missing-assets'
].forEach(id => check(id, bsRules.has(id)));
check('bad-scorm fails the gate', errs(bs) > 0);

console.log('\n== bad-topic trips every topic rule ==');
const bt = lint(fx('bad-topic'), 'topic', profile);
const btRules = rulesIn(bt);
[
  'topic/no-static-script-src', 'topic/unwrapped-storage', 'topic/namespaced-storage',
  'topic/no-storage-for-grades', 'topic/no-grade-writes', 'topic/generic-sibling-filename',
  'shared/no-viewport-units', 'shared/external-cdn', 'shared/missing-assets'
].forEach(id => check(id, btRules.has(id)));
check('bad-topic fails the gate', errs(bt) > 0);

console.log('\n== bad-widget trips every widget rule ==');
const bw = lint(fx('bad-widget'), 'widget', profile);
const bwRules = rulesIn(bw);
[
  'widget/unscoped-css', 'widget/global-scope-leak', 'widget/unnamespaced-id',
  'widget/role-as-boundary', 'widget/keep-it-short',
  'topic/unwrapped-storage', 'topic/namespaced-storage', 'topic/no-storage-for-grades',
  'shared/external-cdn', 'shared/missing-assets'
].forEach(id => check(id, bwRules.has(id)));
check('bad-widget fails the gate', errs(bw) > 0);

console.log('\n== the widget starter is clean ==');
const ws = lint(path.join(__dirname, '..', '..', 'skills', 'd2l-homepage-widget', 'assets', 'starter'),
                'widget', profile);
check('no findings at all', ws.findings.length === 0,
      JSON.stringify(ws.findings.map(f => f.rule + '@' + f.line)));

console.log('\n== good-topic is clean ==');
const gt = lint(fx('good-topic'), 'topic', profile);
check('no findings at all', gt.findings.length === 0,
      JSON.stringify(gt.findings.map(f => f.rule + '@' + f.file + ':' + f.line)));
check('passes the gate', errs(gt) === 0);

console.log('\n== generic sibling filenames are flagged, build-specific ones are not ==');
check('bad-topic\'s data.js is flagged', btRules.has('topic/generic-sibling-filename'));
check('good-topic\'s wk1-data.js is not', !rulesIn(gt).has('topic/generic-sibling-filename'));

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

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)\n');
process.exit(fail === 0 ? 0 : 1);
