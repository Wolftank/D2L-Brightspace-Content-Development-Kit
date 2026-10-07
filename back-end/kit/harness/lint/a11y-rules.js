/* =====================================================================
   Proposed accessibility rules for the QA gate (Q10 spike, #55)
   ---------------------------------------------------------------------
   WCAG 2.2 Level A and AA checks that need only a package's files. Each
   rule names its success criterion, so the finding tells the instructor
   which criterion failed and how to fix it.

   These rules read static markup. Elements a build creates in JavaScript
   at run time are out of reach here and need a rendered-page check.
   ===================================================================== */

'use strict';

const { helpers } = require('./rules');
const { matches, lineOf } = helpers;

const isCode = f => f.ext === '.html' || f.ext === '.htm' || f.ext === '.js';
const isMarkup = f => f.ext === '.html' || f.ext === '.htm';

/** Ranges of `<script>` blocks, so markup rules skip HTML built inside JavaScript strings. */
function scriptRanges(text) {
  return matches(text, /<script\b[^>]*>[\s\S]*?<\/script>/gi).map(m => [m.index, m.index + m.text.length]);
}

function outside(ranges) {
  return m => !ranges.some(([a, b]) => m.index >= a && m.index < b);
}

/** Value of attribute `name` in an opening tag, '' for a bare attribute, or null when absent. */
function attr(tag, name) {
  const m = new RegExp('\\s' + name + '(?:\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+)))?(?=[\\s/>])', 'i').exec(tag);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? '';
}

const hasValue = v => v !== null && v.trim() !== '';

