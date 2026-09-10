#!/usr/bin/env node
/* =====================================================================
   SCSU Tenant D2L Emulator: static lint
   ---------------------------------------------------------------------
   Checks a build against what our tenant actually does, before it goes
   anywhere near D2L. Deliberately at least as strict as the tenant, so a
   build that passes here works when deployed.

   Usage:
     node harness/lint/lint.js <path> --avenue scorm|topic|widget|external
     node harness/lint/lint.js <path> --avenue scorm --json

   Exit code 0 when there are no errors, 1 otherwise. Warnings are advisory.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const { RULES, helpers } = require('./rules');

const AVENUES = ['scorm', 'topic', 'widget', 'external'];
const CODE_EXT = new Set(['.html', '.htm', '.js', '.css', '.xml', '.json']);
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', '.claude']);

/* ------------------------------------------------------------ collect */

function collect(root) {
  const files = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) walk(full);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        const rel = path.relative(root, full).replace(/\\/g, '/');
        const entry = { abs: full, rel, ext, text: '', raw: '' };
        if (CODE_EXT.has(ext)) {
          try { entry.raw = fs.readFileSync(full, 'utf8'); } catch (e2) { entry.raw = ''; }
          // Rules see comment-stripped source. Comments are blanked in place,
          // so offsets and line numbers still line up with the real file.
          entry.text = helpers.stripComments(entry.raw);
        }
        files.push(entry);
      }
    }
  })(root);
  return files;
}

function loadProfile() {
  const p = path.join(__dirname, '..', 'tenant-profile.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) {
    console.error('Could not read tenant-profile.json: ' + e.message);
    process.exit(2);
  }
}

/* Every unverified entry the profile still carries. Reported once, up front, */
/* because an unverified constraint is exactly how we shipped a wrong belief. */
function unverifiedEntries(node, trail, acc) {
  if (!node || typeof node !== 'object') return acc;
  if ('value' in node && 'verified' in node) {
    if (node.verified === false) acc.push(trail.join('.'));
    return acc;
  }
  for (const k of Object.keys(node)) {
    if (k.startsWith('$')) continue;
    unverifiedEntries(node[k], trail.concat(k), acc);
  }
  return acc;
}

/* --------------------------------------------------------------- run */

function lint(root, avenue, profile) {
  const files = collect(root);
  const ctx = { files, profile, avenue, root };
  const findings = [];
  const ran = [];
  for (const rule of RULES) {
    if (!rule.avenues.includes(avenue)) continue;
    ran.push(rule.id);
    let got = [];
    try { got = rule.test(ctx) || []; }
    catch (e) {
      got = [{ rule: rule.id, severity: 'warn', file: '(lint)', line: 0,
               message: 'Rule threw: ' + e.message, because: 'Lint defect, not a build defect.' }];
    }
    findings.push(...got);
  }
  return { findings, ran, fileCount: files.length };
}

/* ------------------------------------------------------------ output */

const C = process.stdout.isTTY
  ? { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { r: '', y: '', g: '', d: '', b: '', x: '' };

function report(result, avenue, root, profile) {
  const errors = result.findings.filter(f => f.severity === 'error');
  const warns = result.findings.filter(f => f.severity === 'warn');

  console.log('');
  console.log(`${C.b}SCSU Tenant D2L Lint${C.x}  ${C.d}avenue: ${avenue}  files: ${result.fileCount}  rules: ${result.ran.length}${C.x}`);
  console.log(`${C.d}${root}${C.x}`);

  const unver = unverifiedEntries(profile, [], []);
  if (unver.length) {
    console.log('');
    console.log(`${C.y}${unver.length} tenant constraint(s) are still unverified.${C.x} ${C.d}Rules leaning on these are guesses:${C.x}`);
    for (const u of unver.slice(0, 8)) console.log(`  ${C.d}- ${u}${C.x}`);
    if (unver.length > 8) console.log(`  ${C.d}- ... and ${unver.length - 8} more${C.x}`);
  }

  // Group by rule so the explanation is printed once, not per finding.
  const byRule = new Map();
  for (const f of result.findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }

  const order = ['error', 'warn'];
  for (const sev of order) {
    for (const [ruleId, group] of byRule) {
      if (group[0].severity !== sev) continue;
      const tag = sev === 'error' ? `${C.r}ERROR${C.x}` : `${C.y}WARN ${C.x}`;
      console.log('');
      console.log(`${tag} ${C.b}${ruleId}${C.x} ${C.d}(${group.length})${C.x}`);
      for (const f of group.slice(0, 6)) {
        const where = f.line ? `${f.file}:${f.line}` : f.file;
        console.log(`   ${where}`);
        console.log(`     ${f.message}${f.unverified ? ` ${C.y}[threshold unverified]${C.x}` : ''}`);
      }
      if (group.length > 6) console.log(`   ${C.d}... and ${group.length - 6} more${C.x}`);
      console.log(`   ${C.d}why: ${group[0].because}${C.x}`);
    }
  }

  console.log('');
  if (!errors.length && !warns.length) {
    console.log(`${C.g}Clean.${C.x} No findings.`);
  } else {
    const e = errors.length ? `${C.r}${errors.length} error(s)${C.x}` : '0 errors';
    const w = warns.length ? `${C.y}${warns.length} warning(s)${C.x}` : '0 warnings';
    console.log(`${e}, ${w}.`);
  }
  console.log(errors.length
    ? `${C.r}Not ready to deploy.${C.x} Errors are things we measured breaking on this tenant.`
    : `${C.g}Deploy gate: PASS.${C.x} Warnings are advisory.`);
  console.log('');
  return errors.length ? 1 : 0;
}

/* ---------------------------------------------------------------- CLI */

function main(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log('Usage: node harness/lint/lint.js <path> --avenue scorm|topic|widget|external [--json]');
    return 0;
  }
  const target = args.find(a => !a.startsWith('-'));
  const ai = args.indexOf('--avenue');
  const avenue = ai >= 0 ? args[ai + 1] : null;
  const asJson = args.includes('--json');

  if (!target) { console.error('No path given.'); return 2; }
  if (!fs.existsSync(target)) { console.error(`Path not found: ${target}`); return 2; }
  if (!avenue || !AVENUES.includes(avenue)) {
    console.error(`--avenue must be one of: ${AVENUES.join(', ')}`);
    return 2;
  }

  const profile = loadProfile();
  const root = path.resolve(target);
  const result = lint(root, avenue, profile);

  if (asJson) {
    const errors = result.findings.filter(f => f.severity === 'error');
    console.log(JSON.stringify({
      avenue, root, fileCount: result.fileCount, rulesRun: result.ran,
      errorCount: errors.length,
      warnCount: result.findings.length - errors.length,
      pass: errors.length === 0,
      findings: result.findings
    }, null, 2));
    return errors.length ? 1 : 0;
  }
  return report(result, avenue, root, profile);
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { lint, collect };
