/* =====================================================================
   SCSU D2L lint rules
   ---------------------------------------------------------------------
   Every rule here traces to something measured on our tenant and recorded
   in probes/RESULTS.md. Each carries a `because` explaining what we saw,
   so a finding teaches rather than just scolds.

   Thresholds come from tenant-profile.json. When a rule leans on a value
   that has not been verified, it says so in its own output.
   ===================================================================== */

'use strict';

/* ------------------------------------------------------------ helpers */

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/** All matches of `re` with line numbers. `re` must be global. */
function matches(text, re) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ index: m.index, text: m[0], groups: m.slice(1), line: lineOf(text, m.index) });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/**
 * Character ranges of blocks opened by `opener` (a global regex ending at `{`).
 * Brace-matched, so nested blocks are handled. Naive about braces inside
 * strings and comments, which is acceptable for a linting heuristic.
 */
function blockRanges(text, opener) {
  const ranges = [];
  opener.lastIndex = 0;
  let m;
  while ((m = opener.exec(text)) !== null) {
    let i = text.indexOf('{', m.index);
    if (i < 0) continue;
    let depth = 0;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end > i) ranges.push([m.index, end]);
    if (m.index === opener.lastIndex) opener.lastIndex++;
  }
  return ranges;
}

function inAnyRange(offset, ranges) {
  return ranges.some(([a, b]) => offset > a && offset < b);
}

/**
 * Blank out comments, preserving length and newlines so offsets and line
 * numbers stay valid. Needed wherever a rule looks for evidence of a guard:
 * a comment that merely mentions ".length" must not count as one. Caught by
 * our own fixture, where the comment explaining the defect suppressed it.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
    .replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
}

const FUNCTION_OPENER = /\bfunction\b[^(){;]*\([^)]*\)\s*\{|=>\s*\{/g;
const TRY_OPENER = /\btry\s*\{/g;

function unwrap(node, fallback) {
  if (node === undefined || node === null) return { value: fallback, verified: false };
  if (typeof node === 'object' && 'value' in node) return node;
  return { value: node, verified: false };
}

/** Build a finding. `profileRef` marks values that may be unverified guesses. */
function finding(rule, file, line, message, extra) {
  return Object.assign({ rule: rule.id, severity: rule.severity, file, line, message,
                         because: rule.because }, extra || {});
}

/* Files that are actual code/markup, not assets. */
const isCode = f => f.ext === '.html' || f.ext === '.htm' || f.ext === '.js';
const isMarkup = f => f.ext === '.html' || f.ext === '.htm';

/* ============================================================== rules */

