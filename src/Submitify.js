/*
 * Submitify+: paste-and-submit editor and live verdict tracker
 * for the "Submit?" box in the Codeforces problem sidebar.
 */
(() => {
  'use strict';
  if (window.__submitifyLoaded) return;
  window.__submitifyLoaded = true;

  const ext = globalThis.browser || globalThis.chrome || null;
  const IS_MAC = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
  const INDENT = '    ';
  const POLL_MS = 2000;          // Codeforces API allows ~1 call / 2 s
  const BACKOFF_MS = 5000;
  const MAX_TRACK_MS = 10 * 60 * 1000;
  const NOT_FOUND_MS = 30000;      // give up matching a new submission after this
  const RESUBMIT_LOCK_MS = 3000;   // blocks accidental double-submits
  const MAX_SOURCE_BYTES = 65535;
  const DRAFT_LIMIT = 100;

  const VERDICTS = {
    OK: 'Accepted',
    WRONG_ANSWER: 'Wrong answer',
    TIME_LIMIT_EXCEEDED: 'Time limit exceeded',
    MEMORY_LIMIT_EXCEEDED: 'Memory limit exceeded',
    RUNTIME_ERROR: 'Runtime error',
    IDLENESS_LIMIT_EXCEEDED: 'Idleness limit exceeded',
    PRESENTATION_ERROR: 'Presentation error',
    SECURITY_VIOLATED: 'Security violated',
    COMPILATION_ERROR: 'Compilation error',
    CHALLENGED: 'Hacked',
    SKIPPED: 'Skipped',
    PARTIAL: 'Partial result',
    FAILED: 'Denial of judgement',
    CRASHED: 'Judgement crashed',
    INPUT_PREPARATION_CRASHED: 'Input preparation crashed',
    REJECTED: 'Rejected',
  };
  const SHORT = {
    WRONG_ANSWER: 'WA', TIME_LIMIT_EXCEEDED: 'TLE', MEMORY_LIMIT_EXCEEDED: 'MLE',
    RUNTIME_ERROR: 'RE', IDLENESS_LIMIT_EXCEEDED: 'ILE', COMPILATION_ERROR: 'CE',
  };
  const WITH_TEST = new Set([
    'WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED', 'RUNTIME_ERROR',
    'IDLENESS_LIMIT_EXCEEDED', 'PRESENTATION_ERROR', 'SECURITY_VIOLATED',
  ]);

  /* ---------- tiny DOM helper ---------- */
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids) if (kid != null) el.append(kid);
    return el;
  }

  /* ---------- page context ---------- */
  function findFileInput() {
    const scope = document.getElementById('sidebar') || document;
    for (const inp of scope.querySelectorAll('input[type="file"][name="sourceFile"]')) {
      // Skip the full /submit page, which already has its own textarea.
      if (inp.form && !inp.form.querySelector('textarea[name="source"]')) return inp;
    }
    return null;
  }

  function getProblem(form) {
    const p = location.pathname;
    const m = p.match(/\/(?:contest|gym)\/(\d+)\/problem\/([A-Za-z0-9]+)/) ||
              p.match(/\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/);
    if (!m) return null;
    const idx = form.querySelector('[name="submittedProblemIndex"]');
    return { contestId: Number(m[1]), index: ((idx && idx.value) || m[2]).toUpperCase() };
  }

  function getHandle() {
    const a = document.querySelector('#header .lang-chooser a[href^="/profile/"], .lang-chooser a[href^="/profile/"]');
    return a ? a.textContent.trim() : null;
  }

  async function fetchStatus(handle, count) {
    const url = `${location.origin}/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=${count}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'OK') throw new Error(data.comment || 'API error');
    return data.result;
  }

  function submissionUrl(sub) {
    const kind = sub.problem && sub.problem.contestId >= 100000 ? 'gym' : 'contest';
    const cid = sub.contestId || (sub.problem && sub.problem.contestId);
    return `${location.origin}/${kind}/${cid}/submission/${sub.id}`;
  }

  /* ---------- drafts (browser.storage.local) ---------- */
  const store = ext && ext.storage && ext.storage.local;
  async function loadDrafts() {
    if (!store) return {};
    try { return (await store.get('drafts')).drafts || {}; } catch { return {}; }
  }
  async function loadDraft(key) {
    const d = await loadDrafts();
    return d[key] ? d[key].code : null;
  }
  async function saveDraft(key, code) {
    if (!store || !key) return;
    try {
      const d = await loadDrafts();
      if (code.trim()) d[key] = { code, t: Date.now() };
      else delete d[key];
      const keys = Object.keys(d).sort((a, b) => d[b].t - d[a].t);
      for (const k of keys.slice(DRAFT_LIMIT)) delete d[k];
      await store.set({ drafts: d });
    } catch { /* storage unavailable — ignore */ }
  }

  /* ---------- main ---------- */
  function init() {
    if (document.getElementById('submitify-root')) return true;
    const fileInput = findFileInput();
    if (!fileInput) return false;

    const form = fileInput.form;
    const btn = form.querySelector('input[type="submit"], button[type="submit"]');
    const langSelect = form.querySelector('select[name="programTypeId"]');
    const problem = getProblem(form);
    const draftKey = problem ? `${problem.contestId}/${problem.index}` : location.pathname;
    const origTitle = document.title;
    const S = { handle: getHandle(), baselineId: null, pending: null, pendingTimer: null, tracker: null, titleTimer: null };

    /* ----- build editor ----- */
    const ta = h('textarea', {
      name: 'sourceFile', id: 'submitify-editor', class: 'submitify-textarea',
      spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', wrap: 'off',
      placeholder: 'Paste your solution, or drop a file here',
      'aria-label': 'Source code',
    });
    const gutter = h('div', { class: 'submitify-gutter', 'aria-hidden': 'true', text: '1' });
    const body = h('div', { class: 'submitify-body' }, gutter, ta);
    const langLabel = h('span', { class: 'submitify-lang' });
    const picker = h('input', {
      type: 'file', class: 'submitify-hidden', tabindex: '-1',
      accept: '.cpp,.cc,.cxx,.c,.h,.hpp,.py,.java,.kt,.rs,.go,.js,.ts,.cs,.rb,.hs,.ml,.pas,.dpr,.d,.scala,.php,.pl,.txt',
    });
    const openBtn = h('button', { type: 'button', class: 'submitify-link', text: 'Open file' });
    const clearBtn = h('button', { type: 'button', class: 'submitify-link', text: 'Clear' });
    const counter = h('span', { class: 'submitify-count', text: 'Empty' });
    const note = h('span', { class: 'submitify-note' });
    const hint = h('span', { class: 'submitify-hint' },
      h('kbd', { text: IS_MAC ? '⌘' : 'Ctrl' }), h('kbd', { text: IS_MAC ? '↵' : 'Enter' }), ' to submit');

    const root = h('div', { id: 'submitify-root', class: 'submitify' },
      h('div', { class: 'submitify-toolbar' },
        h('span', { class: 'submitify-title' }, 'Source ', langLabel),
        h('span', { class: 'submitify-actions' }, openBtn, h('span', { class: 'submitify-sep', text: '|' }), clearBtn)),
      body,
      h('div', { class: 'submitify-footer' }, h('span', {}, counter, note), hint),
      picker);

    const row = fileInput.closest('tr');
    if (row && row.parentNode) {
      const table = row.closest('table');
      const cols = Math.max(1, ...Array.from(table.rows, r => Array.from(r.cells).reduce((n, c) => n + c.colSpan, 0)));
      row.replaceWith(h('tr', { class: 'submitify-row' }, h('td', { colspan: String(cols) }, root)));
    } else {
      fileInput.replaceWith(root);
    }

    const status = h('div', { class: 'submitify-status', role: 'status', 'aria-live': 'polite' });
    form.append(status);

    // Post into a new tab: Codeforces redirects it to the status page ("My submissions"),
    // and the problem page stays exactly as it was.
    form.setAttribute('target', '_blank');
    form.setAttribute('rel', 'noopener');

    /* ----- editor behaviour ----- */
    const langText = () => (langSelect && langSelect.selectedOptions[0] ? langSelect.selectedOptions[0].text : '');
    const isPython = () => /python|pypy/i.test(langText());
    function refreshLang() {
      const t = langText().replace(/\s+\d+(\.\d+)+.*$/, '').trim();
      langLabel.textContent = t;
      langLabel.hidden = !t;
    }
    refreshLang();
    if (langSelect) langSelect.addEventListener('change', refreshLang);

    let lineCount = 0;
    function refreshGutter() {
      const n = ta.value.split('\n').length;
      if (n !== lineCount) {
        lineCount = n;
        let s = '';
        for (let i = 1; i <= n; i++) s += i + '\n';
        gutter.textContent = s;
      }
      gutter.scrollTop = ta.scrollTop;
    }
    let countTimer = null;
    function refreshCount() {
      clearTimeout(countTimer);
      countTimer = setTimeout(() => {
        const v = ta.value;
        if (!v) { counter.textContent = 'Empty'; root.classList.remove('is-too-big'); return; }
        const bytes = new TextEncoder().encode(v).length;
        const lines = v.split('\n').length;
        counter.textContent = `${lines} line${lines === 1 ? '' : 's'}, ${bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB'}`;
        root.classList.toggle('is-too-big', bytes > MAX_SOURCE_BYTES);
        counter.title = bytes > MAX_SOURCE_BYTES ? 'Codeforces rejects sources over 64 KB' : '';
      }, 80);
    }
    let draftTimer = null;
    function onInput() {
      refreshGutter();
      refreshCount();
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => saveDraft(draftKey, ta.value), 400);
    }
    ta.addEventListener('input', onInput);
    ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });

    let noteTimer = null;
    function flashNote(text) {
      note.textContent = text;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { note.textContent = ''; }, 3000);
    }

    function insertText(text) {
      ta.focus();
      let ok = false;
      // execCommand keeps the native undo stack intact.
      try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
      if (!ok) {
        ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    function replaceRange(a, b, text) {
      ta.setSelectionRange(a, b);
      if (text === '' && a !== b) {
        ta.focus();
        let ok = false;
        try { ok = document.execCommand('delete'); } catch { ok = false; }
        if (!ok) insertText('');
      } else if (a !== b || text) {
        insertText(text);
      }
    }
    function selectedLines() {
      const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
      const start = v.lastIndexOf('\n', s - 1) + 1;
      const endProbe = e > s && v[e - 1] === '\n' ? e - 1 : e;
      let end = v.indexOf('\n', endProbe);
      if (end === -1) end = v.length;
      return { v, s, e, start, end };
    }
    function indent() {
      const { v, s, e, start, end } = selectedLines();
      if (s === e || !v.slice(s, e).includes('\n')) { insertText(INDENT); return; }
      const out = v.slice(start, end).split('\n').map(l => (l ? INDENT + l : l)).join('\n');
      replaceRange(start, end, out);
      ta.setSelectionRange(start, start + out.length);
    }
    function outdent() {
      const { v, s, e, start, end } = selectedLines();
      const lines = v.slice(start, end).split('\n');
      const outLines = lines.map(l => l.replace(/^( {1,4}|\t)/, ''));
      const out = outLines.join('\n');
      if (out === lines.join('\n')) return;
      replaceRange(start, end, out);
      if (s === e) {
        const pos = Math.max(start, s - (lines[0].length - outLines[0].length));
        ta.setSelectionRange(pos, pos);
      } else {
        ta.setSelectionRange(start, start + out.length);
      }
    }
    function newline() {
      const v = ta.value, s = ta.selectionStart;
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const before = v.slice(lineStart, s);
      const ind = before.match(/^[ \t]*/)[0];
      const last = before.trimEnd().slice(-1);
      if (last === '{' && v[ta.selectionEnd] === '}') {
        insertText('\n' + ind + INDENT + '\n' + ind);
        const pos = s + 1 + ind.length + INDENT.length;
        ta.setSelectionRange(pos, pos);
        return;
      }
      const extra = last === '{' || (last === ':' && isPython()) ? INDENT : '';
      insertText('\n' + ind + extra);
    }

    ta.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); return; }
      if (e.key === 'Escape') { ta.blur(); return; }
      if (e.key === 'Tab' && !e.altKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (e.shiftKey) outdent(); else indent();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); newline(); }
    });

    function loadFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        ta.focus();
        ta.select();
        insertText(String(reader.result).replace(/\r\n?/g, '\n'));
        ta.setSelectionRange(0, 0);
        ta.scrollTop = 0;
        flashNote(`Loaded ${file.name}`);
      };
      reader.readAsText(file);
    }
    openBtn.addEventListener('click', () => picker.click());
    picker.addEventListener('change', () => { loadFile(picker.files[0]); picker.value = ''; });
    clearBtn.addEventListener('click', () => {
      if (!ta.value) return;
      ta.focus(); ta.select();
      replaceRange(0, ta.value.length, '');
      flashNote(`Cleared, ${IS_MAC ? '⌘Z' : 'Ctrl+Z'} to undo`);
    });
    body.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        e.preventDefault();
        root.classList.add('is-dragging');
      }
    });
    body.addEventListener('dragleave', () => root.classList.remove('is-dragging'));
    body.addEventListener('drop', (e) => {
      root.classList.remove('is-dragging');
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) { e.preventDefault(); loadFile(f); }
    });

    loadDraft(draftKey).then((code) => {
      if (code && !ta.value) {
        ta.value = code;
        onInput();
        flashNote('Draft restored');
      }
    });

    /* ----- status panel ----- */
    function setStatus({ kind, text, spinner = false, meta = null, actions = [] }) {
      status.className = `submitify-status is-visible is-${kind}`;
      status.replaceChildren(...[
        h('div', { class: 'submitify-verdict' },
          spinner ? h('span', { class: 'submitify-spinner', 'aria-hidden': 'true' }) : null,
          h('span', { text })),
        meta ? h('div', { class: 'submitify-meta' }, ...[].concat(meta)) : null,
        actions.length ? h('div', { class: 'submitify-status-actions' }, ...actions) : null,
      ].filter(Boolean));
    }
    function clearStatus() { status.className = 'submitify-status'; status.replaceChildren(); }

    function setTitle(prefix) {
      clearTimeout(S.titleTimer);
      document.title = prefix ? `${prefix} · ${origTitle}` : origTitle;
    }
    function restoreTitleSoon() {
      const restore = () => { S.titleTimer = setTimeout(() => setTitle(null), 6000); };
      if (document.hidden) {
        document.addEventListener('visibilitychange', function once() {
          if (!document.hidden) { document.removeEventListener('visibilitychange', once); restore(); }
        });
      } else restore();
    }

    function describe(sub) {
      const v = sub.verdict;
      const word = sub.testset === 'PRETESTS' ? 'pretest' : 'test';
      const n = (sub.passedTestCount || 0) + 1;
      if (!v) return { done: false, kind: 'waiting', text: 'In queue', short: 'In queue' };
      if (v === 'TESTING') return { done: false, kind: 'waiting', text: `Running on ${word} ${n}`, short: `Running ${n}` };
      if (v === 'OK') {
        const pre = sub.testset === 'PRETESTS';
        return { done: true, kind: 'accepted', text: pre ? 'Pretests passed' : 'Accepted', short: pre ? '✓ Pretests passed' : '✓ Accepted' };
      }
      let text = VERDICTS[v] || v.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
      let short = SHORT[v] || text;
      if (WITH_TEST.has(v)) { text += ` on ${word} ${n}`; short += ` ${n}`; }
      return { done: true, kind: v === 'PARTIAL' ? 'info' : 'rejected', text, short: `✗ ${short}` };
    }
    function metaFor(sub, done) {
      const link = h('a', { href: submissionUrl(sub), target: '_blank', rel: 'noopener', text: `#${sub.id}` });
      const parts = [link];
      if (done && sub.verdict !== 'COMPILATION_ERROR') {
        parts.push(h('span', { text: `${sub.timeConsumedMillis} ms` }), h('span', { text: `${Math.round(sub.memoryConsumedBytes / 1024)} KB` }));
      }
      if (sub.verdict === 'COMPILATION_ERROR') parts.push(h('span', { text: 'open it to see the compiler log' }));
      return parts;
    }

    function stopTracking() { if (S.tracker) { S.tracker.stop(); S.tracker = null; } }

    // target: a submission id, or a predicate over API submissions.
    function track(target) {
      stopTracking();
      if (!S.handle) {
        setStatus({ kind: 'info', text: 'Submitted', meta: typeof target === 'number' ? `#${target}` : null });
        setTitle(null);
        return;
      }
      let id = typeof target === 'number' ? target : null;
      const started = Date.now();
      let stopped = false, timer = null;
      S.tracker = { stop() { stopped = true; clearTimeout(timer); } };

      const tick = async () => {
        if (stopped) return;
        if (id == null && Date.now() - started > NOT_FOUND_MS) {
          setStatus({
            kind: 'error', text: 'No new submission showed up.',
            meta: 'Check the status tab: Codeforces shows the reason there (identical code, logged out, contest over).',
            actions: commentTag() ? [h('button', {
              type: 'button', class: 'submitify-btn', text: 'Submit again anyway',
              title: 'Adds a one-line comment so Codeforces accepts identical code',
              onclick: () => submit(true),
            })] : [],
          });
          setTitle(null);
          S.tracker = null;
          return;
        }
        if (Date.now() - started > MAX_TRACK_MS) {
          setStatus({
            kind: 'info', text: 'Still waiting for a verdict',
            meta: h('a', { href: `${location.origin}/submissions/${encodeURIComponent(S.handle)}`, target: '_blank', rel: 'noopener', text: 'Open my submissions' }),
          });
          setTitle(null);
          S.tracker = null;
          return;
        }
        let delay = POLL_MS;
        try {
          const subs = await fetchStatus(S.handle, 10);
          if (stopped) return;
          const sub = id != null ? subs.find(s => s.id === id) : subs.find(target);
          if (sub) {
            id = sub.id;
            const d = describe(sub);
            setStatus({ kind: d.kind, text: d.text, spinner: !d.done, meta: metaFor(sub, d.done) });
            setTitle(d.short);
            if (d.done) {
              S.tracker = null;
              S.baselineId = Math.max(S.baselineId || 0, sub.id);
              restoreTitleSoon();
              return;
            }
          } else {
            setStatus({ kind: 'waiting', text: 'In queue', spinner: true, meta: id != null ? `#${id}` : null });
          }
        } catch {
          delay = BACKOFF_MS; // rate limit or network hiccup — slow down and retry
        }
        if (!stopped) timer = setTimeout(tick, delay);
      };
      tick();
    }

    function trackByProblem(pending) {
      const since = pending.at / 1000 - 120;
      track((s) => {
        if (problem && (s.problem.contestId !== problem.contestId || String(s.problem.index).toUpperCase() !== problem.index)) return false;
        return S.baselineId != null ? s.id > S.baselineId : s.creationTimeSeconds >= since;
      });
    }

    function commentTag() {
      const lang = langText().toLowerCase();
      const id = `submitify ${Date.now().toString(36)}`;
      if (/php/.test(lang)) return null;
      if (/python|pypy|ruby|perl/.test(lang)) return `# ${id}`;
      if (/haskell/.test(lang)) return `-- ${id}`;
      if (/ocaml|pascal|delphi/.test(lang)) return `(* ${id} *)`;
      return `// ${id}`;
    }

    function submit(tagged = false) {
      const submitter = btn && btn.type === 'submit' ? btn : undefined;
      const original = ta.value;
      if (tagged) {
        const tag = commentTag();
        if (!tag) return;
        ta.value = original.replace(/\s*$/, '') + '\n' + tag + '\n';
      }
      try {
        // Form data is captured synchronously, so the original text can be restored right after.
        if (typeof form.requestSubmit === 'function') form.requestSubmit(submitter);
        else if (submitter) submitter.click();
        else form.submit();
      } finally {
        if (tagged) ta.value = original;
      }
    }

    function setBusy(busy) {
      root.classList.toggle('is-busy', busy);
      if (btn) btn.disabled = busy;
    }

    function finishPending() {
      clearTimeout(S.pendingTimer);
      const p = S.pending;
      S.pending = null;
      setBusy(false);
      return p;
    }

    /* ----- submit flow ----- */
    form.addEventListener('submit', (e) => {
      if (S.pending) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (!ta.value.trim()) {
        e.preventDefault(); e.stopImmediatePropagation();
        setStatus({ kind: 'error', text: 'Paste your solution first.' });
        ta.focus();
        return;
      }
      stopTracking();
      form.setAttribute('target', '_blank');
      const pending = { at: Date.now() };
      S.pending = pending;
      setStatus({ kind: 'waiting', text: 'Submitted, status page opened in a new tab', spinner: true });
      setTitle('Submitting');
      setTimeout(() => { if (S.pending) setBusy(true); }, 0);
      S.pendingTimer = setTimeout(finishPending, RESUBMIT_LOCK_MS);
      // The new tab can't be read from here, so follow the verdict through the API.
      setTimeout(() => { if (!pending.cancelled) trackByProblem(pending); }, 1500);
    }, true);

    // If some other handler cancelled the submission, don't stay stuck in "Submitting…".
    window.addEventListener('submit', (e) => {
      if (e.target === form && e.defaultPrevented && S.pending) {
        S.pending.cancelled = true;
        finishPending();
        clearStatus();
        setTitle(null);
      }
    });

    // Remember the latest submission id so the fallback matcher never picks an old one.
    if (S.handle) {
      fetchStatus(S.handle, 1)
        .then((r) => { if (S.baselineId == null) S.baselineId = r[0] ? r[0].id : 0; })
        .catch(() => {});
    }

    return true;
  }

  if (!init()) {
    const obs = new MutationObserver(() => { if (init()) obs.disconnect(); });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 15000);
  }
})();
