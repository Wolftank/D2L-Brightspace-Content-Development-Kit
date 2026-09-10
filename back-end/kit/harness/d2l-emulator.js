/* =====================================================================
   D2L local emulator
   ---------------------------------------------------------------------
   Reproduces our tenant's SCORM run-time and API surface locally, with
   the constraints from tenant-profile.json actively enforced.

   The point is not to be a friendly sandbox. It is to be at least as
   strict as D2L, so a package that passes here works when deployed.
   Every constraint violation is recorded rather than silently tolerated,
   and the violation log is what a package has to clear before it ships.

   Usage:
     var emu = D2LEmulator.install({
       profile: <parsed tenant-profile.json>,
       learner: { id: 'zzqa-01', name: 'Doe, Jane', role: 'Student' },
       attempt: 1
     });
     ... run the package ...
     emu.report();     // { violations, dataModel, score, ... }
   ===================================================================== */

(function (global) {
  'use strict';

  /* ---------------------------------------------------------- helpers */

  function unwrap(node, fallback) {
    if (node === undefined || node === null) return { value: fallback, verified: false };
    if (typeof node === 'object' && 'value' in node) return node;
    return { value: node, verified: false };
  }

  function nowIso() { return new Date().toISOString(); }

  function fmtTime(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    function p(n, w) { var x = String(n); while (x.length < w) x = '0' + x; return x; }
    return p(h, 4) + ':' + p(m, 2) + ':' + p(s, 2);
  }

  /* ------------------------------------------------- SCORM 1.2 model */

  var RO = 'ro', WO = 'wo', RW = 'rw';

  var MODEL_12 = {
    'cmi.core._children':        { access: RO, value: 'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time' },
    'cmi.core.student_id':       { access: RO, value: '' },
    'cmi.core.student_name':     { access: RO, value: '' },
    'cmi.core.lesson_location':  { access: RW, value: '', maxLen: 255 },
    'cmi.core.credit':           { access: RO, value: 'credit' },
    'cmi.core.lesson_status':    { access: RW, value: 'not attempted', vocab: ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'] },
    'cmi.core.entry':            { access: RO, value: 'ab-initio' },
    'cmi.core.score._children':  { access: RO, value: 'raw,min,max' },
    'cmi.core.score.raw':        { access: RW, value: '', numeric: true, range: [0, 100] },
    'cmi.core.score.min':        { access: RW, value: '', numeric: true },
    'cmi.core.score.max':        { access: RW, value: '', numeric: true },
    'cmi.core.total_time':       { access: RO, value: '0000:00:00.00' },
    'cmi.core.lesson_mode':      { access: RO, value: 'normal' },
    'cmi.core.exit':             { access: WO, value: '', vocab: ['time-out', 'suspend', 'logout', ''] },
    'cmi.core.session_time':     { access: WO, value: '' },
    'cmi.suspend_data':          { access: RW, value: '', maxLen: 4096 },
    'cmi.launch_data':           { access: RO, value: '' },
    'cmi.comments':              { access: RW, value: '', maxLen: 4096 },
    'cmi.comments_from_lms':     { access: RO, value: '' },
    'cmi.objectives._count':     { access: RO, value: '0' },
    'cmi.interactions._count':   { access: RO, value: '0' },
    'cmi.student_data.mastery_score':     { access: RO, value: '' },
    'cmi.student_data.max_time_allowed':  { access: RO, value: '' },
    'cmi.student_data.time_limit_action': { access: RO, value: '' }
  };

  var MODEL_2004 = {
    'cmi._version':          { access: RO, value: '1.0' },
    'cmi.learner_id':        { access: RO, value: '' },
    'cmi.learner_name':      { access: RO, value: '' },
    'cmi.location':          { access: RW, value: '', maxLen: 1000 },
    'cmi.credit':            { access: RO, value: 'credit' },
    'cmi.completion_status': { access: RW, value: 'unknown', vocab: ['completed', 'incomplete', 'not attempted', 'unknown'] },
    'cmi.success_status':    { access: RW, value: 'unknown', vocab: ['passed', 'failed', 'unknown'] },
    'cmi.entry':             { access: RO, value: 'ab-initio' },
    'cmi.mode':              { access: RO, value: 'normal' },
    'cmi.exit':              { access: WO, value: '', vocab: ['time-out', 'suspend', 'logout', 'normal', ''] },
    'cmi.score.raw':         { access: RW, value: '', numeric: true },
    'cmi.score.min':         { access: RW, value: '', numeric: true },
    'cmi.score.max':         { access: RW, value: '', numeric: true },
    'cmi.score.scaled':      { access: RW, value: '', numeric: true, range: [-1, 1] },
    'cmi.total_time':        { access: RO, value: 'PT0H0M0S' },
    'cmi.session_time':      { access: WO, value: '' },
    'cmi.suspend_data':      { access: RW, value: '', maxLen: 64000 },
    'cmi.launch_data':       { access: RO, value: '' },
    'cmi.max_time_allowed':  { access: RO, value: '' },
    'cmi.scaled_passing_score': { access: RO, value: '' },
    'cmi.objectives._count':   { access: RO, value: '0' },
    'cmi.interactions._count': { access: RO, value: '0' }
  };

  var ERR_12 = {
    0: 'No error', 101: 'General exception', 201: 'Invalid argument error',
    202: 'Element cannot have children', 203: 'Element not an array',
    301: 'Not initialized', 401: 'Not implemented error',
    402: 'Invalid set value, element is a keyword', 403: 'Element is read only',
    404: 'Element is write only', 405: 'Incorrect data type'
  };

  var ERR_2004 = {
    0: 'No error', 101: 'General exception', 103: 'Already initialized',
    112: 'Termination before initialization', 122: 'Retrieve data before initialization',
    132: 'Store data before initialization', 142: 'Commit before initialization',
    201: 'General argument error', 401: 'Undefined data model element',
    403: 'Data model element value not initialized', 404: 'Data model element is read only',
    405: 'Data model element is write only', 406: 'Data model element type mismatch',
    407: 'Data model element value out of range'
  };

  /* ======================================================== emulator */

  function install(opts) {
    opts = opts || {};
    var profile = opts.profile || {};
    var sc = profile.scorm || {};
    var fl = profile.fileLoading || {};
    var api = profile.brightspaceApi || {};

    var version   = unwrap(sc.version, '1.2').value;
    var is2004    = (version === '2004');
    var available = unwrap(sc.available, true).value;
    var suspendMax = unwrap(sc.suspendDataMaxChars, is2004 ? 64000 : 4096).value;
    var maxAttempts = unwrap(sc.maxAttempts, 3).value;
    var gradeCalc  = unwrap(sc.gradeCalculation, 'highest').value;
    var commitRequired = unwrap(sc.commitRequiredForPersistence, true).value;

    var learner = opts.learner || { id: 'local-01', name: 'Test, Local', role: 'Student' };
    var attemptNo = opts.attempt || 1;

    var violations = [];
    var calls = [];
    var committedSnapshots = [];

    function violate(kind, detail, severity) {
      violations.push({
        kind: kind,
        detail: detail,
        severity: severity || 'error',
        attempt: attemptNo,
        at: nowIso()
      });
    }

    /* Warn once per unverified constraint that actually bites. */
    var warnedUnverified = {};
    function noteUnverified(path, node) {
      if (node && node.verified === false && !warnedUnverified[path]) {
        warnedUnverified[path] = true;
        violations.push({
          kind: 'unverified-constraint',
          detail: 'Enforced ' + path + ' = ' + JSON.stringify(node.value) +
                  ' but this has not been measured on the tenant. Run the probe.',
          severity: 'warning',
          attempt: attemptNo,
          at: nowIso()
        });
      }
    }

    /* ------------------------------------------------ data model ---- */

    var base = is2004 ? MODEL_2004 : MODEL_12;
    var model = {};
    Object.keys(base).forEach(function (k) {
      model[k] = { access: base[k].access, value: base[k].value,
                   vocab: base[k].vocab, maxLen: base[k].maxLen,
                   numeric: base[k].numeric, range: base[k].range };
    });

    model[is2004 ? 'cmi.learner_id' : 'cmi.core.student_id'].value = learner.id;
    model[is2004 ? 'cmi.learner_name' : 'cmi.core.student_name'].value = learner.name;
    model['cmi.suspend_data'].maxLen = suspendMax;

    if (attemptNo > 1) {
      model[is2004 ? 'cmi.entry' : 'cmi.core.entry'].value =
        unwrap(sc.suspendDataCarriesAcrossAttempts, false).value ? 'resume' : 'ab-initio';
    }

    var initialized = false, terminated = false, lastError = 0;
    var sessionStart = null;

    function setErr(code) { lastError = code; return 'false'; }
    function okErr() { lastError = 0; return 'true'; }

    /* ------------------------------------------------ SCORM methods -- */

    function doInitialize() {
      calls.push({ m: 'Initialize' });
      if (initialized) { violate('double-initialize', 'Initialize called twice'); return setErr(is2004 ? 103 : 101); }
      initialized = true;
      sessionStart = Date.now();
      return okErr();
    }

    function doGetValue(key) {
      calls.push({ m: 'GetValue', k: key });
      if (!initialized) {
        violate('get-before-initialize', 'GetValue("' + key + '") before Initialize');
        return (lastError = is2004 ? 122 : 301), '';
      }
      if (terminated) { lastError = is2004 ? 123 : 101; return ''; }
      var e = model[key];
      if (!e) {
        violate('unknown-element', 'GetValue on undefined element "' + key + '"');
        lastError = is2004 ? 401 : 201; return '';
      }
      if (e.access === WO) {
        violate('read-write-only', 'GetValue on write-only element "' + key + '"');
        lastError = is2004 ? 405 : 404; return '';
      }
      lastError = 0;
      return String(e.value);
    }

    function doSetValue(key, val) {
      val = String(val);
      calls.push({ m: 'SetValue', k: key, v: val.length > 60 ? val.slice(0, 60) + '…' : val });

      if (!initialized) {
        violate('set-before-initialize', 'SetValue("' + key + '") before Initialize');
        return setErr(is2004 ? 132 : 301);
      }
      if (terminated) { return setErr(is2004 ? 133 : 101); }

      var e = model[key];
      if (!e) {
        violate('unknown-element', 'SetValue on undefined element "' + key + '"');
        return setErr(is2004 ? 401 : 201);
      }
      if (e.access === RO) {
        violate('write-read-only', 'SetValue on read-only element "' + key + '"');
        return setErr(is2004 ? 404 : 403);
      }
      if (e.vocab && e.vocab.indexOf(val) < 0) {
        violate('bad-vocabulary',
          'SetValue("' + key + '", "' + val + '") is not in the allowed vocabulary [' + e.vocab.join(', ') + ']');
        return setErr(is2004 ? 406 : 405);
      }
      if (e.numeric && val !== '' && isNaN(Number(val))) {
        violate('bad-type', 'SetValue("' + key + '", "' + val + '") is not numeric');
        return setErr(is2004 ? 406 : 405);
      }
      if (e.range && val !== '') {
        var n = Number(val);
        if (n < e.range[0] || n > e.range[1]) {
          violate('out-of-range', 'SetValue("' + key + '", ' + n + ') outside [' + e.range.join(', ') + ']');
          return setErr(is2004 ? 407 : 405);
        }
      }
      if (e.maxLen && val.length > e.maxLen) {
        if (key === 'cmi.suspend_data') noteUnverified('scorm.suspendDataMaxChars', sc.suspendDataMaxChars);
        violate('too-long',
          key + ' is ' + val.length + ' chars, tenant limit is ' + e.maxLen +
          '. D2L will truncate or reject. This is the classic silent data-loss bug.');
        return setErr(is2004 ? 407 : 405);
      }

      e.value = val;
      return okErr();
    }

    function doCommit() {
      calls.push({ m: 'Commit' });
      if (!initialized) {
        violate('commit-before-initialize', 'Commit before Initialize');
        return setErr(is2004 ? 142 : 301);
      }
      committedSnapshots.push(snapshotValues());
      return okErr();
    }

    function doTerminate() {
      calls.push({ m: 'Terminate' });
      if (!initialized) { violate('terminate-before-initialize', 'Terminate before Initialize'); return setErr(is2004 ? 112 : 301); }
      if (terminated)   { violate('double-terminate', 'Terminate called twice'); return setErr(is2004 ? 113 : 101); }
      if (sessionStart) {
        model[is2004 ? 'cmi.session_time' : 'cmi.core.session_time'].value = fmtTime(Date.now() - sessionStart);
      }
      if (commitRequired && !committedSnapshots.length) {
        violate('terminate-without-commit',
          'Terminated with no Commit. Everything written this session is lost on this tenant.');
      }
      terminated = true;
      return okErr();
    }

    function snapshotValues() {
      var out = {};
      Object.keys(model).forEach(function (k) {
        if (model[k].access !== WO) out[k] = model[k].value;
      });
      return out;
    }

    /* ---------------------------------------------- install the API -- */

    var apiObject = null;
    if (available) {
      if (is2004) {
        apiObject = {
          Initialize: doInitialize, Terminate: doTerminate,
          GetValue: doGetValue, SetValue: doSetValue, Commit: doCommit,
          GetLastError: function () { return String(lastError); },
          GetErrorString: function (c) { return ERR_2004[Number(c)] || 'Unknown error'; },
          GetDiagnostic: function (c) { return ERR_2004[Number(c)] || ''; }
        };
        global.API_1484_11 = apiObject;
      } else {
        apiObject = {
          LMSInitialize: doInitialize, LMSFinish: doTerminate,
          LMSGetValue: doGetValue, LMSSetValue: doSetValue, LMSCommit: doCommit,
          LMSGetLastError: function () { return String(lastError); },
          LMSGetErrorString: function (c) { return ERR_12[Number(c)] || 'Unknown error'; },
          LMSGetDiagnostic: function (c) { return ERR_12[Number(c)] || ''; }
        };
        global.API = apiObject;
      }
    }

    /* -------------------------------------- Brightspace API emulation */

    var realFetch = global.fetch ? global.fetch.bind(global) : null;
    var reachableFromScorm = unwrap(api.reachableFromScorm, false).value;
    var studentBlocked = unwrap(api.studentBlockedFromClassData, true).value;
    var role = learner.role || 'Student';

    function jsonResponse(status, body) {
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: status,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    function handleD2lApi(url) {
      if (!reachableFromScorm) {
        noteUnverified('brightspaceApi.reachableFromScorm', api.reachableFromScorm);
        violate('api-from-scorm',
          'Package called ' + url + '. The tenant profile says the Brightspace API is ' +
          'not reachable from inside a SCORM package. Do not build on this.');
        return Promise.reject(new TypeError('Failed to fetch'));
      }

      if (/\/users\/whoami/.test(url)) {
        return jsonResponse(200, {
          Identifier: learner.id,
          FirstName: String(learner.name).split(',').pop().trim(),
          LastName: String(learner.name).split(',')[0].trim(),
          UniqueName: learner.id,
          ProfileIdentifier: 'emu-' + learner.id
        });
      }

      if (/\/(classlist|grades)(\/|$)/.test(url) && !/myGradeValues/.test(url)) {
        if (role === 'Student' && studentBlocked) {
          noteUnverified('brightspaceApi.studentBlockedFromClassData', api.studentBlockedFromClassData);
          return jsonResponse(403, { Errors: [{ Message: 'Not authorized' }] });
        }
        if (role === 'Student') {
          violate('class-data-to-student',
            'Tenant profile permits a student to read class-wide data. That is a ' +
            'misconfiguration and must be confirmed with IT before shipping.');
        }
        return jsonResponse(200, [{ Identifier: 'emu-1', DisplayName: 'Emulated, Learner' }]);
      }

      if (/myGradeValues/.test(url)) {
        return jsonResponse(200, [{ GradeObjectName: 'Emulated item', PointsNumerator: 85, PointsDenominator: 100 }]);
      }

      return jsonResponse(404, { Errors: [{ Message: 'Not emulated' }] });
    }

    if (realFetch) {
      global.fetch = function (input, init) {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        if (/^\/d2l\/api\//.test(url) || /\/d2l\/api\//.test(url)) return handleD2lApi(url);
        if (/^https?:\/\//.test(url) && !unwrap(fl.externalCdn, false).value) {
          noteUnverified('fileLoading.externalCdn', fl.externalCdn);
          violate('external-request',
            'Package requested ' + url + '. Campus policy may block external hosts. ' +
            'Vendor the dependency locally and degrade gracefully.');
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return realFetch(input, init);
      };
    }

    /* ------------------------------------------------------- report -- */

    function computeGrade(scores) {
      if (!scores.length) return null;
      switch (gradeCalc) {
        case 'lowest':  return Math.min.apply(null, scores);
        case 'first':   return scores[0];
        case 'last':    return scores[scores.length - 1];
        case 'average': return scores.reduce(function (a, b) { return a + b; }, 0) / scores.length;
        default:        return Math.max.apply(null, scores);
      }
    }

    return {
      violations: violations,
      calls: calls,

      scoreKey: is2004 ? 'cmi.score.raw' : 'cmi.core.score.raw',

      currentScore: function () {
        var v = model[this.scoreKey].value;
        return v === '' ? null : Number(v);
      },

      persistedState: function () {
        return committedSnapshots.length
          ? committedSnapshots[committedSnapshots.length - 1]
          : null;
      },

      report: function () {
        var errors = violations.filter(function (v) { return v.severity === 'error'; });
        var warnings = violations.filter(function (v) { return v.severity === 'warning'; });
        return {
          learner: learner,
          attempt: attemptNo,
          version: version,
          initialized: initialized,
          terminated: terminated,
          committed: committedSnapshots.length,
          score: this.currentScore(),
          status: model[is2004 ? 'cmi.completion_status' : 'cmi.core.lesson_status'].value,
          suspendDataUsed: String(model['cmi.suspend_data'].value).length,
          suspendDataLimit: suspendMax,
          callCount: calls.length,
          errorCount: errors.length,
          warningCount: warnings.length,
          passed: errors.length === 0,
          violations: violations
        };
      },

      computeGrade: computeGrade,
      maxAttempts: maxAttempts,
      gradeCalculation: gradeCalc,

      uninstall: function () {
        try { delete global.API; delete global.API_1484_11; } catch (e) {}
        if (realFetch) global.fetch = realFetch;
      }
    };
  }

  global.D2LEmulator = { install: install, MODEL_12: MODEL_12, MODEL_2004: MODEL_2004 };

})(typeof window !== 'undefined' ? window : this);
