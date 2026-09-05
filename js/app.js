/* app.js — builder controller. Wires the DOM shell to the model, annotator,
 * storage, exporter, autosave (Draft) and the removal undo stack (Undo).
 * Classic script -> runs on load.
 *
 * Layout: left = step lists (workflow + overview), center = annotation stage,
 * right = collapsible build panel (step details / annotations / tip / key / refs).
 * Every track holds BOTH a workflow and an overview part (no type toggle).
 *
 * Data-loss protection: every mutation funnels through commit(), which marks the
 * project dirty and schedules an autosave draft. Explicit Save/Load/New call
 * markClean(). Removals push an Undo entry and show an "Undo" toast. */
(function () {
  'use strict';
  var M = window.Model, S = window.Storage, V = window.Viewer, X = window.Exporter;
  var Draft = window.Draft, Undo = window.Undo;

  // ---- state ------------------------------------------------------------
  var project = M.newProject();
  var activeTrack = 'android';
  var activePart = 'workflow';
  var activeStepId = null;
  var tool = 'select';
  var color = M.PALETTE[0].value;
  var annotator = null;
  var dragStep = null;              // { part, id } during a reorder drag
  var pendingShotPart = 'workflow'; // which part a screenshot pick targets
  var pendingInsertAt = null;       // index to insert picked screenshots at (insert-here)
  var pendingKey = null;            // { row, after } during a key-image upload
  var dirty = false;                // unsaved since last explicit Save/Load/New
  var busy = false;                 // in-flight guard for export/preview/print
  var modalDismiss = null;          // how Escape/backdrop closes the open modal (null = not dismissible)
  var zoomPct = 100;                // stage zoom; 100 = fit the image to the column

  var $ = function (id) { return document.getElementById(id); };
  var track = function () { return project.tracks[activeTrack]; };
  var partSteps = function (part) { return track()[part]; };
  var steps = function () { return partSteps(activePart); };
  var currentStep = function () { return steps().filter(function (s) { return s.id === activeStepId; })[0] || null; };
  var isImageFile = function (f) { return /^image\//.test(f.type); };
  var partLabel = function (part) { return part === 'overview' ? 'Overview' : 'Workflow'; };

  // ---- dirty / autosave choke points -----------------------------------
  function commit() { dirty = true; Draft.markChanged(); renderSaveState(); }
  function markClean() { dirty = false; Draft.clear(); renderSaveState(); }

  // The ONE place the project object is swapped (New / Load / Restore).
  function setProject(p) {
    project = p;
    activeTrack = 'android'; activePart = 'workflow'; activeStepId = null;
    if (annotator) annotator.selectedId = null;
    Undo.clear();
  }

  // ---- boot -------------------------------------------------------------
  function init() {
    buildColorDots();
    bindTopbar();
    bindPartActions();
    bindFileInputs();
    bindStepDetails();
    bindStageTools();
    bindDropzone();
    bindPaste();
    bindZoom();
    bindSections();
    bindKeyboard();

    annotator = new window.Annotator($('stage'), {
      getStep: currentStep,
      getTool: function () { return tool; },
      getColor: function () { return color; },
      getScale: function () { return project.annScale || 1; },
      onChange: function () { renderAnnList(); refreshSections(); updateStepCard(activePart, activeStepId); updateFooter(); commit(); },
      onSelect: function (id) { renderAnnList(); renderAnnEdit(id); }
    });

    // Any edit inside the build panel (text, selects, checkboxes, colors) is a change.
    $('buildPanel').addEventListener('input', commit);
    $('buildPanel').addEventListener('change', commit);
    $('saveState').onclick = function () { if (!$('modalBack').classList.contains('open')) openSaveModal(); };
    setInterval(renderSaveState, 30000);   // keep "2 min ago" fresh

    window.addEventListener('beforeunload', function (e) {
      Draft.flush();
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    renderAll();
    renderSaveState();

    // Autosave: offer to restore an unsaved draft before anything else.
    Draft.init({ getProject: function () { return project; }, onStatus: renderSaveState });
    Draft.load().then(function (d) {
      if (d && (d.project || d.json)) openRestoreModal(d);
      else normalLaunch();
    }, normalLaunch);
  }

  function normalLaunch() {
    Draft.setOwned();
    toast('New guide — add screenshots to begin.');
    // Nudge: open Guide details on launch so the title/contact/devices get set
    // (unless the user opted out — preference stored per browser).
    if (getAutoOpen()) openSettingsModal();
  }

  // ---- top bar ----------------------------------------------------------
  function bindTopbar() {
    $('btnNew').onclick = function () {
      if (dirty && !confirm('Start a new guide? Unsaved changes to the current guide will be lost.')) return;
      setProject(M.newProject()); markClean(); renderAll();
      toast('New guide — add screenshots to begin.');
    };
    $('btnOpen').onclick = function () {
      if (dirty && !confirm('Load a different guide? Unsaved changes to the current guide will be lost.')) return;
      $('fileOpen').click();
    };
    $('btnSave').onclick = openSaveModal;
    $('btnSettings').onclick = openSettingsModal;
    $('btnPreview').onclick = guard(function () { X.preview(project); });
    $('btnExport').onclick = guard(function () {
      var b = X.exportHTML(project);
      toast('Web guide exported (' + S.fmtBytes(b) + '). Open it in any browser or put it on a web host.');
    });
    $('btnPdf').onclick = guard(function () {
      var t = track();
      if (!t.workflow.length && !t.overview.length) { toast('Add at least one step to ' + M.DEVICE_META[activeTrack].label + ' first.'); return; }
      X.exportPDF(project, activeTrack);
      toast('Choose “Save as PDF” in the print dialog. Prints the ' + M.DEVICE_META[activeTrack].label + ' guide.');
    });
  }

  // Ignore rapid double-clicks on actions that open windows / download files.
  function guard(fn) {
    return function () {
      if (busy) return;
      busy = true;
      try { fn(); } finally { setTimeout(function () { busy = false; }, 800); }
    };
  }

  // Build the device toggle from the project's enabled device set.
  function renderTrackToggle() {
    var tog = $('trackToggle');
    var html = '<span class="device-switch-label">DEVICE</span>';
    project.devices.forEach(function (plat) {
      var m = M.DEVICE_META[plat];
      html += '<button data-track="' + plat + '"' + (plat === activeTrack ? ' class="active"' : '') + '>' + m.icon + ' ' + m.label + '</button>';
    });
    tog.innerHTML = html;
    Array.prototype.forEach.call(tog.querySelectorAll('button'), function (b) {
      b.onclick = function () {
        activeTrack = b.getAttribute('data-track');
        activeStepId = null;
        renderAll();
      };
    });
  }

  function bindPartActions() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-add-shots]'), function (b) {
      b.onclick = function () { pendingShotPart = b.getAttribute('data-add-shots'); pendingInsertAt = null; $('fileShots').click(); };
    });
  }

  // ---- colors / tools ---------------------------------------------------
  function buildColorDots() {
    var wrap = $('colorDots');
    wrap.innerHTML = '';
    wrap.setAttribute('role', 'radiogroup'); wrap.setAttribute('aria-label', 'Annotation color');
    M.PALETTE.forEach(function (p, i) {
      var d = document.createElement('button');
      d.type = 'button';
      d.className = 'color-dot' + (i === 0 ? ' active' : '');
      d.style.background = p.value; d.title = p.name;
      d.setAttribute('role', 'radio'); d.setAttribute('aria-label', p.name);
      d.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
      d.onclick = function () {
        color = p.value;
        Array.prototype.forEach.call(wrap.children, function (c) { c.classList.remove('active'); c.setAttribute('aria-checked', 'false'); });
        d.classList.add('active'); d.setAttribute('aria-checked', 'true');
        var sel = annotator && annotator.selectedId && findAnn(annotator.selectedId);
        if (sel) { sel.color = color; annotator.render(); renderAnnList(); commit(); }
      };
      wrap.appendChild(d);
    });
  }

  // Enter/Space activate non-native clickable elements.
  function keyActivate(elm) {
    elm.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elm.click(); }
    });
  }

  function bindStageTools() {
    Array.prototype.forEach.call(document.querySelectorAll('#stageTools .tool-btn'), function (b) {
      b.onclick = function () {
        tool = b.getAttribute('data-tool');
        Array.prototype.forEach.call(document.querySelectorAll('#stageTools .tool-btn'), function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      };
    });
  }

  // ---- step details actions --------------------------------------------
  function bindStepDetails() {
    bindText('fTitle', 'title', function () { updateStepCard(activePart, activeStepId); });
    bindText('fBody', 'body');
    bindText('fNote', 'note', refreshSections);
    bindText('fTip', 'tip', refreshSections);
    bindText('fTableTitle', 'tableTitle');
    bindText('fLinkLabel', 'linkLabel');
    $('btnReplaceShot').onclick = function () { if (currentStep()) $('fileReplace').click(); };
    $('btnRemoveStep').onclick = function () {
      var s = currentStep(); if (!s) return;
      var n = s.annotations.length;
      var msg = 'Remove ' + stepLabel(s) + (n ? ' (' + n + ' annotation' + (n === 1 ? '' : 's') + ')' : '') +
        '? You can undo for a few seconds afterwards.';
      if (!confirm(msg)) return;
      deleteStep(s);
    };
    $('btnAddTableRow').onclick = function () { var s = currentStep(); if (!s) return; s.table.push(M.newKeyRow()); renderStepTable(); refreshSections(); commit(); };
    $('btnAddLink').onclick = function () {
      var s = currentStep(); if (!s) return;
      s.references.push({ id: M.uid('ref'), kind: 'link', label: '', href: '', data: '', name: '' });
      renderRefs(); refreshSections(); commit();
      var last = $('refRows').lastElementChild; var inp = last && last.querySelector('input'); if (inp) inp.focus();
    };
    $('btnAddPdf').onclick = function () { if (currentStep()) $('filePdf').click(); };
  }

  function bindText(id, prop, after) {
    $(id).addEventListener('input', function () {
      var s = currentStep(); if (!s) return;
      s[prop] = $(id).value;
      if (after) after();
    });
  }

  // Keep names short in toasts/confirms.
  function short(str, n) {
    str = (str || '').trim();
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
  }
  // "step 3 “Title”" for confirms/toasts.
  function stepLabel(s) {
    var arr = steps(), i = arr.indexOf(s), t = short(s.title, 40);
    return 'step ' + (i + 1) + (t ? ' “' + t + '”' : '');
  }

  // ---- file inputs ------------------------------------------------------
  function bindFileInputs() {
    $('fileShots').onchange = function (e) {
      var at = pendingInsertAt; pendingInsertAt = null;
      handleScreenshots(pendingShotPart, e.target.files, at); e.target.value = '';
    };
    $('fileReplace').onchange = function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) replaceCurrentImage(f); };
    $('filePdf').onchange = function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) attachPdf(f); };
    $('fileOpen').onchange = function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) openProjectFile(f); };
    $('fileKeyImg').onchange = function (e) {
      var f = e.target.files[0]; e.target.value = '';
      var pk = pendingKey; pendingKey = null;
      if (!f || !pk) return;
      if (!isImageFile(f)) { toast('Only image files can be used here (PNG, JPG…).'); return; }
      S.readAsDataURL(f).then(function (d) { pk.row.image = d; pk.row.kind = 'image'; if (pk.after) pk.after(); updateFooter(); commit(); });
    };
  }

  // Add screenshots as new steps in a part (appended, or inserted at `insertAt`),
  // auto-ordered by lastModified. `source` = 'paste' tweaks the toast.
  function handleScreenshots(part, fileList, insertAt, source) {
    var all = Array.prototype.slice.call(fileList);
    var files = all.filter(isImageFile);
    if (!files.length) { if (all.length) toast('Only image files can be added (PNG, JPG, GIF…).'); return; }
    files.sort(function (a, b) { return (a.lastModified || 0) - (b.lastModified || 0); });
    Promise.all(files.map(S.readImageFile)).then(function (imgs) {
      var arr = partSteps(part);
      var at = (typeof insertAt === 'number') ? Math.min(insertAt, arr.length) : arr.length;
      var firstNew = null;
      imgs.forEach(function (im, k) {
        var st = M.newStep();
        st.image = im;        // title left blank by default
        arr.splice(at + k, 0, st);
        if (!firstNew) firstNew = st;
      });
      // jump selection to the first newly-added step so it's ready to edit
      activePart = part;
      activeStepId = firstNew.id;
      renderAll(); commit();
      var where = partLabel(part);
      if (source === 'paste') toast('Pasted screenshot added to ' + where + '.');
      else toast('Added ' + imgs.length + ' screenshot' + (imgs.length > 1 ? 's' : '') + ' to ' + where +
        (imgs.length > 1 ? ' — ordered by file date, drag to reorder.' : '.'));
    });
  }

  function replaceCurrentImage(file) {
    var s = currentStep(); if (!s) return;
    if (!isImageFile(file)) { toast('Only image files can be used as a screenshot (PNG, JPG…).'); return; }
    S.readImageFile(file).then(function (im) {
      var prev = s.image;
      s.image = im;               // annotations kept — % coords stay put
      annotator.render(); renderStepList(); updateFooter(); commit();
      Undo.push({ label: 'previous screenshot', undo: function () {
        if (!stepExists(s)) return false;
        s.image = prev;
        if (currentStep() === s) annotator.render();
        renderStepList(); updateFooter(); return true;
      } });
      toast('Screenshot replaced — annotations kept.', { action: 'Undo', onAction: undoLast });
    });
  }

  function attachPdf(file) {
    var s = currentStep(); if (!s) return;
    if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { toast('Only PDF files can be attached.'); return; }
    S.readPdfFile(file).then(function (r) {
      s.references.push({ id: M.uid('ref'), kind: 'pdf', label: file.name, href: '', data: r.data, name: file.name });
      renderRefs(); refreshSections(); updateFooter(); commit();
      toast('Attached “' + file.name + '”.');
    });
  }

  // ---- drag & drop / paste screenshots ---------------------------------
  function bindDropzone() {
    var dz = $('stageCol'), overlay = $('dropOverlay');
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault(); dz.classList.add('dragover');
        // Say what the drop will do: one file onto a selected step = replace; otherwise add.
        var n = e.dataTransfer && e.dataTransfer.items ? e.dataTransfer.items.length : 0;
        overlay.textContent = (n === 1 && currentStep())
          ? 'Drop to replace this step’s screenshot'
          : 'Drop to add ' + (n > 1 ? n + ' screenshots' : 'a screenshot') + ' as new step' + (n > 1 ? 's' : '');
      });
    });
    dz.addEventListener('dragleave', function (e) { e.preventDefault(); dz.classList.remove('dragover'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault(); dz.classList.remove('dragover');
      var all = Array.prototype.slice.call(e.dataTransfer.files), files = all.filter(isImageFile);
      if (!files.length) { if (all.length) toast('Only image files can be added (PNG, JPG, GIF…).'); return; }
      if (files.length === 1 && currentStep()) replaceCurrentImage(files[0]);
      else handleScreenshots(currentStep() ? activePart : 'workflow', files);
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      if (e.target.closest && e.target.closest('#stageCol')) return;
      e.preventDefault();
      handleScreenshots(activePart, e.dataTransfer.files);
    });
  }

  // Ctrl/Cmd+V with a screenshot on the clipboard adds it as a new step.
  function bindPaste() {
    document.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items; if (!items) return;
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && /^image\//.test(items[i].type)) { var f = items[i].getAsFile(); if (f) files.push(f); }
      }
      if (!files.length) return;       // plain text paste: leave it to the field
      e.preventDefault();
      handleScreenshots(activePart, files, null, 'paste');
    });
  }

  // ---- sections collapse ------------------------------------------------
  function bindSections() {
    Array.prototype.forEach.call(document.querySelectorAll('#buildPanel .sec-head'), function (h) {
      h.tabIndex = 0; h.setAttribute('role', 'button');
      var sync = function () { h.setAttribute('aria-expanded', h.parentNode.classList.contains('open') ? 'true' : 'false'); };
      sync();
      h.onclick = function (e) {
        if (e.target.closest('input,textarea,button,select')) return;
        h.parentNode.classList.toggle('open'); sync();
      };
      keyActivate(h);
    });
  }
  function refreshSections() {
    var s = currentStep(); if (!s) return;
    setFilled('annotations', s.annotations.length > 0);
    setFilled('tip', !!s.tip);
    setFilled('table', s.table.length > 0);
    setFilled('refs', s.references.length > 0);
  }
  function setFilled(sec, on) {
    var node = document.querySelector('.section[data-sec="' + sec + '"]');
    if (!node) return;
    var f = node.querySelector('[data-filled]');
    if (f) { f.textContent = on ? '●' : ''; f.title = on ? 'Has content' : ''; }
  }

  // ---- keyboard ---------------------------------------------------------
  function isTypingTarget(el) {
    if (!el) return false;
    var t = el.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || !!el.isContentEditable;
  }
  function modalOpen() { return $('modalBack').classList.contains('open'); }

  function bindKeyboard() {
    document.addEventListener('keydown', function (e) {
      var mod = e.metaKey || e.ctrlKey;
      var ae = document.activeElement;
      // Escape closes a dismissible modal
      if (e.key === 'Escape' && modalOpen()) { if (modalDismiss) { e.preventDefault(); modalDismiss(); } return; }
      // Ctrl/Cmd+S -> Save (also while typing; never the browser's "save page")
      if (mod && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault(); if (!modalOpen()) openSaveModal(); return;
      }
      if (modalOpen()) { if (e.key === 'Tab') trapTab(e); return; }
      if (isTypingTarget(ae)) return;
      // Ctrl/Cmd+Z -> undo last removal (text fields keep their native undo)
      if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undoLast(); return; }
      // Ctrl/Cmd + / - / 0 zoom the stage while a step is open
      if (mod && !e.altKey && currentStep() && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault(); if (e.key === '0') zoomFit(); else zoomBy(e.key === '-' ? -1 : 1); return;
      }
      if (mod || e.altKey) return;
      var onCard = ae && ae.closest && ae.closest('.step-card');
      if ((e.key === 'Delete' || e.key === 'Backspace') && annotator && annotator.selectedId) {
        if (onCard) return;
        var st = currentStep(), a = st && findAnn(annotator.selectedId);
        if (!a) { annotator.selectedId = null; return; }
        e.preventDefault(); deleteAnnotation(st, a);
        return;
      }
      // Arrow keys nudge the selected annotation (1%, Shift = 5%) when focus is
      // on the page body, the stage, or the annotation list.
      if (/^Arrow(Up|Down|Left|Right)$/.test(e.key) && annotator && annotator.selectedId && currentStep()) {
        var ctx = ae === document.body || (ae && ae.closest && (ae.closest('#stage') || ae.closest('#annList')));
        if (!ctx) return;
        var d = e.shiftKey ? 5 : 1, dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -d; else if (e.key === 'ArrowRight') dx = d;
        else if (e.key === 'ArrowUp') dy = -d; else dy = d;
        e.preventDefault(); annotator.nudgeSelected(dx, dy);
      }
    });
  }

  // Keep Tab inside the open modal.
  function trapTab(e) {
    var list = focusables($('modal')); if (!list.length) return;
    var first = list[0], last = list[list.length - 1], ae = document.activeElement;
    if (!$('modal').contains(ae)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && ae === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && ae === last) { e.preventDefault(); first.focus(); }
  }
  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll('input,select,textarea,button,a[href],[tabindex="0"]'),
      function (n) { return !n.disabled && n.offsetParent !== null; });
  }

  // ===== RENDER ==========================================================
  function renderAll() {
    if (project.devices.indexOf(activeTrack) < 0) activeTrack = project.devices[0];
    renderTrackToggle();
    $('trackLabel').textContent = M.DEVICE_META[activeTrack].label;
    if (!currentStep()) {
      var first = firstStep();
      if (first) { activePart = first.part; activeStepId = first.id; }
      else activeStepId = null;
    }
    renderStepList();
    renderStage();
    renderBuildPanel();
    updateFooter();
  }

  function firstStep() {
    var parts = M.PARTS;
    for (var i = 0; i < parts.length; i++) {
      if (partSteps(parts[i]).length) return { part: parts[i], id: partSteps(parts[i])[0].id };
    }
    return null;
  }

  function renderStepList() {
    renderListInto('workflow', $('wfList'));
    renderListInto('overview', $('ovList'));
    setCount($('wfCount'), partSteps('workflow').length);
    setCount($('ovCount'), partSteps('overview').length);
  }

  function setCount(el, n) { el.textContent = n || ''; el.style.display = n ? '' : 'none'; }

  // ---- cheap per-card updates (avoid rebuilding data-URL thumbnails) ----
  function listFor(part) { return part === 'workflow' ? $('wfList') : $('ovList'); }
  function findCard(part, id) {
    var ul = listFor(part);
    for (var i = 0; i < ul.children.length; i++) if (ul.children[i].dataset && ul.children[i].dataset.id === id) return ul.children[i];
    return null;
  }
  function metaText(part, s) {
    var annCount = (s.annotations || []).length;
    return (s.image ? '🖼' : '—') + (annCount ? ' · ' + annCount + ' annotation' + (annCount === 1 ? '' : 's') : '') + linkMeta(part, s);
  }
  function updateStepCard(part, id) {
    var li = id && findCard(part, id);
    var s = li && partSteps(part).filter(function (x) { return x.id === id; })[0];
    if (!li || !s) { renderStepList(); return; }
    li.querySelector('.sc-title').textContent = s.title || 'Untitled step';
    li.querySelector('.sc-meta').textContent = metaText(part, s);
  }
  function setActiveCard(part, id) {
    Array.prototype.forEach.call(document.querySelectorAll('.step-card.active'), function (n) { n.classList.remove('active'); n.setAttribute('aria-selected', 'false'); });
    var li = findCard(part, id);
    if (li) { li.classList.add('active'); li.setAttribute('aria-selected', 'true'); }
  }
  function focusCard(part, id) {
    var li = findCard(part, id);
    if (li) { try { li.focus({ preventScroll: true }); } catch (e) { li.focus(); } }
  }
  // Keyboard/button reorder: move a step up or down one slot.
  function moveStep(part, id, delta) {
    var arr = partSteps(part);
    var from = arr.map(function (s) { return s.id; }).indexOf(id);
    var to = from + delta;
    if (from < 0 || to < 0 || to >= arr.length) return;
    var item = arr.splice(from, 1)[0];
    arr.splice(to, 0, item);
    renderStepList(); commit(); focusCard(part, id);
  }

  // Step-card meta describing overview↔workflow links.
  function linkMeta(part, s) {
    if (part === 'overview') {
      var wf = partSteps('workflow');
      var nums = (s.linkedStepIds || []).map(function (id) {
        var ix = wf.map(function (w) { return w.id; }).indexOf(id);
        return ix >= 0 ? ix + 1 : null;
      }).filter(function (n) { return n != null; }).sort(function (a, b) { return a - b; });
      if (nums.length) return ' · → Step ' + nums.join(', ');
      if (wf.length) return ' · ⚠ not linked';
      return '';
    }
    var cnt = partSteps('overview').filter(function (o) {
      return (o.linkedStepIds || []).indexOf(s.id) >= 0;
    }).length;
    return cnt ? ' · ⓘ ' + cnt + ' overview' + (cnt === 1 ? '' : 's') : '';
  }

  function renderListInto(part, ul) {
    ul.setAttribute('role', 'listbox');
    ul.setAttribute('aria-label', part === 'workflow' ? 'Workflow steps' : 'Overviews');
    var focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('.step-card');
    var refocus = (focused && focused.parentNode === ul) ? focused.dataset.id : null;
    ul.innerHTML = '';
    var arr = partSteps(part);
    if (!arr.length) {
      var empty = document.createElement('li');
      empty.className = 'step-empty'; empty.setAttribute('role', 'presentation');
      empty.textContent = part === 'workflow'
        ? 'No workflow steps yet — add screenshots to start the process.'
        : 'No overviews yet — add a screenshot to explain a screen’s options.';
      ul.appendChild(empty);
      return;
    }
    arr.forEach(function (s, i) {
      var li = document.createElement('li');
      var active = part === activePart && s.id === activeStepId;
      li.className = 'step-card' + (active ? ' active' : '');
      li.draggable = true; li.tabIndex = 0;
      li.setAttribute('role', 'option'); li.setAttribute('aria-selected', active ? 'true' : 'false');
      li.dataset.id = s.id; li.dataset.part = part;
      var thumb = s.image && s.image.src ? '<img class="sc-thumb" src="' + s.image.src + '" alt="" decoding="async">' : '';
      li.innerHTML =
        '<span class="grip-col">' +
        '<button class="mv" data-mv="-1" tabindex="-1" title="Move up (Alt+↑)" aria-label="Move step up">▲</button>' +
        '<span class="grip" title="Drag to reorder" aria-hidden="true">⋮⋮</span>' +
        '<button class="mv" data-mv="1" tabindex="-1" title="Move down (Alt+↓)" aria-label="Move step down">▼</button></span>' +
        '<span class="num">' + (i + 1) + '</span>' + thumb +
        '<span class="sc-body"><span class="sc-title">' + V.esc(s.title || 'Untitled step') + '</span>' +
        '<span class="sc-meta">' + metaText(part, s) + '</span></span>' +
        '<button class="insert-here" tabindex="-1" title="Insert a screenshot below this step" aria-label="Insert a screenshot below this step">+</button>';
      li.onclick = function (e) {
        var mv = e.target.closest('.mv');
        if (mv) { e.stopPropagation(); moveStep(part, s.id, parseInt(mv.getAttribute('data-mv'), 10)); return; }
        if (e.target.closest('.insert-here')) {
          pendingShotPart = part; pendingInsertAt = i + 1; $('fileShots').click(); return;
        }
        selectStep(part, s.id);
      };
      li.onkeydown = function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectStep(part, s.id); li.focus(); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          if (e.altKey) { moveStep(part, s.id, e.key === 'ArrowUp' ? -1 : 1); return; }
          var sib = e.key === 'ArrowUp' ? li.previousElementSibling : li.nextElementSibling;
          if (sib && sib.classList.contains('step-card')) sib.focus();
        }
      };
      bindStepDnD(li, part, i);
      ul.appendChild(li);
    });
    if (refocus) focusCard(part, refocus);
  }

  function bindStepDnD(li, part, idx) {
    li.addEventListener('dragstart', function (e) {
      dragStep = { part: part, id: li.dataset.id }; li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', li.dataset.id); } catch (_) {}
    });
    li.addEventListener('dragend', function () { li.classList.remove('dragging'); dragStep = null; clearDragOver(); });
    li.addEventListener('dragover', function (e) {
      if (!dragStep || dragStep.part !== part) return; // reorder within the same part only
      e.preventDefault(); clearDragOver(); li.classList.add('drag-over');
    });
    li.addEventListener('drop', function (e) {
      if (!dragStep || dragStep.part !== part) return;
      e.preventDefault(); e.stopPropagation();
      reorderStep(part, dragStep.id, idx);
    });
  }
  function clearDragOver() {
    Array.prototype.forEach.call(document.querySelectorAll('.step-card.drag-over'), function (n) { n.classList.remove('drag-over'); });
  }

  function reorderStep(part, id, targetIdx) {
    var arr = partSteps(part);
    var from = arr.map(function (s) { return s.id; }).indexOf(id);
    if (from < 0) return;
    var item = arr.splice(from, 1)[0];
    var to = from < targetIdx ? targetIdx - 1 : targetIdx;
    if (to === from) { arr.splice(from, 0, item); return; }
    arr.splice(to, 0, item);
    renderStepList(); commit();
  }

  // True if the step object is still somewhere in the project (for undo validity).
  function stepExists(step) {
    var found = false;
    Object.keys(project.tracks).forEach(function (p) {
      M.PARTS.forEach(function (part) { if (project.tracks[p][part].indexOf(step) >= 0) found = true; });
    });
    return found;
  }

  function deleteStep(s) {
    var plat = activeTrack, part = activePart, arr = partSteps(part);
    var i = arr.indexOf(s); if (i < 0) return;
    var label = stepLabel(s);
    arr.splice(i, 1);
    activeStepId = null;
    if (annotator) annotator.selectedId = null;
    renderAll(); commit();
    Undo.push({ label: label, undo: function () {
      var a = project.tracks[plat] && project.tracks[plat][part]; if (!a) return false;
      a.splice(Math.min(i, a.length), 0, s);
      activeTrack = plat; activePart = part; activeStepId = s.id; renderAll(); return true;
    } });
    toast('Removed ' + label + '.', { action: 'Undo', onAction: undoLast });
  }

  function selectStep(part, id) {
    activePart = part; activeStepId = id;
    if (annotator) annotator.selectedId = null;
    setActiveCard(part, id);
    renderStage();
    renderBuildPanel();
  }

  function renderStage() {
    var s = currentStep();
    if (!s) { $('stageEmpty').style.display = ''; $('stageHost').style.display = 'none'; $('stageZoom').style.display = 'none'; return; }
    $('stageEmpty').style.display = 'none';
    $('stageHost').style.display = '';
    $('stageZoom').style.display = s.image ? '' : 'none';
    annotator.render();
    applyZoom();
  }

  // ---- stage zoom ------------------------------------------------------
  // The stage is sized from the image's own aspect: landscape screenshots fill
  // the column, portrait ones stay phone-sized. Zoom scales that fit width;
  // annotations are % based so nothing else changes.
  function fitWidth(step) {
    var col = $('stageCol'), W = Math.max(200, col.clientWidth - 40);
    var im = step.image, a = (im.w && im.h) ? im.w / im.h : 0.5;
    return a >= 1 ? W : Math.min(W, 460);
  }
  function applyZoom() {
    var s = currentStep(); if (!s || !s.image) return;
    $('stage').style.width = Math.round(fitWidth(s) * zoomPct / 100) + 'px';
    $('zoomPct').textContent = zoomPct + '%';
    $('zoomOut').disabled = zoomPct <= 25; $('zoomIn').disabled = zoomPct >= 400;
  }
  function zoomBy(dir) {
    zoomPct = Math.max(25, Math.min(400, Math.round(zoomPct * (dir > 0 ? 1.25 : 0.8))));
    applyZoom();
  }
  function zoomFit() { zoomPct = 100; applyZoom(); }
  function bindZoom() {
    $('zoomIn').onclick = function () { zoomBy(1); };
    $('zoomOut').onclick = function () { zoomBy(-1); };
    $('zoomFit').onclick = zoomFit;
    // Ctrl/Cmd + mouse wheel over the stage column zooms (instead of the whole page)
    $('stageCol').addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey) || !currentStep()) return;
      e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    window.addEventListener('resize', applyZoom);
  }

  function renderBuildPanel() {
    var s = currentStep();
    if (!s) { $('buildEmpty').style.display = ''; $('buildBody').style.display = 'none'; return; }
    $('buildEmpty').style.display = 'none';
    $('buildBody').style.display = '';
    $('fTitle').value = s.title || '';
    $('fBody').value = s.body || '';
    $('fNote').value = s.note || '';
    $('fTip').value = s.tip || '';
    $('fTableTitle').value = s.tableTitle || '';
    // overview link controls only apply to overview steps
    var isOverview = activePart === 'overview';
    $('overviewLink').style.display = isOverview ? '' : 'none';
    if (isOverview) {
      $('fLinkLabel').value = s.linkLabel || '';
      $('fLinkLabel').placeholder = M.DEFAULT_LEARN_LABEL;
      renderLinkSteps();
    }
    renderStepTable();
    renderRefs();
    refreshSections();
    renderAnnList();
    renderAnnEdit(null);
  }

  // Checkbox list of this track's workflow steps; toggles membership of the
  // current overview step in their "linked" set.
  function renderLinkSteps() {
    var s = currentStep(); if (!s) return;
    var wrap = $('linkStepsList');
    var wf = partSteps('workflow');
    wrap.innerHTML = '';
    if (!wf.length) {
      wrap.innerHTML = '<div class="hint" style="padding:2px">There are no workflow steps to attach this to yet. With no workflow, the guide is an overview-only tour.</div>';
    }
    wf.forEach(function (ws, i) {
      var row = document.createElement('label');
      row.className = 'link-step';
      var checked = s.linkedStepIds.indexOf(ws.id) >= 0;
      row.innerHTML = '<input type="checkbox"' + (checked ? ' checked' : '') + '>' +
        '<span class="link-num">' + (i + 1) + '</span><span class="link-ttl">' + V.esc(ws.title || 'Untitled step') + '</span>';
      row.querySelector('input').onchange = function (e) {
        var on = e.target.checked;
        var pos = s.linkedStepIds.indexOf(ws.id);
        if (on && pos < 0) s.linkedStepIds.push(ws.id);
        else if (!on && pos >= 0) s.linkedStepIds.splice(pos, 1);
        updateLinkWarn();
        updateStepCard('overview', s.id); updateStepCard('workflow', ws.id);
      };
      wrap.appendChild(row);
    });
    updateLinkWarn();
  }

  function updateLinkWarn() {
    var s = currentStep(); if (!s) return;
    var hasWorkflow = partSteps('workflow').length > 0;
    $('linkWarn').style.display = (hasWorkflow && s.linkedStepIds.length === 0) ? '' : 'none';
  }

  // per-step color/icon key editor
  function renderStepTable() {
    var s = currentStep(); if (!s) return;
    var wrap = $('stepTableRows');
    wrap.innerHTML = '';
    if (!s.table.length) {
      wrap.innerHTML = '<div class="hint" style="margin:0 0 8px">Explain what colors or icons on this screen mean — shown as a small key under the screenshot.</div>';
    }
    s.table.forEach(function (row) {
      wrap.appendChild(tableRowEditor(row, function () {
        var idx = s.table.indexOf(row);
        s.table = s.table.filter(function (r) { return r !== row; });
        renderStepTable(); refreshSections(); updateFooter(); commit();
        var label = 'key row' + (row.text ? ' “' + short(row.text, 30) + '”' : '');
        Undo.push({ label: label, undo: function () {
          if (!stepExists(s)) return false;
          s.table.splice(Math.min(idx, s.table.length), 0, row);
          if (currentStep() === s) { renderStepTable(); refreshSections(); }
          updateFooter(); return true;
        } });
        toast('Removed ' + label + '.', { action: 'Undo', onAction: undoLast });
      }));
    });
  }

  // shared row editor for the per-step color/icon key. Supports
  // color swatch, glyph icon, or an uploaded image crop.
  function tableRowEditor(row, onDelete) {
    var div = document.createElement('div');
    div.className = 'table-row';
    var kind = document.createElement('select');
    kind.className = 'kind inp'; kind.title = 'What kind of key entry this is';
    kind.innerHTML = '<option value="color">Color</option><option value="icon">Icon</option><option value="image">Image</option>';
    kind.value = row.kind;
    var swatch = document.createElement('input');
    swatch.type = 'color'; swatch.className = 'swatch'; swatch.value = row.value || '#c0392b'; swatch.title = 'Pick the color';
    var iconIn = document.createElement('input');
    iconIn.type = 'text'; iconIn.className = 'inp icon-in'; iconIn.placeholder = '★'; iconIn.value = row.icon || '';
    iconIn.title = 'Type or paste any symbol or emoji, or use Pick…';
    var pickBtn = document.createElement('button'); pickBtn.type = 'button'; pickBtn.className = 'btn sm ghost'; pickBtn.textContent = 'Pick…';
    pickBtn.title = 'Browse common icons';
    pickBtn.onclick = function () { openIconPicker(row, function () { iconIn.value = row.icon; commit(); }); };
    var imgBtn = document.createElement('button'); imgBtn.className = 'btn sm ghost'; imgBtn.textContent = 'Choose image…';
    imgBtn.title = 'Pick a small image of the icon (e.g. cropped from a screenshot)';
    var thumb = document.createElement('img'); thumb.className = 'key-thumb'; thumb.alt = '';
    var text = document.createElement('input');
    text.type = 'text'; text.className = 'inp text'; text.placeholder = 'What it means…'; text.value = row.text || '';
    var del = document.createElement('button'); del.className = 'icon-btn'; del.textContent = '🗑';
    del.title = 'Remove this row'; del.setAttribute('aria-label', 'Remove this row');

    function syncKind() {
      swatch.style.display = row.kind === 'color' ? '' : 'none';
      iconIn.style.display = row.kind === 'icon' ? '' : 'none';
      pickBtn.style.display = row.kind === 'icon' ? '' : 'none';
      imgBtn.style.display = row.kind === 'image' ? '' : 'none';
      thumb.style.display = (row.kind === 'image' && row.image) ? '' : 'none';
      if (row.image) thumb.src = row.image;
    }
    kind.onchange = function () { row.kind = kind.value; syncKind(); };
    swatch.oninput = function () { row.value = swatch.value; };
    iconIn.oninput = function () { row.icon = iconIn.value; };
    text.oninput = function () { row.text = text.value; };
    imgBtn.onclick = function () { pendingKey = { row: row, after: function () { thumb.src = row.image; thumb.style.display = ''; } }; $('fileKeyImg').click(); };
    del.onclick = onDelete;
    syncKind();
    div.appendChild(kind); div.appendChild(swatch); div.appendChild(iconIn); div.appendChild(pickBtn);
    div.appendChild(imgBtn); div.appendChild(thumb); div.appendChild(text); div.appendChild(del);
    return div;
  }

  // Simple icon browser for key rows: a curated grid of guide-friendly symbols.
  var ICON_GROUPS = [
    { name: 'Status', icons: ['✅', '❌', '⚠️', 'ℹ️', '❗', '❓', '🚫', '🟢', '🟡', '🔴', '🔵', '⚪', '⚫', '🟩', '🟨', '🟥', '🟦', '⭐', '🔥', '💡'] },
    { name: 'Arrows & actions', icons: ['→', '←', '↑', '↓', '↗', '↘', '➜', '⇒', '↻', '↺', '⟳', '➕', '➖', '✂️', '✏️', '🔍', '🔎', '🔗', '📌', '📎'] },
    { name: 'Shapes & bullets', icons: ['●', '○', '■', '□', '▲', '▼', '►', '◄', '◆', '◇', '★', '☆', '✓', '✗', '①', '②', '③', '④', '⑤', '⑥'] },
    { name: 'Devices & objects', icons: ['📱', '💻', '🖥️', '🖨️', '⌨️', '🖱️', '📷', '📁', '📂', '📄', '📝', '📊', '📈', '📅', '⏰', '⏳', '💾', '🗑️', '🔒', '🔓'] },
    { name: 'People & comms', icons: ['👤', '👥', '🙋', '✉️', '📧', '📞', '💬', '🔔', '🔕', '🏠', '🏢', '🛒', '💳', '💰', '🎯', '🧭', '🗺️', '⚙️', '🔑', '☁️'] }
  ];
  function openIconPicker(row, after) {
    var html = '<div class="m-head"><h2>Pick an icon</h2></div><div class="m-body">';
    ICON_GROUPS.forEach(function (g) {
      html += '<div class="label" style="margin:8px 0 6px">' + g.name + '</div><div class="icon-grid">' +
        g.icons.map(function (ic) { return '<button type="button" class="icon-pick" title="' + ic + '">' + ic + '</button>'; }).join('') + '</div>';
    });
    html += '<p class="hint" style="margin-top:12px">Don’t see it? Close this and type or paste any symbol or emoji into the box.</p>' +
      '</div><div class="m-foot"><button class="btn ghost" id="iconCancel">Cancel</button></div>';
    openModal(html);
    Array.prototype.forEach.call(document.querySelectorAll('#modal .icon-pick'), function (b) {
      b.onclick = function () { row.icon = b.textContent; closeModal(); if (after) after(); };
    });
    $('iconCancel').onclick = closeModal;
  }

  // references editor
  function renderRefs() {
    var s = currentStep(); if (!s) return;
    var wrap = $('refRows');
    wrap.innerHTML = '';
    if (!s.references.length) {
      wrap.innerHTML = '<div class="hint" style="margin:0 0 4px">Links and PDFs the reader can open from this step.</div>';
    }
    s.references.forEach(function (r) {
      var div = document.createElement('div');
      div.className = 'ref-row';
      if (r.kind === 'pdf') {
        div.innerHTML = '<span class="ref-badge">PDF</span>';
        var lbl = document.createElement('input'); lbl.className = 'inp'; lbl.style.flex = '1'; lbl.value = r.label || r.name; lbl.placeholder = 'Label shown to the reader';
        lbl.oninput = function () { r.label = lbl.value; };
        div.appendChild(lbl);
      } else {
        var lbl2 = document.createElement('input'); lbl2.className = 'inp'; lbl2.style.width = '38%'; lbl2.value = r.label; lbl2.placeholder = 'Label';
        var href = document.createElement('input'); href.className = 'inp'; href.style.flex = '1'; href.value = r.href; href.placeholder = 'https://…';
        lbl2.oninput = function () { r.label = lbl2.value; };
        href.oninput = function () { r.href = href.value; };
        // Add https:// when the user types a bare domain so the exported link works.
        href.onchange = function () {
          var v = href.value.trim();
          if (v && !/^[a-z][a-z0-9+.-]*:/i.test(v)) { v = 'https://' + v; href.value = v; r.href = v; }
        };
        div.appendChild(lbl2); div.appendChild(href);
      }
      var del = document.createElement('button'); del.className = 'icon-btn'; del.textContent = '🗑';
      del.title = 'Remove this reference'; del.setAttribute('aria-label', 'Remove this reference');
      del.onclick = function () {
        var idx = s.references.indexOf(r);
        s.references = s.references.filter(function (x) { return x !== r; });
        renderRefs(); refreshSections(); updateFooter(); commit();
        var label = (r.kind === 'pdf' ? 'PDF' : 'link') + ((r.label || r.name) ? ' “' + short(r.label || r.name, 30) + '”' : '');
        Undo.push({ label: label, undo: function () {
          if (!stepExists(s)) return false;
          s.references.splice(Math.min(idx, s.references.length), 0, r);
          if (currentStep() === s) { renderRefs(); refreshSections(); }
          updateFooter(); return true;
        } });
        toast('Removed ' + label + '.', { action: 'Undo', onAction: undoLast });
      };
      div.appendChild(del);
      wrap.appendChild(div);
    });
  }

  // ---- annotation inspector --------------------------------------------
  var TYPE_META = {
    arrow: { c: '#c0392b', n: 'Arrow' }, box: { c: '#2c5aa0', n: 'Box' },
    hotspot: { c: '#7b4397', n: 'Hotspot' }, dot: { c: '#2e7d32', n: 'Dot' }, redact: { c: '#1b2733', n: 'Blur' }
  };
  function findAnn(id) { var s = currentStep(); return s && s.annotations.filter(function (a) { return a.id === id; })[0]; }
  function annLabel(a) {
    var n = (TYPE_META[a.type] || { n: a.type }).n.toLowerCase();
    if ((a.type === 'dot' || a.type === 'hotspot') && a.number) n += ' #' + a.number;
    return n;
  }

  // The one path for deleting an annotation (trash icon, editor button, Delete key).
  function deleteAnnotation(step, a) {
    var idx = step.annotations.indexOf(a);
    step.annotations = step.annotations.filter(function (x) { return x !== a; });
    if (annotator.selectedId === a.id) annotator.selectedId = null;
    annotator.render(); renderAnnList(); renderAnnEdit(null); updateStepCard(activePart, activeStepId); refreshSections(); commit();
    var label = annLabel(a);
    Undo.push({ label: label, undo: function () {
      if (!stepExists(step)) return false;
      step.annotations.splice(Math.min(idx, step.annotations.length), 0, a);
      if (currentStep() === step) { annotator.selectedId = a.id; annotator.render(); renderAnnList(); renderAnnEdit(a.id); refreshSections(); }
      renderStepList(); return true;
    } });
    toast('Removed ' + label + '.', { action: 'Undo', onAction: undoLast });
  }

  function undoLast() {
    var r = Undo.pop();
    if (!r) { toast('Nothing to undo (only removals can be undone).'); return; }
    if (r.result) { commit(); toast('Restored ' + r.entry.label + '.'); }
    else toast('Can’t undo — the step it belonged to no longer exists.');
  }

  function renderAnnList() {
    var s = currentStep();
    var ul = $('annList'); if (!ul) return;
    ul.setAttribute('role', 'listbox'); ul.setAttribute('aria-label', 'Annotations on this screenshot');
    var focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('.ann-item');
    var refocus = focused ? focused.dataset.id : null;
    ul.innerHTML = '';
    if (!s || !s.annotations.length) { ul.innerHTML = '<li class="hint" role="presentation" style="border:none;background:none;padding:4px">Pick a tool above, then drag on the screenshot to draw.</li>'; return; }
    s.annotations.forEach(function (a) {
      var li = document.createElement('li');
      var sel = annotator.selectedId === a.id;
      li.className = 'ann-item' + (sel ? ' sel' : '');
      li.tabIndex = 0; li.dataset.id = a.id;
      li.setAttribute('role', 'option'); li.setAttribute('aria-selected', sel ? 'true' : 'false');
      var meta = TYPE_META[a.type] || { n: a.type };
      li.innerHTML = '<span class="badge" style="background:' + a.color + '">' + meta.n + '</span>' +
        '<span class="ann-text">' + V.esc(a.text || (a.number ? '#' + a.number : '—')) + '</span>';
      var del = document.createElement('button'); del.className = 'icon-btn'; del.textContent = '🗑'; del.tabIndex = -1;
      del.title = 'Delete this annotation'; del.setAttribute('aria-label', 'Delete this annotation');
      del.onclick = function (e) { e.stopPropagation(); deleteAnnotation(s, a); };
      li.appendChild(del);
      li.onclick = function () { annotator.setSelected(a.id); };
      keyActivate(li);
      ul.appendChild(li);
    });
    if (refocus) { var back = Array.prototype.filter.call(ul.children, function (n) { return n.dataset && n.dataset.id === refocus; })[0]; if (back) { try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); } } }
  }

  function renderAnnEdit(id) {
    var wrap = $('annEditWrap'); if (!wrap) return;
    var a = id && findAnn(id);
    if (!a) { wrap.innerHTML = ''; return; }
    var meta = TYPE_META[a.type] || { n: a.type };
    var needsText = (a.type === 'hotspot' || a.type === 'dot');   // only labeled annotations carry text
    var html = '<div class="ann-edit"><div class="row"><strong>' + meta.n + '</strong></div>';
    if (needsText) html += '<div class="row"><label>Text</label><textarea class="inp" id="aeText" rows="2" placeholder="' +
      (a.type === 'hotspot' ? 'Shown when the reader taps this area…' : 'Caption listed under the screenshot…') + '">' + V.esc(a.text) + '</textarea></div>';
    if (a.type === 'dot' || a.type === 'hotspot') html += '<div class="row"><label>Number</label><input class="inp" id="aeNum" type="number" min="1" value="' + (a.number || 1) + '" style="width:70px"></div>';
    if (a.type === 'arrow' || a.type === 'box') html += '<div class="row"><label>Thickness</label><input type="range" id="aeWeight" min="0.4" max="3" step="0.2" value="' + (a.weight || 1) + '"><span class="ae-wval">' + (a.weight || 1) + '×</span></div>';
    html += '<div class="row"><label>Color</label><input type="color" class="swatch" id="aeColor" value="' + a.color + '"></div>';
    html += '<div class="row"><button class="btn sm danger" id="aeDel">Delete</button><span class="hint" style="margin:0 0 0 8px">or press Delete</span></div></div>';
    wrap.innerHTML = html;
    var t = $('aeText'); if (t) t.oninput = function () { a.text = t.value; renderAnnList(); };
    var n = $('aeNum'); if (n) n.oninput = function () { a.number = parseInt(n.value, 10) || 1; annotator.render(); renderAnnList(); };
    var wt = $('aeWeight'); if (wt) wt.oninput = function () { a.weight = parseFloat(wt.value); var lbl = wrap.querySelector('.ae-wval'); if (lbl) lbl.textContent = a.weight + '×'; annotator.render(); };
    var c = $('aeColor'); if (c) c.oninput = function () { a.color = c.value; annotator.render(); renderAnnList(); };
    $('aeDel').onclick = function () { var s = currentStep(); if (s) deleteAnnotation(s, a); };
  }

  // ---- footer -----------------------------------------------------------
  function updateFooter() {
    var bytes = S.estimateBytes(project);
    var badge = $('sizeBadge');
    badge.textContent = 'Export size: ' + S.fmtBytes(bytes);
    badge.classList.remove('warn', 'danger');
    badge.title = 'Approximate size of the exported web guide.';
    if (bytes > 20 * 1024 * 1024) { badge.classList.add('danger'); badge.title += ' Over 20 MB — very large for email; consider fewer or smaller screenshots.'; }
    else if (bytes > 15 * 1024 * 1024) { badge.classList.add('warn'); badge.title += ' Getting large for email.'; }
    function tot(plat) { return project.tracks[plat].workflow.length + project.tracks[plat].overview.length; }
    $('stepCounts').textContent = project.devices.map(function (plat) {
      return M.DEVICE_META[plat].label + ': ' + tot(plat);
    }).join(' · ') + ' steps';
  }

  function renderSaveState() {
    var el = $('saveState'); if (!el) return;
    var a = Draft.api, txt, cls = '';
    if (a.state === 'paused') { txt = 'Autosave paused — this guide is open in another tab.'; cls = 'err'; }
    else if (!dirty) { txt = 'No unsaved changes'; }
    else {
      var base = 'Unsaved changes';
      cls = 'dirty';
      if (a.state === 'pending' || a.state === 'saving') txt = base + ' · autosaving…';
      else if (a.state === 'saved') txt = base + ' · draft saved ' + Draft.fmtAgo(a.lastSavedAt);
      else if (a.state === 'lite') txt = base + ' · draft saved ' + Draft.fmtAgo(a.lastSavedAt) + ' (text only — images not stored)';
      else if (a.state === 'unavailable') { txt = base + ' · autosave unavailable here — Save to a file'; cls = 'err'; }
      else if (a.state === 'error') { txt = base + ' · draft too large for browser storage — Save to a file'; cls = 'err'; }
      else txt = base;
    }
    el.className = 'save-state' + (cls ? ' ' + cls : '');
    el.textContent = txt;
    if (a.state === 'paused') {
      var b = document.createElement('button'); b.className = 'link-btn'; b.textContent = 'Take over';
      b.onclick = function (e) { e.stopPropagation(); Draft.takeOver(); renderSaveState(); };
      el.appendChild(b);
    }
  }

  // ===== MODALS ==========================================================
  // opts.onDismiss: what Escape / backdrop-click does (default closeModal);
  // pass null to make the modal non-dismissible.
  var modalReturnFocus = null;
  function openModal(html, opts) {
    opts = opts || {};
    modalDismiss = (opts.onDismiss === null) ? null : (opts.onDismiss || closeModal);
    modalReturnFocus = document.activeElement;
    var m = $('modal');
    m.innerHTML = html;
    var h = m.querySelector('h2');
    if (h) { h.id = 'modalTitle'; m.setAttribute('aria-labelledby', 'modalTitle'); }
    $('modalBack').classList.add('open');
    $('modalBack').onclick = function (e) { if (e.target === $('modalBack') && modalDismiss) modalDismiss(); };
    // Move focus into the dialog (prefer an [autofocus] control).
    setTimeout(function () {
      if (!modalOpen()) return;
      var f = m.querySelector('[autofocus]') || focusables(m)[0] || m;
      try { f.focus(); } catch (e) {}
    }, 0);
  }
  function closeModal() {
    $('modalBack').classList.remove('open'); modalDismiss = null;
    var back = modalReturnFocus; modalReturnFocus = null;
    if (back && back.focus && document.contains(back)) { try { back.focus({ preventScroll: true }); } catch (e) {} }
  }

  function openSaveModal() {
    openModal(
      '<div class="m-head"><h2>Save guide to a file</h2></div><div class="m-body">' +
      '<p class="hint" style="margin:0 0 12px">Saving downloads a file you can reopen later with <strong>Load</strong>. Autosave only keeps a draft in this browser.</p>' +
      '<div class="choice-card" id="saveFat" role="button" tabindex="0" autofocus><h4>📦 One file (recommended)</h4><p>Everything — text, screenshots and PDFs — in a single file you can email, copy or back up.</p></div>' +
      '<div class="choice-card" id="saveFolder" role="button" tabindex="0"><h4>🗂 Small file + image folder (advanced)</h4><p>Keeps screenshots as separate image files next to a small guide file. You’ll be asked to re-select the images when loading.</p></div>' +
      '</div><div class="m-foot"><button class="btn ghost" id="saveCancel">Cancel</button></div>'
    );
    keyActivate($('saveFat')); keyActivate($('saveFolder'));
    $('saveFat').onclick = function () {
      closeModal(); S.saveFat(project); markClean();
      toast('Saved as one file — check your browser’s Downloads folder.');
    };
    $('saveFolder').onclick = function () {
      closeModal(); var n = S.saveFolder(project); markClean();
      toast('Saved the guide file + ' + n + ' image file' + (n === 1 ? '' : 's') + ' — keep them together in one folder.');
    };
    $('saveCancel').onclick = closeModal;
  }

  function openSettingsModal() {
    var p = project;
    openModal(
      '<div class="m-head"><h2>Guide details</h2></div><div class="m-body">' +
      '<div class="field"><label class="label">Guide title</label><input class="inp" id="setTitle" value="' + V.esc(p.title) + '" placeholder="e.g. Set up Microsoft Authenticator"></div>' +
      '<div class="field"><label class="label">Description <span class="opt">(optional)</span></label><textarea class="inp" id="setDesc" rows="2" placeholder="One or two sentences shown on the guide’s first screen.">' + V.esc(p.description) + '</textarea></div>' +
      '<label class="label">Support contact <span class="opt">(optional)</span></label>' +
      '<p class="hint" style="margin:2px 0 8px">Readers get an “I’m stuck” button that emails this address with the step they’re on. Leave it blank to hide the button.</p>' +
      '<div class="two-col"><div class="field"><label class="label">Name</label><input class="inp" id="setIptName" value="' + V.esc(p.ipt.name) + '" placeholder="e.g. IT Help Desk"></div>' +
      '<div class="field"><label class="label">Email</label><input class="inp" id="setIptEmail" type="email" value="' + V.esc(p.ipt.email) + '" placeholder="help@example.com"></div></div>' +
      '<hr class="divider"><label class="label">Device types in this guide</label>' +
      '<div class="dev-checks">' + M.PLATFORMS.map(function (plat) {
        var m = M.DEVICE_META[plat];
        return '<label class="dev-check"><input type="checkbox" value="' + plat + '"' + (p.devices.indexOf(plat) >= 0 ? ' checked' : '') + '>' + m.icon + ' ' + m.label + '</label>';
      }).join('') + '</div>' +
      '<p class="hint" style="margin:2px 0 0">Pick mobile (Android and/or iPhone) <em>or</em> Computer — not both. Readers are asked which device only when more than one is enabled.</p>' +
      '<hr class="divider"><div class="field"><label class="label">Marker size</label>' +
      '<select class="inp" id="setAnnScale">' + [[0.7, 'Small — for busy desktop screens'], [1, 'Medium (default)'], [1.3, 'Large']].map(function (o) {
        return '<option value="' + o[0] + '"' + (Math.abs((p.annScale || 1) - o[0]) < 0.01 ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>' +
      '<p class="hint" style="margin:4px 0 0">How big arrows, dots, boxes and hotspot badges are drawn on every screenshot (builder, web guide and PDF).</p></div>' +
      '<hr class="divider"><div class="field"><label class="label">Guide font</label>' +
      '<select class="inp" id="setFont">' + M.FONTS.map(function (f) {
        return '<option value="' + f.key + '"' + (p.font === f.key ? ' selected' : '') + ' style="font-family:' + f.stack.replace(/"/g, "'") + '">' + f.label + '</option>';
      }).join('') + '</select>' +
      '<div class="label" style="margin-top:8px">Preview</div>' +
      '<div class="font-preview" id="fontPreview">The quick brown fox jumps over the lazy dog. 1234567890</div>' +
      '<p class="hint" style="margin:4px 0 0">Export only — sets the reading text in the exported guide (web &amp; PDF). The builder’s own look doesn’t change.</p></div>' +
      '<hr class="divider"><label class="dev-check" style="flex:none"><input type="checkbox" id="setAutoOpen"' + (getAutoOpen() ? ' checked' : '') + '> Open Guide details automatically when I launch the builder</label>' +
      '</div><div class="m-foot"><button class="btn ghost" id="setCancel">Cancel</button><button class="btn primary" id="setSave">Save details</button></div>'
    );

    // Mobile (android/iphone) and Computer (pc) are mutually exclusive.
    var devInputs = document.querySelectorAll('.dev-checks input');
    Array.prototype.forEach.call(devInputs, function (inp) {
      inp.onchange = function () {
        if (!inp.checked) return;
        Array.prototype.forEach.call(devInputs, function (o) {
          if (o === inp) return;
          var crossGroup = (inp.value === 'pc') !== (o.value === 'pc');
          if (crossGroup) o.checked = false;
        });
      };
    });

    // live font preview
    var fontSel = $('setFont'), fontPrev = $('fontPreview');
    function applyFontPreview() {
      var f = M.FONTS.filter(function (x) { return x.key === fontSel.value; })[0];
      if (f && fontPrev) fontPrev.style.fontFamily = f.stack;
    }
    if (fontSel) { applyFontPreview(); fontSel.onchange = applyFontPreview; }
    setTimeout(function () { var t = $('setTitle'); if (t) t.focus(); }, 0);

    $('setCancel').onclick = closeModal;
    $('setSave').onclick = function () {
      var checked = Array.prototype.map.call(document.querySelectorAll('.dev-checks input:checked'), function (i) { return i.value; });
      if (!checked.length) { alert('Pick at least one device type (Android, iPhone or Computer).'); return; }
      var email = $('setIptEmail').value.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (!confirm('“' + email + '” doesn’t look like an email address. The “I’m stuck” button needs a valid address. Save anyway?')) return;
      }
      var newDevices = M.sanitizeDevices(M.PLATFORMS.filter(function (x) { return checked.indexOf(x) >= 0; }));
      // Warn when turning off a device that already has steps (they stay in the file, just hidden).
      var hidden = p.devices.filter(function (d) {
        var t = p.tracks[d]; return newDevices.indexOf(d) < 0 && (t.workflow.length + t.overview.length) > 0;
      }).map(function (d) { var t = p.tracks[d]; return M.DEVICE_META[d].label + ' (' + (t.workflow.length + t.overview.length) + ' steps)'; });
      if (hidden.length && !confirm('Turning off ' + hidden.join(' and ') + ' hides those steps from the guide. They stay in the file and come back if you re-enable the device. Continue?')) return;
      p.title = $('setTitle').value.trim(); p.description = $('setDesc').value.trim();
      p.ipt.name = $('setIptName').value.trim(); p.ipt.email = email;
      p.font = $('setFont').value;
      p.annScale = parseFloat($('setAnnScale').value) || 1;
      setAutoOpen($('setAutoOpen').checked);
      p.devices = newDevices;
      if (p.devices.indexOf(activeTrack) < 0) { activeTrack = p.devices[0]; activeStepId = null; }
      closeModal(); renderAll(); commit(); toast('Guide details saved.');
    };
  }

  // Per-browser preference: auto-open Guide details on launch (default on).
  function getAutoOpen() {
    try { return localStorage.getItem('gb.autoOpenSettings') !== '0'; } catch (e) { return true; }
  }
  function setAutoOpen(on) {
    try { localStorage.setItem('gb.autoOpenSettings', on ? '1' : '0'); } catch (e) {}
  }

  // ===== RESTORE DRAFT (launch) ==========================================
  function openRestoreModal(d) {
    var lite = !!d.lite;
    var n = d.steps || 0;
    openModal(
      '<div class="m-head"><h2>Restore unsaved draft?</h2></div><div class="m-body">' +
      '<p>A draft of <strong>“' + V.esc(d.title || 'Untitled guide') + '”</strong> was autosaved <strong>' + Draft.fmtAgo(d.savedAt) + '</strong>' +
      ' (' + V.esc(new Date(d.savedAt).toLocaleString()) + ') — ' + n + ' step' + (n === 1 ? '' : 's') +
      (d.bytes ? ', ' + S.fmtBytes(d.bytes) + ' of screenshots' : '') + '. It was never saved to a file.</p>' +
      (lite ? '<p class="hint">This draft was saved without images because of this browser’s storage limit — you’ll be asked to re-select the original screenshots.</p>' : '') +
      '</div><div class="m-foot"><button class="btn ghost" id="draftDiscard">Discard draft</button><button class="btn primary" id="draftRestore" autofocus>Restore draft</button></div>',
      { onDismiss: null }
    );
    $('draftRestore').onclick = function () {
      closeModal();
      if (lite) {
        var res;
        try { res = S.parseProjectFile(d.json); }
        catch (e) { Draft.clear(); toast('That draft couldn’t be read, so it was discarded.'); normalLaunch(); return; }
        setProject(res.project); dirty = true; Draft.setOwned(); Draft.markChanged(); renderAll(); renderSaveState();
        if (res.missing && res.missing.length) promptForMedia(res.missing);
        else toast('Draft restored — remember to Save (Ctrl+S) to write a file.');
      } else {
        setProject(M.normalizeProject(d.project)); dirty = true; Draft.setOwned(); Draft.markChanged(); renderAll(); renderSaveState();
        toast('Draft restored — remember to Save (Ctrl+S) to write a file.');
      }
    };
    $('draftDiscard').onclick = function () {
      if (!confirm('Delete this draft? This can’t be undone.')) return;
      closeModal(); Draft.clear(); normalLaunch();
    };
  }

  // ===== OPEN / LOAD =====================================================
  function openProjectFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var res;
      try { res = S.parseProjectFile(fr.result); }
      catch (err) { alert('That file isn’t a saved guide (.guide.json). Pick a file created with Save.'); return; }
      setProject(res.project); markClean();
      if (res.missing && res.missing.length) promptForMedia(res.missing);
      else { renderAll(); toast('Guide loaded.'); }
    };
    fr.onerror = function () { alert('That file couldn’t be read.'); };
    fr.readAsText(file);
  }

  function promptForMedia(missing) {
    var skip = function () { closeModal(); renderAll(); toast('Loaded without ' + missing.length + ' image' + (missing.length === 1 ? '' : 's') + ' — use Replace screenshot on those steps.'); };
    openModal(
      '<div class="m-head"><h2>Find the guide’s images</h2></div><div class="m-body">' +
      '<p>This guide keeps its <strong>' + missing.length + '</strong> screenshot' + (missing.length === 1 ? '' : 's') +
      ' as separate files next to the guide file. Select them (choosing the whole image folder is fine) so they can be loaded for editing.</p>' +
      '<ul class="mono" style="font-size:12px;max-height:140px;overflow:auto">' + missing.map(function (m) { return '<li>' + V.esc(m) + '</li>'; }).join('') + '</ul>' +
      '<p class="hint" style="margin-top:6px">Files are matched by <strong>filename</strong> — keep the original names. Renamed or unselected files stay missing (the rest still load).</p>' +
      '</div><div class="m-foot"><button class="btn ghost" id="mediaSkip">Load without images</button><button class="btn primary" id="mediaPick">Select files…</button></div>',
      { onDismiss: skip }
    );
    $('mediaPick').onclick = function () { $('fileMedia').click(); };
    $('mediaSkip').onclick = skip;
    $('fileMedia').onchange = function (e) {
      var files = e.target.files; e.target.value = '';
      S.attachMedia(project, files).then(function (stillMissing) {
        closeModal(); renderAll();
        toast(stillMissing.length
          ? ('Loaded — ' + stillMissing.length + ' image' + (stillMissing.length === 1 ? ' is' : 's are') + ' still missing.')
          : 'Guide and images loaded.');
      });
    };
  }

  // ---- toast ------------------------------------------------------------
  var toastTimer = null;
  function toast(msg, opts) {
    opts = opts || {};
    var t = $('toast');
    t.innerHTML = '';
    t.className = 'toast show' + (opts.action ? ' actionable' : '');
    var span = document.createElement('span'); span.textContent = msg; t.appendChild(span);
    if (opts.action) {
      var b = document.createElement('button'); b.className = 'toast-btn'; b.textContent = opts.action;
      b.onclick = function () { t.classList.remove('show'); if (opts.onAction) opts.onAction(); };
      t.appendChild(b);
    }
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, opts.ms || (opts.action ? 8000 : 3200));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