/** Text a screen reader would read for an element's contents, counting image alt text. */
function innerName(html) {
  return html
    .replace(/<img\b[^>]*>/gi, tag => ' ' + (attr(tag, 'alt') || '') + ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .trim();
}

/** True when the tag carries its own accessible name. */
function namedByAttribute(tag) {
  return hasValue(attr(tag, 'aria-label')) || hasValue(attr(tag, 'aria-labelledby')) || hasValue(attr(tag, 'title'));
}

/** Build a finding whose message leads with the WCAG criterion. */
function a11yFinding(rule, file, line, message) {
  return {
    rule: rule.id, severity: rule.severity, file, line,
    message: `WCAG 2.2 ${rule.wcag}: ${message}`,
    because: rule.because
  };
}

const RULES = [

  {
    id: 'a11y/img-alt',
    wcag: '1.1.1 Non-text Content (A)',
    avenues: ['scorm', 'topic', 'widget'],
    severity: 'error',
    because: 'A screen reader announces an image with no alt attribute by its file name, or skips it ' +
             'with no hint that something is there. Students who cannot see it lose whatever it shows.',
    test(ctx) {
      const out = [];
      for (const f of ctx.files.filter(isCode)) {
        const tags = [
          ...matches(f.text, /<img\b[^>]*>/gi),
          ...matches(f.text, /<area\b[^>]*>/gi),
          ...matches(f.text, /<input\b[^>]*\btype\s*=\s*['"]?image\b[^>]*>/gi)
        ];
        for (const m of tags) {
          if (attr(m.text, 'alt') !== null) continue;
          if (attr(m.text, 'aria-hidden') === 'true' || /^(presentation|none)$/i.test(attr(m.text, 'role') || '')) continue;
          if (namedByAttribute(m.text)) continue;
          out.push(a11yFinding(this, f.rel, m.line,
            `${m.text.slice(0, 60)} has no alt attribute. Describe what the image shows in alt="...", ` +
            'or use alt="" if it is only decoration.'));
        }
      }
      return out;
    }
  },

  {
    id: 'a11y/html-lang',
    wcag: '3.1.1 Language of Page (A)',
    avenues: ['scorm', 'topic'],
    severity: 'error',
    because: 'Screen readers choose their pronunciation from the page language. Without it, the page ' +
             'is read with the student\'s default voice, which garbles any other language.',
    test(ctx) {
      const out = [];
      for (const f of ctx.files.filter(isMarkup)) {
        for (const m of matches(f.text, /<html\b[^>]*>/gi)) {
          const lang = attr(m.text, 'lang');
          if (!hasValue(lang)) {
            out.push(a11yFinding(this, f.rel, m.line,
              'The <html> tag has no lang attribute. Add the page language, e.g. <html lang="en">.'));
          } else if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(lang.trim())) {
            out.push(a11yFinding(this, f.rel, m.line,
              `lang="${lang}" is not a language code. Use a code such as "en" or "es-MX".`));
          }
        }
      }
      return out;
    }
  },

  {
    id: 'a11y/heading-order',
    wcag: '1.3.1 Info and Relationships (A)',
    avenues: ['scorm', 'topic', 'widget'],
    severity: 'warn',
    because: 'Screen reader users move through a page by its headings. A skipped level, such as an h4 ' +
             'straight after an h2, suggests a missing section and makes the structure harder to follow.',
    test(ctx) {
      const out = [];
      for (const f of ctx.files.filter(isMarkup)) {
        const scripts = scriptRanges(f.text);
        let previous = 0;
        for (const m of matches(f.text, /<h([1-6])\b[^>]*>/gi).filter(outside(scripts))) {
          const level = Number(m.groups[0]);
          if (previous && level > previous + 1) {
            out.push(a11yFinding(this, f.rel, m.line,
              `<h${level}> follows <h${previous}>, skipping a level. Use <h${previous + 1}> here, ` +
              'or restyle the heading with CSS instead of changing its level.'));
          }
          previous = level;
        }
      }
      return out;
    }
  },

  {
    id: 'a11y/page-title',
    wcag: '2.4.2 Page Titled (A)',
    avenues: ['scorm', 'topic'],
    severity: 'warn',
    because: 'The page title is the first thing a screen reader announces and the name shown when the ' +
             'activity opens in its own window. D2L names the frame, so this matters most in a new window.',
    test(ctx) {
      const out = [];
      for (const f of ctx.files.filter(isMarkup)) {
        if (!/<html\b/i.test(f.text)) continue;
        const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(f.text);
        if (!title || !title[1].trim()) {
          out.push(a11yFinding(this, f.rel, title ? lineOf(f.text, title.index) : 0,
            'The page has no <title>. Add one that names the activity.'));
        }
      }
      return out;
    }
  },

  {
    id: 'a11y/control-name',
    wcag: '4.1.2 Name, Role, Value (A)',
    avenues: ['scorm', 'topic', 'widget'],
    severity: 'error',
    because: 'A button or link with no text is announced only as "button" or "link", so a screen reader ' +
             'user cannot tell what it does.',
    test(ctx) {
      const out = [];
      for (const f of ctx.files.filter(isMarkup)) {
        const scripts = scriptRanges(f.text);
        const controls = [
          ...matches(f.text, /(<button\b[^>]*>)([\s\S]*?)<\/button>/gi),
          ...matches(f.text, /(<a\b[^>]*\bhref\b[^>]*>)([\s\S]*?)<\/a>/gi)
        ].filter(outside(scripts));
        for (const m of controls) {
          const [open, inner] = m.groups;
          if (namedByAttribute(open) || innerName(inner)) continue;
          const kind = /^<button/i.test(open) ? 'button' : 'link';
          out.push(a11yFinding(this, f.rel, m.line,
            `A ${kind} has no text. Put visible text inside it, or an aria-label that says what it does.`));
        }
      }
      return out;
    }
  },

  {
    id: 'a11y/form-label',
    wcag: '3.3.2 Labels or Instructions (A)',
    avenues: ['scorm', 'topic', 'widget'],
    severity: 'error',
    because: 'A field with no label is announced as "edit text" or "combo box", so a screen reader user ' +
             'has to guess what to type or choose.',
    test(ctx) {
      const out = [];
      const skip = /^(hidden|submit|button|reset|image)$/i;
      for (const f of ctx.files.filter(isMarkup)) {
        const scripts = scriptRanges(f.text);
        const labelled = new Set(matches(f.text, /<label\b[^>]*>/gi).map(m => attr(m.text, 'for')).filter(hasValue));
        const wrappers = matches(f.text, /<label\b[\s\S]*?<\/label>/gi).map(m => [m.index, m.index + m.text.length]);
        const fields = matches(f.text, /<(?:input|select|textarea)\b[^>]*>/gi).filter(outside(scripts));
        for (const m of fields) {
          if (/^<input/i.test(m.text) && skip.test(attr(m.text, 'type') || '')) continue;
          const id = attr(m.text, 'id');
          if (namedByAttribute(m.text) || (hasValue(id) && labelled.has(id)) || !outside(wrappers)(m)) continue;
          out.push(a11yFinding(this, f.rel, m.line,
            `${m.text.slice(0, 60)} has no label. Add <label for="..."> with a matching id, ` +
            'or wrap the field in a <label>.'));
        }
      }
      return out;
    }
  },

  {
    id: 'a11y/iframe-title',
    wcag: '4.1.2 Name, Role, Value (A)',
    avenues: ['scorm', 'topic', 'widget'],
    severity: 'error',
    because: 'A screen reader announces an embedded frame by its title. Without one, a student hears ' +
             '"frame" and cannot tell a video from an unrelated widget.',
    test(ctx) {
      const out = [];
      for (const f of ctx.files.filter(isCode)) {
        for (const m of matches(f.text, /<iframe\b[^>]*>/gi)) {
          if (hasValue(attr(m.text, 'title')) || hasValue(attr(m.text, 'aria-label'))) continue;
          if (attr(m.text, 'aria-hidden') === 'true') continue;
          out.push(a11yFinding(this, f.rel, m.line,
            'An <iframe> has no title. Add title="..." naming what it contains, e.g. title="Lecture video".'));
        }
      }
      return out;
    }
  },

  {
    id: 'a11y/zoom-allowed',
    wcag: '1.4.4 Resize Text (AA)',
    avenues: ['scorm', 'topic'],
    severity: 'error',
    because: 'Low-vision students zoom to read. A viewport that disables zoom, or caps it below 200%, ' +
             'locks them out on phones and tablets.',
    test(ctx) {
      const out = [];
      for (const f of ctx.files.filter(isMarkup)) {
        for (const m of matches(f.text, /<meta\b[^>]*\bname\s*=\s*['"]?viewport\b[^>]*>/gi)) {
          const content = (attr(m.text, 'content') || '').toLowerCase();
          const scalable = /user-scalable\s*=\s*(no|0)\b/.exec(content);
          const max = /maximum-scale\s*=\s*([\d.]+)/.exec(content);
          if (scalable || (max && Number(max[1]) < 2)) {
            out.push(a11yFinding(this, f.rel, m.line,
              'The viewport blocks zooming. Remove user-scalable=no and any maximum-scale below 2.'));
          }
        }
      }
      return out;
    }
  },

  {
    id: 'a11y/timed-refresh',
    wcag: '2.2.1 Timing Adjustable (A)',
    avenues: ['scorm', 'topic'],
    severity: 'error',
    because: 'A timed refresh or redirect moves the page before a slower reader or a screen reader user ' +
             'has finished, with no way to stop it.',
    test(ctx) {
      const out = [];
      for (const f of ctx.files.filter(isMarkup)) {
        for (const m of matches(f.text, /<meta\b[^>]*\bhttp-equiv\s*=\s*['"]?refresh\b[^>]*>/gi)) {
          const delay = parseFloat(attr(m.text, 'content') || '0');
          if (delay > 0) {
            out.push(a11yFinding(this, f.rel, m.line,
              `The page refreshes or redirects after ${delay} seconds. Remove the timed refresh, ` +
              'or let the student continue with a button.'));
          }
        }
      }
      return out;
    }
  },

  {
    id: 'a11y/no-moving-elements',
    wcag: '2.2.2 Pause, Stop, Hide (A)',
    avenues: ['scorm', 'topic', 'widget'],
    severity: 'error',
    because: '<marquee> and <blink> move or flash forever with no pause control, which distracts students ' +
             'with attention or reading difficulties and cannot be stopped.',
    test(ctx) {
      const out = [];
      for (const f of ctx.files.filter(isCode)) {
        for (const m of matches(f.text, /<(marquee|blink)\b/gi)) {
          out.push(a11yFinding(this, f.rel, m.line,
            `<${m.groups[0].toLowerCase()}> cannot be paused. Show the text normally instead.`));
        }
      }
      return out;
    }
  },

  {
    id: 'a11y/positive-tabindex',
    wcag: '2.4.3 Focus Order (A)',
    avenues: ['scorm', 'topic', 'widget'],
    severity: 'warn',
    because: 'A tabindex above 0 pulls an element ahead of everything else in the Tab order, so keyboard ' +
             'users jump around the page out of reading order.',
    test(ctx) {
      const out = [];
      const re = /\btabindex\s*=\s*['"]?\s*([1-9]\d*)|setAttribute\(\s*['"]tabindex['"]\s*,\s*['"]?([1-9]\d*)|\.tabIndex\s*=\s*([1-9]\d*)/gi;
      for (const f of ctx.files.filter(isCode)) {
        for (const m of matches(f.text, re)) {
          const value = m.groups.find(Boolean);
          out.push(a11yFinding(this, f.rel, m.line,
            `tabindex ${value} changes the Tab order. Use tabindex="0", or order the elements in the markup.`));
        }
      }
      return out;
    }
  },

  {
    id: 'a11y/video-captions',
    wcag: '1.2.2 Captions (Prerecorded) (A)',
    avenues: ['scorm', 'topic', 'widget'],
    severity: 'warn',
    because: 'Deaf and hard-of-hearing students need captions to follow a video\'s speech. A warning, not ' +
             'an error, because a video with no speech needs none.',
    test(ctx) {
      const out = [];
      for (const f of ctx.files.filter(isMarkup)) {
        for (const m of matches(f.text, /<video\b[\s\S]*?<\/video>/gi)) {
          if (/<track\b[^>]*\bkind\s*=\s*['"]?(captions|subtitles)\b/i.test(m.text)) continue;
          out.push(a11yFinding(this, f.rel, m.line,
            'A <video> has no captions track. Add <track kind="captions" src="..." srclang="en"> if it has speech.'));
        }
      }
      return out;
    }
  },

  {
    id: 'a11y/autoplay-audio',
    wcag: '1.4.2 Audio Control (A)',
    avenues: ['scorm', 'topic', 'widget'],
    severity: 'warn',
    because: 'Sound that starts on its own talks over a screen reader. WCAG allows it only when it stops ' +
             'within 3 seconds or the student can pause it, which the files alone cannot prove.',
    test(ctx) {
      const out = [];
      for (const f of ctx.files.filter(isMarkup)) {
        for (const m of matches(f.text, /<(audio|video)\b[^>]*>/gi)) {
          if (attr(m.text, 'autoplay') === null || attr(m.text, 'muted') !== null) continue;
          out.push(a11yFinding(this, f.rel, m.line,
            `An <${m.groups[0].toLowerCase()}> plays sound automatically. Remove autoplay, or add muted and controls.`));
        }
      }
      return out;
    }
  }
];

module.exports = { RULES };
