/* Regression suite for the chooser's routing.
   The page must stay self-contained (no external script files), so this test
   lifts decide() and caveatsFor() out of the HTML and exercises them directly.
   If the extraction stops matching, that is a real signal: the shape of the
   page changed and the routing needs re-checking by hand. */

'use strict';

const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, '02 Determine Your Path.html');
const src = fs.readFileSync(HTML, 'utf8');

function lift(name) {
  const m = src.match(new RegExp(`function ${name}\\(a, ov\\) \\{[\\s\\S]*?\\n  \\}`));
  if (!m) {
    console.error(`Could not find ${name}() in the page. Extraction is stale.`);
    process.exit(2);
  }
  return m[0];
}

// Stub OUT so each outcome resolves to its own key name.
const OUT = new Proxy({}, { get: (t, k) => String(k) });
const decide = new Function('OUT', `${lift('decide')}; return decide;`)(OUT);
const caveatsFor = new Function(`${lift('caveatsFor')}; return caveatsFor;`)();

let pass = 0, fail = 0;
function check(name, got, want) {
  if (got === want) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  <- got "${got}", wanted "${want}"`); }
}

/* Every question that can force an outcome, all answered No. */
const DECIDERS = ['quiz', 'highStakes', 'ambient', 'finished',
                  'autoGrade', 'crossDevice', 'roleAware', 'mustHide', 'learnerData'];
const allNo = {};
DECIDERS.forEach(k => { allNo[k] = false; });
const A = (extra) => Object.assign({}, allNo, extra);

console.log('\n== advice comes first, before any avenue ==');
check('quiz/survey/discussion is raised first',
  decide(A({ quiz: true, autoGrade: true, ambient: true })), 'native');
check('high stakes raised before build avenues',
  decide(A({ highStakes: true, autoGrade: true })), 'highstakes');

console.log('\n== advice is overridable, not a wall ==');
check('overriding native lets routing continue',
  decide(A({ quiz: true, autoGrade: true }), { native: true }), 'scorm');
check('overriding high stakes lets routing continue',
  decide(A({ highStakes: true, ambient: true }), { highstakes: true }), 'widget');
check('one override does not silence the other',
  decide(A({ quiz: true, highStakes: true }), { native: true }), 'highstakes');

console.log('\n== placement decides the widget ==');
check('should just be there -> widget',
  decide(A({ ambient: true })), 'widget');
check('must be genuinely hidden -> widget',
  decide(A({ mustHide: true })), 'widget');
check('ambient beats a mere role need',
  decide(A({ ambient: true, roleAware: true })), 'widget');
check('mustHide beats a mere role need',
  decide(A({ mustHide: true, learnerData: true })), 'widget');

console.log('\n== a finished state is not ambient ==');
check('ambient + finished -> contradiction, not a guess',
  decide(A({ ambient: true, finished: true })), 'contradiction');
check('finished alone does not route anywhere on its own',
  decide(A({ finished: true })), 'idle');
check('finished + grade is just a graded activity',
  decide(A({ finished: true, autoGrade: true })), 'scorm');

console.log('\n== a widget cannot carry a grade ==');
check('ambient + autoGrade -> two pieces',
  decide(A({ ambient: true, autoGrade: true })), 'conflictWidgetGrade');
check('ambient + crossDevice -> two pieces',
  decide(A({ ambient: true, crossDevice: true })), 'conflictWidgetGrade');
check('mustHide + autoGrade -> two pieces',
  decide(A({ mustHide: true, autoGrade: true })), 'conflictWidgetGrade');

console.log('\n== the other three avenues ==');
check('needs an automatic grade -> scorm', decide(A({ autoGrade: true })), 'scorm');
check('needs cross-device memory -> scorm', decide(A({ crossDevice: true })), 'scorm');
check('needs role awareness -> topic', decide(A({ roleAware: true })), 'topic');
check('needs learner data -> topic', decide(A({ learnerData: true })), 'topic');
check('frequent revision only -> external',
  decide(A({ revisedOften: true, needsDeps: false })), 'external');
check('heavy dependency only -> external',
  decide(A({ revisedOften: false, needsDeps: true })), 'external');
check('nothing special -> topic is the default',
  decide(A({ revisedOften: false, needsDeps: false })), 'topic');

console.log('\n== grade plus role is still two pieces ==');
check('autoGrade + roleAware -> conflict',
  decide(A({ autoGrade: true, roleAware: true })), 'conflict');
check('crossDevice + learnerData -> conflict',
  decide(A({ crossDevice: true, learnerData: true })), 'conflict');

console.log('\n== it does not guess early ==');
check('nothing answered', decide({}), 'idle');
check('one negative answer is not enough', decide({ quiz: false }), 'idle');
check('deciders answered but the last two are not', decide(A({})), 'idle');

console.log('\n== overrides are carried forward as caveats ==');
check('native override produces a caveat',
  caveatsFor({ quiz: true }, { native: true }).length, 1);
check('high stakes override produces a caveat',
  caveatsFor({ highStakes: true }, { highstakes: true }).length, 1);
check('no override, no caveat',
  caveatsFor({ quiz: true, highStakes: true }, {}).length, 0);
check('caveat needs the answer too, not just the flag',
  caveatsFor({ quiz: false }, { native: true }).length, 0);

console.log('\n== an ambient panel on live data gets the measurement warning ==');
check('ambient + learner data warns about what it measures',
  caveatsFor({ ambient: true, learnerData: true }, {}).length, 1);
check('hidden instructor panel on live data warns too',
  caveatsFor({ mustHide: true, learnerData: true }, {}).length, 1);
check('but not when it is a graded activity instead',
  caveatsFor({ ambient: true, learnerData: true, autoGrade: true }, {}).length, 0);
check('and not without live data',
  caveatsFor({ ambient: true, learnerData: false }, {}).length, 0);

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + `  (${pass} passed)\n`);
process.exit(fail === 0 ? 0 : 1);
