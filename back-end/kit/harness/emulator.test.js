const fs = require('fs');
const path = __dirname + '/';
global.window = global;
eval(fs.readFileSync(path + 'd2l-emulator.js', 'utf8'));
const profile = JSON.parse(fs.readFileSync(path + 'tenant-profile.json', 'utf8'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  <- ' + extra : '')); }
}

console.log('\n== 1. happy path ==');
let emu = D2LEmulator.install({ profile, learner: { id: 'zzqa-01', name: 'Doe, Jane', role: 'Student' } });
let A = window.API;
check('API installed as SCORM 1.2', !!A && typeof A.LMSInitialize === 'function');
check('LMSInitialize returns true', A.LMSInitialize('') === 'true');
check('student_id populated', A.LMSGetValue('cmi.core.student_id') === 'zzqa-01');
check('set lesson_status', A.LMSSetValue('cmi.core.lesson_status', 'completed') === 'true');
check('set score', A.LMSSetValue('cmi.core.score.raw', '85') === 'true');
check('commit', A.LMSCommit('') === 'true');
check('finish', A.LMSFinish('') === 'true');
let r = emu.report();
check('no errors on happy path', r.errorCount === 0, JSON.stringify(r.violations));
check('score recorded', r.score === 85);
check('passed=true', r.passed === true);
emu.uninstall();

console.log('\n== 2. constraint enforcement ==');
emu = D2LEmulator.install({ profile, learner: { id: 'zzqa-02', name: 'Roe, Rick', role: 'Student' } });
A = window.API;
A.LMSInitialize('');
check('read-only write rejected', A.LMSSetValue('cmi.core.student_id', 'hacked') === 'false');
check('  -> error 403', A.LMSGetLastError() === '403');
check('bad vocabulary rejected', A.LMSSetValue('cmi.core.lesson_status', 'sorta-done') === 'false');
check('non-numeric score rejected', A.LMSSetValue('cmi.core.score.raw', 'lots') === 'false');
check('out-of-range score rejected', A.LMSSetValue('cmi.core.score.raw', '900') === 'false');
check('write-only read rejected', A.LMSGetValue('cmi.core.exit') === '' && A.LMSGetLastError() === '404');
check('unknown element rejected', A.LMSSetValue('cmi.bogus.thing', 'x') === 'false');
const big = 'x'.repeat(5000);
check('oversized suspend_data rejected (4096 cap)', A.LMSSetValue('cmi.suspend_data', big) === 'false');
check('at-limit suspend_data accepted', A.LMSSetValue('cmi.suspend_data', 'y'.repeat(4096)) === 'true');
r = emu.report();
const kinds = r.violations.map(v => v.kind);
check('violations logged', r.errorCount >= 7, 'got ' + r.errorCount);
check('too-long flagged', kinds.includes('too-long'));
check('write-read-only flagged', kinds.includes('write-read-only'));
check('bad-vocabulary flagged', kinds.includes('bad-vocabulary'));
check('unverified constraint warned', kinds.includes('unverified-constraint'));
emu.uninstall();

console.log('\n== 3. lifecycle violations ==');
emu = D2LEmulator.install({ profile, learner: { id: 'zzqa-03', name: 'Poe, Pat', role: 'Student' } });
A = window.API;
check('set before init rejected', A.LMSSetValue('cmi.core.score.raw', '50') === 'false');
A.LMSInitialize('');
A.LMSSetValue('cmi.core.score.raw', '50');
A.LMSFinish('');
r = emu.report();
check('set-before-initialize flagged', r.violations.some(v => v.kind === 'set-before-initialize'));
check('terminate-without-commit flagged', r.violations.some(v => v.kind === 'terminate-without-commit'));
check('report.passed=false', r.passed === false);
emu.uninstall();

console.log('\n== 4. grade calculation (best of 3) ==');
emu = D2LEmulator.install({ profile, learner: { id: 'zzqa-04', name: 'Moe, Max', role: 'Student' } });
check('highest of [50,90,70] = 90', emu.computeGrade([50, 90, 70]) === 90);
check('gradeCalculation from profile', emu.gradeCalculation === 'highest');
check('maxAttempts from profile', emu.maxAttempts === 3);
emu.uninstall();

console.log('\n== 5. API boundary ==');
(async () => {
  emu = D2LEmulator.install({ profile, learner: { id: 'zzqa-05', name: 'Lee, Lou', role: 'Student' } });
  window.API.LMSInitialize('');
  let threw = false;
  try { await fetch('/d2l/api/lp/1.5/users/whoami'); } catch (e) { threw = true; }
  check('API call from SCORM blocked per profile', threw);
  check('api-from-scorm violation logged', emu.report().violations.some(v => v.kind === 'api-from-scorm'));
  emu.uninstall();

  const p2 = JSON.parse(JSON.stringify(profile));
  p2.brightspaceApi.reachableFromScorm.value = true;
  emu = D2LEmulator.install({ profile: p2, learner: { id: 'zzqa-06', name: 'Kim, Kay', role: 'Student' } });
  window.API.LMSInitialize('');
  let res = await fetch('/d2l/api/lp/1.5/users/whoami');
  check('whoami 200 when reachable', res.status === 200);
  // MEASURED 2026-07-30: this tenant does NOT block students from classlist.
  // The emulator reproduces that, and flags it, rather than pretending otherwise.
  res = await fetch('/d2l/api/lp/1.5/999/classlist/');
  check('student gets 200 on classlist (measured tenant behavior)', res.status === 200);
  check('  -> and it is flagged as a violation',
        emu.report().violations.some(v => v.kind === 'class-data-to-student'));
  emu.uninstall();

  // A hardened tenant, for contrast. Proves the profile actually drives behavior.
  const p3 = JSON.parse(JSON.stringify(p2));
  p3.brightspaceApi.studentBlockedFromClassData = { value: true, verified: true };
  emu = D2LEmulator.install({ profile: p3, learner: { id: 'zzqa-07', name: 'Ng, Nia', role: 'Student' } });
  window.API.LMSInitialize('');
  res = await fetch('/d2l/api/lp/1.5/999/classlist/');
  check('student gets 403 when tenant blocks it', res.status === 403);
  emu.uninstall();

  emu = D2LEmulator.install({ profile: p2, learner: { id: 'zzqa-inst', name: 'Gill, Mark', role: 'Instructor' } });
  window.API.LMSInitialize('');
  res = await fetch('/d2l/api/lp/1.5/999/classlist/');
  check('instructor gets 200 on classlist', res.status === 200);
  emu.uninstall();

  console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)\n');
  process.exit(fail === 0 ? 0 : 1);
})();