const RULES = [

  /* ---------------------------------------------------------- SCORM */

  {
    id: 'scorm/no-api-calls',
    avenues: ['scorm'],
    severity: 'error',
    because: 'A SCORM package runs on content-service.brightspace.com, cross-origin to the tenant. ' +
             'Relative /d2l/api paths hit the content CDN and return 403 MissingKey; absolute tenant ' +
             'URLs fail CORS. There is no path from a package to the Brightspace API.',
    test(ctx) {
      const out = [];
      const re = /['"`][^'"`]*\/d2l\/api\/[^'"`]*['"`]|['"`]https?:\/\/[a-z0-9.-]*\.minnstate\.edu[^'"`]*['"`]/gi;
      for (const f of ctx.files.filter(isCode)) {
        for (const m of matches(f.text, re)) {
          out.push(finding(this, f.rel, m.line,
            `Request to ${m.text.slice(0, 60)} will always fail from inside a package.`));
        }
      }
      return out;
    }
  },

  {
    id: 'scorm/no-terminate-on-load',
    avenues: ['scorm'],
    severity: 'error',
    because: 'Measured: calling LMSFinish/Terminate makes the D2L player immediately replace the ' +
             'package with "This activity is complete." The learner never sees the content. ' +
             'Commit alone persists data.',
    test(ctx) {
      const out = [];
      const re = /\b(LMSFinish|Terminate)\s*\(/g;
      for (const f of ctx.files.filter(isCode)) {
        const fns = blockRanges(f.text, new RegExp(FUNCTION_OPENER.source, 'g'));
        for (const m of matches(f.text, re)) {
          // Inside a function body it is probably deferred to a real event.
          // At top level it runs on load, which is the failure we hit.
          if (!inAnyRange(m.index, fns)) {
            out.push(finding(this, f.rel, m.line,
              `${m.groups[0]} is called at top level, so it runs on load and hides the activity.`));
          }
        }
      }
      return out;
    }
  },

  {
    id: 'scorm/no-completed-on-load',
    avenues: ['scorm'],
    severity: 'error',
    because: 'Measured: once an activity reports lesson_status "completed", D2L serves later launches ' +
             'in review mode with credit "no-credit" and rejects every write, silently, with error 0. ' +
             'Marking complete on load gives each student exactly one scoring opportunity and quietly ' +
             'breaks best-of-N.',
    test(ctx) {
      const out = [];
      const re = /(lesson_status|completion_status)\s*['"`]?\s*,\s*['"`]completed['"`]/g;
      for (const f of ctx.files.filter(isCode)) {
        const fns = blockRanges(f.text, new RegExp(FUNCTION_OPENER.source, 'g'));
        for (const m of matches(f.text, re)) {
          if (!inAnyRange(m.index, fns)) {
            out.push(finding(this, f.rel, m.line,
              'Writes "completed" at top level, so it fires on load and locks all later attempts.'));
          }
        }
      }
      return out;
    }
  },

  {
    id: 'scorm/credit-guard',
    avenues: ['scorm'],
    severity: 'warn',
    because: 'Measured: credit == "no-credit" covers BOTH instructor preview and post-completion ' +
             'review. In those modes every SetValue is discarded and GetLastError still returns 0, so ' +
             'an activity that only checks the error code believes it saved.',
    test(ctx) {
      const writes = ctx.files.filter(isCode)
        .some(f => /\b(LMSSetValue|SetValue)\s*\(/.test(f.text));
      const guards = ctx.files.filter(isCode)
        .some(f => /no-credit/.test(f.text));
      if (writes && !guards) {
        return [finding(this, '(build)', 0,
          'Activity writes to the SCORM data model but never checks for credit == "no-credit".')];
      }
      return [];
    }
  },

  {
    id: 'scorm/commit-before-terminate',
    avenues: ['scorm'],
    severity: 'error',
    because: 'Without a Commit, everything written during the session is lost when the attempt closes.',
    test(ctx) {
      const code = ctx.files.filter(isCode);
      const writes = code.some(f => /\b(LMSSetValue|SetValue)\s*\(/.test(f.text));
      const commits = code.some(f => /\b(LMSCommit|Commit)\s*\(/.test(f.text));
      if (writes && !commits) {
        return [finding(this, '(build)', 0,
          'Activity writes data but never calls Commit. Nothing will persist.')];
      }
      return [];
    }
  },

  {
    id: 'scorm/suspend-data-cap',
    avenues: ['scorm'],
    severity: 'warn',
    because: 'Only SCORM 1.2 is exposed on this tenant, so suspend_data is capped. Writing past the ' +
             'cap is rejected or truncated, and it is the classic silent data-loss bug.',
    test(ctx) {
      const cap = unwrap(ctx.profile.scorm && ctx.profile.scorm.suspendDataMaxChars, 4096);
      const out = [];
      for (const f of ctx.files.filter(isCode)) {
        for (const m of matches(f.text, /suspend_data/g)) {
          const window_ = f.text.slice(Math.max(0, m.index - 400), m.index + 400);
          const guarded = /\.length|\.slice\(|\bcap\b|\bMAX_/i.test(window_);
          if (!guarded) {
            out.push(finding(this, f.rel, m.line,
              `suspend_data written with no length guard. Cap on this tenant is ${cap.value} chars.`,
              { unverified: !cap.verified }));
          }
        }
      }
      return out;
    }
  },

  {
    id: 'scorm/storage-key-learner-id',
    avenues: ['scorm'],
    severity: 'warn',
    because: 'Measured the hard way: package localStorage belongs to the shared content-service origin ' +
             'and is per BROWSER, not per D2L user. Signing out and back in as someone else does not ' +
             'change it. Every SCORM package at SCSU shares that one store.',
    test(ctx) {
      const out = [];
      const re = /localStorage\.(?:get|set|remove)Item\s*\(\s*(['"`])([^'"`]*)\1\s*[,)]/g;
      for (const f of ctx.files.filter(isCode)) {
        for (const m of matches(f.text, re)) {
          out.push(finding(this, f.rel, m.line,
            `Storage key "${m.groups[1]}" is a fixed literal with no learner id. Two students on one ` +
            `machine will share it.`));
        }
      }
      return out;
    }
  },

  {
    id: 'scorm/root-height',
    avenues: ['scorm'],
    severity: 'warn',
    because: 'Measured: the embedded player will not scroll a tall child. Wheel, scrollbar drag, ' +
             'keyboard and parent resize all failed against a 1100px root. Content below the fold was ' +
             'unreachable.',
    test(ctx) {
      const out = [];
      const limit = 600;
      for (const f of ctx.files.filter(isCode)) {
        for (const m of matches(f.text, /height\s*:\s*(\d{3,5})px/g)) {
          const px = parseInt(m.groups[0], 10);
          if (px > limit) {
            out.push(finding(this, f.rel, m.line,
              `Fixed height ${px}px exceeds ~${limit}px. Keep the package short, or set the instance ` +
              `to "Open player in new window".`));
          }
        }
      }
      return out;
    }
  },

  {
    id: 'scorm/manifest',
    avenues: ['scorm'],
    severity: 'error',
    because: 'A SCORM package needs imsmanifest.xml at the ZIP ROOT. Every file it declares must exist ' +
             'or D2L rejects the package with an unhelpful error.',
    test(ctx) {
      const manifest = ctx.files.find(f => f.rel.toLowerCase() === 'imsmanifest.xml');
      if (!manifest) {
        return [finding(this, '(build)', 0, 'No imsmanifest.xml at the root of the build.')];
      }
      const out = [];
      const declared = matches(manifest.text, /<file\s+href\s*=\s*"([^"]+)"/g).map(m => m.groups[0]);
      const have = new Set(ctx.files.map(f => f.rel.replace(/\\/g, '/')));
      for (const d of declared) {
        if (!have.has(d)) {
          out.push(finding(this, 'imsmanifest.xml', 0, `Declares "${d}" but that file is not in the build.`));
        }
      }
      if (!/adlcp:scormtype\s*=\s*"sco"/i.test(manifest.text)) {
        out.push(finding(this, 'imsmanifest.xml', 0,
          'No resource marked scormtype="sco". Without a SCO there is no run-time and no grade.'));
      }
      return out;
    }
  },

  /* -------------------------------------------------- content topic */

  {
    id: 'topic/no-static-script-src',
    avenues: ['topic'],
    severity: 'error',
    because: 'Measured on two SCSU courses with OPPOSITE results: a static <script src> executed in one ' +
             'and was silently inert in the other. The failure is silent, so build via dynamic injection ' +
             'or fetch, which works either way.',
    test(ctx) {
      const out = [];
      const re = /<script\b[^>]*\bsrc\s*=\s*(['"])(?!https?:|\/\/)([^'"]+)\1/gi;
      for (const f of ctx.files.filter(isMarkup)) {
        for (const m of matches(f.text, re)) {
          out.push(finding(this, f.rel, m.line,
            `Static <script src="${m.groups[1]}"> may silently not execute. Inject it or fetch it.`));
        }
      }
      return out;
    }
  },

  {
    id: 'topic/unwrapped-storage',
    avenues: ['topic', 'widget'],
    severity: 'error',
    because: 'Storage THROWS rather than returning null in private mode, under policy, or over quota. ' +
             'An unwrapped call inside init takes the whole activity down and renders blank, with a ' +
             'console error that points nowhere useful.',
    test(ctx) {
      const out = [];
      const re = /\b(?:local|session)Storage\s*\.\s*(?:get|set|remove)Item\s*\(/g;
      for (const f of ctx.files.filter(isCode)) {
        const tries = blockRanges(f.text, new RegExp(TRY_OPENER.source, 'g'));
        for (const m of matches(f.text, re)) {
          if (!inAnyRange(m.index, tries)) {
            out.push(finding(this, f.rel, m.line,
              'Storage access is not inside a try/catch. This is the single most common way an activity ' +
              'dies on one student machine and nobody else\'s.'));
          }
        }
      }
      return out;
    }
  },

  {
    id: 'topic/namespaced-storage',
    avenues: ['topic', 'widget'],
    severity: 'warn',
    because: 'A content topic is same-origin with the entire LMS, so its storage is shared with every ' +
             'other topic AND with D2L\'s own code.',
    test(ctx) {
      const out = [];
      const re = /(?:local|session)Storage\.(?:get|set|remove)Item\s*\(\s*(['"`])([^'"`]*)\1/g;
      for (const f of ctx.files.filter(isCode)) {
        for (const m of matches(f.text, re)) {
          if (!m.groups[1].includes(':')) {
            out.push(finding(this, f.rel, m.line,
              `Storage key "${m.groups[1]}" is not namespaced. Prefix it, e.g. "myactivity:${m.groups[1]}".`));
          }
        }
      }
      return out;
    }
  },

  {
    id: 'topic/no-storage-for-grades',
    avenues: ['topic', 'scorm', 'widget'],
    severity: 'error',
    because: 'localStorage is device-local, student-editable, and wiped by clearing browser data. It ' +
             'can never back completion tracking or grades. Those go through D2L\'s own tools.',
    test(ctx) {
      const out = [];
      const re = /(?:local|session)Storage\.setItem\s*\(\s*(['"`])([^'"`]*(?:grade|score|mark|completion|passed)[^'"`]*)\1/gi;
      for (const f of ctx.files.filter(isCode)) {
        for (const m of matches(f.text, re)) {
          out.push(finding(this, f.rel, m.line,
            `Key "${m.groups[1]}" looks like authoritative record-keeping in browser storage.`));
        }
      }
      return out;
    }
  },

  {
    id: 'topic/generic-sibling-filename',
    avenues: ['topic'],
    severity: 'warn',
    because: 'Measured: every content-topic build in a course shares one flat Manage Files ' +
             'folder, not a per-build directory. A sibling asset uploaded under a generic name ' +
             'came within one confirm-click of silently overwriting an unrelated, live build\'s ' +
             'file of the same name; only a size/date mismatch in the Confirm File Replace ' +
             'dialog caught it.',
    test(ctx) {
      const GENERIC = new Set([
        'data.js', 'style.js', 'styles.js', 'assets.js', 'script.js', 'scripts.js',
        'config.js', 'app.js', 'main.js', 'common.js', 'util.js', 'utils.js', 'helpers.js',
        'style.css', 'styles.css', 'main.css', 'common.css'
      ]);
      const out = [];
      for (const f of ctx.files) {
        const base = f.rel.replace(/\\/g, '/').split('/').pop().toLowerCase();
        if (GENERIC.has(base)) {
          out.push(finding(this, f.rel, 0,
            `"${base}" is a generic filename. Every build in this course shares one flat ` +
            `content folder, so it can collide with another build's file of the same name. ` +
            `Prefix it with something build-specific, e.g. "yourbuild-${base}".`));
        }
      }
      return out;
    }
  },

  {
    id: 'topic/no-grade-writes',
    avenues: ['topic'],
    severity: 'warn',
    because: 'Measured: a student session carries a usable XSRF token, and D2L correctly refuses grade ' +
             'writes with 403. So this cannot forge a grade, but it will fail in production and the ' +
             'attempt looks like tampering in the logs.',
    test(ctx) {
      const out = [];
      const re = /['"`][^'"`]*\/d2l\/api\/[^'"`]*\/grades\/[^'"`]*['"`]/gi;
      for (const f of ctx.files.filter(isCode)) {
        for (const m of matches(f.text, re)) {
          const window_ = f.text.slice(Math.max(0, m.index - 300), m.index + 300);
          if (/method\s*:\s*['"`](PUT|POST)/i.test(window_)) {
            out.push(finding(this, f.rel, m.line,
              'Writes to the grades API from a page that runs in the learner\'s session. D2L will 403 this.'));
          }
        }
      }
      return out;
    }
  },

  /* --------------------------------------------------------- widget */

  {
    id: 'widget/unscoped-css',
    avenues: ['widget'],
    severity: 'error',
    because: 'Measured: a widget is NOT rendered in an iframe. It sits directly in the LMS page, ' +
             'so a bare selector restyles D2L\'s own chrome and every other widget on the homepage. ' +
             'A content topic is iframed and therefore isolated; a widget has no such protection.',
    test(ctx) {
      const out = [];
      for (const f of ctx.files.filter(isMarkup)) {
        for (const styleBlock of matches(f.text, /<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
          const css = styleBlock.groups[0] || '';
          const base = styleBlock.index;
          for (const rule of matches(css, /([^{}]+)\{[^{}]*\}/g)) {
            const prelude = rule.groups[0].trim();
            if (!prelude || prelude.startsWith('@')) continue;   // @media etc
            for (const sel of prelude.split(',')) {
              const s = sel.trim();
              if (!s) continue;
              // Scoped if the leftmost simple selector is an id or class.
              if (/^[#.]/.test(s)) continue;
              out.push(finding(this, f.rel, lineOf(f.text, base + rule.index),
                `Selector "${s.slice(0, 48)}" is not scoped to the widget. Prefix it with your ` +
                `root id, e.g. "#myWidget ${s.slice(0, 24)}".`));
            }
          }
        }
      }
      return out;
    }
  },

  {
    id: 'widget/global-scope-leak',
    avenues: ['widget'],
    severity: 'error',
    because: 'A widget shares global scope with D2L and every other widget on the homepage. ' +
             'A top-level declaration collides with the next widget that picks the same name.',
    test(ctx) {
      const out = [];
      const re = /^[ \t]*(?:var|let|const|function)\s+([A-Za-z_$][\w$]*)/gm;
      for (const f of ctx.files.filter(isMarkup)) {
        for (const block of matches(f.text, /<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
          const js = block.groups[0] || '';
          const base = block.index;
          const fns = blockRanges(js, new RegExp(FUNCTION_OPENER.source, 'g'));
          for (const m of matches(js, re)) {
            if (!inAnyRange(m.index, fns)) {
              out.push(finding(this, f.rel, lineOf(f.text, base + m.index),
                `"${m.groups[0]}" is declared at top level. Wrap everything in an IIFE: ` +
                `(function () { 'use strict'; ... })();`));
            }
          }
        }
      }
      return out;
    }
  },

  {
    id: 'widget/unnamespaced-id',
    avenues: ['widget'],
    severity: 'warn',
    because: 'The widget shares one document with D2L and every other widget, so a generic id ' +
             'can be claimed twice. getElementById then returns whichever came first.',
    test(ctx) {
      const RISKY = new Set(['header','footer','main','content','nav','sidebar','title','body',
        'container','wrapper','root','app','menu','list','table','form','panel','box','banner',
        'alert','status','output','results','grid','card','info','data','chart','summary']);
      const out = [];
      for (const f of ctx.files.filter(isMarkup)) {
        for (const m of matches(f.text, /\bid\s*=\s*(['"])([^'"]+)\1/g)) {
          const id = m.groups[1];
          if (RISKY.has(id.toLowerCase()) || id.length < 4) {
            out.push(finding(this, f.rel, m.line,
              `Element id "${id}" is generic enough to collide on a shared homepage. Prefix it.`));
          }
        }
      }
      return out;
    }
  },

  {
    id: 'widget/role-as-boundary',
    avenues: ['widget'],
    severity: 'warn',
    because: 'Measured: {RoleId} is substituted server-side, which is convenient, but the value ' +
             'is baked into HTML the viewer already has. It tells the page who is looking; it does ' +
             'not stop anyone reading the rest. Release conditions are enforced on the server and ' +
             'stop the widget rendering at all.',
    test(ctx) {
      const out = [];
      for (const f of ctx.files.filter(isMarkup)) {
        if (!/\{RoleId\}/.test(f.text)) continue;
        // Match both the CSS form (display: none) and the JS form
        // (el.style.display = 'none'), plus the other common ways to hide.
        const hides = new RegExp(
          [
            'display\\s*[:=]\\s*[\'"]?none',
            'visibility\\s*[:=]\\s*[\'"]?hidden',
            '\\.hidden\\s*=',
            '\\bhidden\\b\\s*=\\s*true',
            '\\.remove\\s*\\(\\s*\\)',
            'removeChild\\s*\\('
          ].join('|'), 'i').test(f.text);
        if (hides) {
          out.push(finding(this, f.rel, (matches(f.text, /\{RoleId\}/g)[0] || {}).line || 0,
            'Content appears to be shown or hidden based on {RoleId}. Fine for convenience, but if ' +
            'it genuinely must not reach students, attach a release condition instead.'));
        }
      }
      return out;
    }
  },

  {
    id: 'widget/keep-it-short',
    avenues: ['widget'],
    severity: 'warn',
    because: 'The course homepage is a commons with a small shared attention budget. A widget has ' +
             'to earn its space against everything else competing for the same glance. If it needs ' +
             'scrolling, it is a content topic.',
    test(ctx) {
      const out = [];
      const limit = 400;
      for (const f of ctx.files.filter(isCode)) {
        for (const m of matches(f.text, /height\s*:\s*(\d{3,5})px/g)) {
          const px = parseInt(m.groups[0], 10);
          if (px > limit) {
            out.push(finding(this, f.rel, m.line,
              `Fixed height ${px}px is large for a homepage panel (guide: ~${limit}px). ` +
              `Consider whether this wants to be a content topic.`));
          }
        }
      }
      return out;
    }
  },

  /* --------------------------------------------------------- shared */

  {
    id: 'shared/no-viewport-units',
    avenues: ['scorm', 'topic'],
    severity: 'error',
    because: 'The D2L content iframe auto-resizes to its content height, so viewport units do not mean ' +
             '"the visible area". Give the root a fixed pixel height instead.',
    test(ctx) {
      const out = [];
      for (const f of ctx.files.filter(f => isCode(f) || f.ext === '.css')) {
        for (const m of matches(f.text, /\b\d+(?:\.\d+)?v(?:h|w|min|max)\b/g)) {
          out.push(finding(this, f.rel, m.line,
            `Viewport unit "${m.text}" is unreliable inside the auto-sizing iframe.`));
        }
      }
      return out;
    }
  },

  {
    id: 'shared/external-cdn',
    avenues: ['scorm', 'topic', 'widget'],
    severity: 'warn',
    because: 'Campus network policy may block external hosts, and a SCORM package is already isolated. ' +
             'Vendor the dependency locally and degrade gracefully.',
    test(ctx) {
      const out = [];
      const re = /<(?:script|link)\b[^>]*(?:src|href)\s*=\s*(['"])(https?:\/\/[^'"]+)\1/gi;
      for (const f of ctx.files.filter(isMarkup)) {
        for (const m of matches(f.text, re)) {
          out.push(finding(this, f.rel, m.line, `External dependency: ${m.groups[1].slice(0, 70)}`));
        }
      }
      return out;
    }
  },

  {
    id: 'shared/missing-assets',
    avenues: ['scorm', 'topic', 'widget'],
    severity: 'error',
    because: 'Relative paths resolve against the deployed file. A reference that is missing locally is ' +
             'missing in D2L, where it fails silently.',
    test(ctx) {
      const out = [];
      const have = new Set(ctx.files.map(f => f.rel.replace(/\\/g, '/').toLowerCase()));
      const re = /(?:src|href)\s*=\s*(['"])(?!https?:|\/\/|#|data:|mailto:)([^'"?#]+)(?:[?#][^'"]*)?\1/gi;
      for (const f of ctx.files.filter(isMarkup)) {
        for (const m of matches(f.text, re)) {
          const ref = m.groups[1].replace(/^\.\//, '').toLowerCase();
          if (!have.has(ref)) {
            out.push(finding(this, f.rel, m.line, `References "${m.groups[1]}" which is not in the build.`));
          }
        }
      }
      return out;
    }
  }
];

/* NOTE ON `f.text`: the collector hands rules COMMENT-STRIPPED source, with the
   original kept as `f.raw`. Comments are blanked in place so offsets and line
   numbers stay exact. This matters in both directions: commented-out code must
   not raise a finding, and prose that happens to mention ".length" must not
   satisfy a guard check. Our own fixture hit the second case. */

module.exports = {
  RULES,
  helpers: { lineOf, matches, blockRanges, inAnyRange, unwrap, stripComments }
};
