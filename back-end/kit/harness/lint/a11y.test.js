/* Regression suite for the proposed accessibility rules (Q10 spike, #55).
   Each rule has a fixtures/a11y/<rule>/fail build that must trip exactly that
   rule, and a fixtures/a11y/<rule>/pass build that must lint clean. */

'use strict';

const path = require('path');
const { RULES } = require('./rules');
const { RULES: A11Y_RULES } = require('./a11y-rules');
const { lint } = require('./lint');
const profile = require('../tenant-profile.json');

RULES.push(...A11Y_RULES);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  <- ' + extra : '')); }
}
const fx = (rule, kind) => path.join(__dirname, 'fixtures', 'a11y', rule.id.split('/')[1], kind);
const describe = r => JSON.stringify(r.findings.map(f => f.rule + '@' + f.file + ':' + f.line));
const a11yOnly = r => r.findings.filter(f => f.rule.startsWith('a11y/'));
const kit = (...p) => path.join(__dirname, '..', '..', ...p);

for (const rule of A11Y_RULES) {
  console.log(`\n== ${rule.id} ==`);
  const bad = lint(fx(rule, 'fail'), 'topic', profile);
  const rules = new Set(bad.findings.map(f => f.rule));
  check('fail fixture trips this rule and nothing else', rules.size === 1 && rules.has(rule.id), describe(bad));
  check(`finding is a ${rule.severity} that names WCAG ${rule.wcag.split(' ')[0]}`,
    bad.findings.every(f => f.severity === rule.severity && f.message.startsWith('WCAG 2.2 ' + rule.wcag.split(' ')[0])));
  const good = lint(fx(rule, 'pass'), 'topic', profile);
  check('pass fixture lints clean', good.findings.length === 0, describe(good));
}

console.log('\n== the starters raise no accessibility findings ==');
for (const [skill, avenue] of [['d2l-content-topic', 'topic'], ['d2l-scorm-package', 'scorm'], ['d2l-homepage-widget', 'widget']]) {
  const r = lint(kit('skills', skill, 'assets', 'starter'), avenue, profile);
  check(`${skill} starter (${avenue})`, a11yOnly(r).length === 0, JSON.stringify(a11yOnly(r).map(f => f.rule)));
}

console.log('\n== the real probe build still passes the gate ==');
const probe = lint(kit('probes', 'scorm12-probe'), 'scorm', profile);
check('zero accessibility errors', !a11yOnly(probe).some(f => f.severity === 'error'), describe(probe));

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)\n');
process.exit(fail === 0 ? 0 : 1);
