/* app.js — builder controller. Wires the DOM shell to the model, annotator,
 * storage and exporter. Classic script -> runs on load.
 *
 * Layout: left = step lists (workflow + overview), center = annotation stage,
 * right = collapsible build panel (step details / annotations / tip / key / refs).
 * Every track holds BOTH a workflow and an overview part (no type toggle). */
(function () {
  'use strict';
  var M = window.Model, S = window.Storage, V = window.Viewer, X = window.Exporter;

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
  var pendingKey = null;            // { row, after } during a key-image upload

  var $ = function (id) { return document.getElementById(id); };
  var track = function () { return project.tracks[activeTrack]; };
  var partSteps = function (part) { return track()[part]; };
  var steps = function () { return partSteps(activePart); };
  var currentStep = function () { return steps().filter(function (s) { return s.id === activeStepId; })[0] || null; };

  // ---- boot -------------------------------------------------------------
  function init() {
    buildColorDots();
    bindTopbar();
    bindPartActions();
    bindFileInputs();
    bindStepDetails();
    bindStageTools();
    bindDropzone();
    bindSections();
    bindKeyboard();

    annotator = new window.Annotator($('stage'), {
      getStep: currentStep,
      getTool: function () { return tool; },
      getColor: function () { return color; },
      onChange: function () { renderAnnList(); refreshSections(); renderStepList(); updateFooter(); },
      onSelect: function (id) { renderAnnList(); renderAnnEdit(id); }
    });

    renderAll();
    toast('New project — add screenshots to begin.');
  }

  // ---- top bar ----------------------------------------------------------
  function bindTopbar() {
    $('btnNew').onclick = function () {
      if (!confirm('Start a new project? Unsaved changes will be lost.')) return;
      project = M.newProject(); activeTrack = 'android'; activePart = 'workflow'; activeStepId = null; renderAll();
    };
    $('btnOpen').onclick = function () { $('fileOpen').click(); };
    $('btnSave').onclick = openSaveModal;
    $('btnSettings').onclick = openSettingsModal;
    $('btnPreview').onclick = function () { X.preview(project); };
    $('btnExport').onclick = function () { var b = X.exportHTML(project); toast('Exported self-contained HTML (' + S.fmtBytes(b) + ').'); };
    $('btnPdf').onclick = function () {
      if (!partSteps('workflow').length && !partSteps('overview').length) { toast('Add at least one step first.'); return; }
      X.exportPDF(project, activeTrack);
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
      b.onclick = function () { pendingShotPart = b.getAttribute('data-add-shots'); $('fileShots').click(); };
    });
  }

  // ---- colors / tools ---------------------------------------------------
  function buildColorDots() {
    var wrap = $('colorDots');
    wrap.innerHTML = '';
    M.PALETTE.forEach(function (p, i) {
      var d = document.createElement('span');
      d.className = 'color-dot' + (i === 0 ? ' active' : '');
      d.style.background = p.value; d.title = p.name;
      d.onclick = function () {
        color = p.value;
        Array.prototype.forEach.call(wrap.children, function (c) { c.classList.remove('active'); });
        d.classList.add('active');
        var sel = annotator && annotator.selectedId && findAnn(annotator.selectedId);
        if (sel) { sel.color = color; annotator.render(); renderAnnList(); }
      };
      wrap.appendChild(d);
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
    bindText('fTitle', 'title', function () { renderStepList(); });
    bindText('fBody', 'body');
    bindText('fNote', 'note', refreshSections);
    bindText('fTip', 'tip', refreshSections);
    bindText('fTableTitle', 'tableTitle');
    bindText('fLinkLabel', 'linkLabel');
    $('btnReplaceShot').onclick = function () { if (currentStep()) $('fileReplace').click(); };
    $('btnRemoveStep').onclick = function () {
      var s = currentStep(); if (!s) return;
      if (!confirm('Remove this entire step?')) return;
      deleteStep(s);
    };
    $('btnAddTableRow').onclick = function () { var s = currentStep(); if (!s) return; s.table.push(M.newLegendRow()); renderStepTable(); refreshSections(); };
    $('btnAddLink').onclick = function () {
      var s = currentStep(); if (!s) return;
      s.references.push({ id: M.uid('ref'), kind: 'link', label: '', href: '', data: '', name: '' });
      renderRefs(); refreshSections();
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

  // ---- file inputs ------------------------------------------------------
  function bindFileInputs() {
    $('fileShots').onchange = function (e) { handleScreenshots(pendingShotPart, e.target.files); e.target.value = ''; };
    $('fileReplace').onchange = function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) replaceCurrentImage(f); };
    $('filePdf').onchange = function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) attachPdf(f); };
    $('fileOpen').onchange = function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) openProjectFile(f); };
    $('fileKeyImg').onchange = function (e) {
      var f = e.target.files[0]; e.target.value = '';
      if (f && pendingKey) {
        var row = pendingKey.row, after = pendingKey.after;
        S.readAsDataURL(f).then(function (d) { row.image = d; row.kind = 'image'; if (after) after(); updateFooter(); });
      }
      pendingKey = null;
    };
  }

  // Add screenshots as new steps in a part, auto-ordered by lastModified.
  function handleScreenshots(part, fileList) {
    var files = Array.prototype.slice.call(fileList).filter(function (f) { return /^image\//.test(f.type); });
    if (!files.length) return;
    files.sort(function (a, b) { return (a.lastModified || 0) - (b.lastModified || 0); });
    Promise.all(files.map(S.readImageFile)).then(function (imgs) {
      var firstNew = null;
      imgs.forEach(function (im) {
        var st = M.newStep();
        st.image = im;        // title left blank by default
        partSteps(part).push(st);
        if (!firstNew) firstNew = st;
      });
      // jump selection to the first newly-added step so it's ready to edit
      activePart = part;
      activeStepId = firstNew.id;
      renderAll();
      toast('Added ' + imgs.length + ' screenshot' + (imgs.length > 1 ? 's' : '') + ' to ' + part + ' (ordered by file date).');
    });
  }

  function replaceCurrentImage(file) {
    var s = currentStep(); if (!s) return;
    S.readImageFile(file).then(function (im) {
      s.image = im;               // annotations kept — % coords stay put
      annotator.render(); renderStepList(); updateFooter();
      toast('Screenshot swapped — annotations preserved.');
    });
  }

  function attachPdf(file) {
    var s = currentStep(); if (!s) return;
    S.readPdfFile(file).then(function (r) {
      s.references.push({ id: M.uid('ref'), kind: 'pdf', label: file.name, href: '', data: r.data, name: file.name });
      renderRefs(); refreshSections(); updateFooter();
    });
  }

  // ---- drag & drop screenshots onto the stage --------------------------
  function bindDropzone() {
    var dz = $('stageCol');
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { if (ev !== 'drop') { e.preventDefault(); dz.classList.remove('dragover'); } });
    });
    dz.addEventListener('drop', function (e) {
      e.preventDefault(); dz.classList.remove('dragover');
      var files = Array.prototype.slice.call(e.dataTransfer.files).filter(function (f) { return /^image\//.test(f.type); });
      if (!files.length) return;
      if (files.length === 1 && currentStep()) replaceCurrentImage(files[0]);
      else handleScreenshots(currentStep() ? activePart : 'workflow', files);
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      if (e.target.closest && e.target.closest('#stageCol')) return;
      e.preventDefault();
      var files = Array.prototype.slice.call(e.dataTransfer.files).filter(function (f) { return /^image\//.test(f.type); });
      if (files.length) handleScreenshots(activePart, files);
    });
  }

  // ---- sections collapse ------------------------------------------------
  function bindSections() {
    Array.prototype.forEach.call(document.querySelectorAll('#buildPanel .sec-head'), function (h) {
      h.onclick = function (e) {
        if (e.target.closest('input,textarea,button,select')) return;
        h.parentNode.classList.toggle('open');
      };
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
    if (f) f.textContent = on ? '●' : '';
  }

  // ---- keyboard ---------------------------------------------------------
  function bindKeyboard() {
    document.addEventListener('keydown', function (e) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && annotator && annotator.selectedId) {
        e.preventDefault(); annotator.deleteSelected(); renderAnnList(); renderAnnEdit(null);
      }
    });
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
    return cnt ? ' · ⓘ ' + cnt : '';
  }

  function renderListInto(part, ul) {
    ul.innerHTML = '';
    var arr = partSteps(part);
    if (!arr.length) {
      var empty = document.createElement('li');
      empty.className = 'step-empty';
      empty.textContent = part === 'workflow' ? 'No workflow steps yet.' : 'No overview steps yet.';
      ul.appendChild(empty);
      return;
    }
    arr.forEach(function (s, i) {
      var li = document.createElement('li');
      li.className = 'step-card' + (part === activePart && s.id === activeStepId ? ' active' : '');
      li.draggable = true;
      li.dataset.id = s.id; li.dataset.part = part;
      var thumb = s.image && s.image.src ? '<img class="sc-thumb" src="' + s.image.src + '">' : '';
      var annCount = (s.annotations || []).length;
      li.innerHTML =
        '<span class="grip">⋮⋮</span>' +
        '<span class="num">' + (i + 1) + '</span>' + thumb +
        '<span class="sc-body"><span class="sc-title">' + V.esc(s.title || 'Untitled step') + '</span>' +
        '<span class="sc-meta">' + (s.image ? '🖼' : '—') + (annCount ? ' · ' + annCount + ' ann' : '') + linkMeta(part, s) + '</span></span>' +
        '<button class="insert-here" title="Insert step below">＋</button>';
      li.onclick = function (e) {
        if (e.target.closest('.insert-here')) { insertStepAt(part, i + 1); return; }
        selectStep(part, s.id);
      };
      bindStepDnD(li, part, i);
      ul.appendChild(li);
    });
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
    arr.splice(to, 0, item);
    renderStepList();
  }

  function insertStepAt(part, idx) {
    var st = M.newStep();
    partSteps(part).splice(idx, 0, st);
    activePart = part; activeStepId = st.id;
    renderAll();
    $('fTitle').focus();
  }

  function deleteStep(s) {
    var arr = steps();
    var i = arr.map(function (x) { return x.id; }).indexOf(s.id);
    if (i >= 0) arr.splice(i, 1);
    activeStepId = null;
    if (annotator) annotator.selectedId = null;
    renderAll();
  }

  function selectStep(part, id) {
    activePart = part; activeStepId = id;
    if (annotator) annotator.selectedId = null;
    renderStepList();
    renderStage();
    renderBuildPanel();
  }

  function renderStage() {
    var s = currentStep();
    if (!s) { $('stageEmpty').style.display = ''; $('stageHost').style.display = 'none'; return; }
    $('stageEmpty').style.display = 'none';
    $('stageHost').style.display = '';
    annotator.render();
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
      wrap.innerHTML = '<div class="hint" style="padding:2px">No workflow steps yet — this is an overview-only guide (an app tour).</div>';
    }
    wf.forEach(function (ws, i) {
      var id = 'lnk_' + ws.id;
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
        renderStepList();
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
    s.table.forEach(function (row) {
      wrap.appendChild(tableRowEditor(row, function () {
        s.table = s.table.filter(function (r) { return r.id !== row.id; });
        renderStepTable(); refreshSections(); updateFooter();
      }));
    });
  }

  // shared row editor for the per-step color/icon key. Supports
  // color swatch, glyph icon, or an uploaded image crop.
  function tableRowEditor(row, onDelete) {
    var div = document.createElement('div');
    div.className = 'table-row';
    var kind = document.createElement('select');
    kind.className = 'kind inp';
    kind.innerHTML = '<option value="color">Color</option><option value="icon">Icon</option><option value="image">Image</option>';
    kind.value = row.kind;
    var swatch = document.createElement('input');
    swatch.type = 'color'; swatch.className = 'swatch'; swatch.value = row.value || '#c0392b';
    var iconIn = document.createElement('input');
    iconIn.type = 'text'; iconIn.className = 'inp icon-in'; iconIn.placeholder = '★'; iconIn.value = row.icon || '';
    var imgBtn = document.createElement('button'); imgBtn.className = 'btn sm ghost'; imgBtn.textContent = 'Upload';
    var thumb = document.createElement('img'); thumb.className = 'key-thumb';
    var text = document.createElement('input');
    text.type = 'text'; text.className = 'inp text'; text.placeholder = 'What it means…'; text.value = row.text || '';
    var del = document.createElement('button'); del.className = 'icon-btn'; del.textContent = '🗑';

    function syncKind() {
      swatch.style.display = row.kind === 'color' ? '' : 'none';
      iconIn.style.display = row.kind === 'icon' ? '' : 'none';
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
    div.appendChild(kind); div.appendChild(swatch); div.appendChild(iconIn);
    div.appendChild(imgBtn); div.appendChild(thumb); div.appendChild(text); div.appendChild(del);
    return div;
  }

  // references editor
  function renderRefs() {
    var s = currentStep(); if (!s) return;
    var wrap = $('refRows');
    wrap.innerHTML = '';
    s.references.forEach(function (r) {
      var div = document.createElement('div');
      div.className = 'ref-row';
      if (r.kind === 'pdf') {
        div.innerHTML = '<span class="ref-badge">PDF</span>';
        var lbl = document.createElement('input'); lbl.className = 'inp'; lbl.style.flex = '1'; lbl.value = r.label || r.name; lbl.placeholder = 'Label';
        lbl.oninput = function () { r.label = lbl.value; };
        div.appendChild(lbl);
      } else {
        var lbl2 = document.createElement('input'); lbl2.className = 'inp'; lbl2.style.width = '38%'; lbl2.value = r.label; lbl2.placeholder = 'Label';
        var href = document.createElement('input'); href.className = 'inp'; href.style.flex = '1'; href.value = r.href; href.placeholder = 'https://…';
        lbl2.oninput = function () { r.label = lbl2.value; };
        href.oninput = function () { r.href = href.value; };
        div.appendChild(lbl2); div.appendChild(href);
      }
      var del = document.createElement('button'); del.className = 'icon-btn'; del.textContent = '🗑';
      del.onclick = function () { s.references = s.references.filter(function (x) { return x.id !== r.id; }); renderRefs(); refreshSections(); updateFooter(); };
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

  function renderAnnList() {
    var s = currentStep();
    var ul = $('annList'); if (!ul) return;
    ul.innerHTML = '';
    if (!s || !s.annotations.length) { ul.innerHTML = '<li class="hint" style="border:none;background:none;padding:4px">Pick a tool above, then draw on the screenshot.</li>'; return; }
    s.annotations.forEach(function (a) {
      var li = document.createElement('li');
      li.className = 'ann-item' + (annotator.selectedId === a.id ? ' sel' : '');
      var meta = TYPE_META[a.type] || { n: a.type };
      li.innerHTML = '<span class="badge" style="background:' + a.color + '">' + meta.n + '</span>' +
        '<span class="ann-text">' + V.esc(a.text || (a.number ? '#' + a.number : '—')) + '</span>';
      var del = document.createElement('button'); del.className = 'icon-btn'; del.textContent = '🗑';
      del.onclick = function (e) { e.stopPropagation(); s.annotations = s.annotations.filter(function (x) { return x.id !== a.id; }); annotator.selectedId = null; annotator.render(); renderAnnList(); renderAnnEdit(null); renderStepList(); refreshSections(); };
      li.appendChild(del);
      li.onclick = function () { annotator.setSelected(a.id); };
      ul.appendChild(li);
    });
  }

  function renderAnnEdit(id) {
    var wrap = $('annEditWrap'); if (!wrap) return;
    var a = id && findAnn(id);
    if (!a) { wrap.innerHTML = ''; return; }
    var meta = TYPE_META[a.type] || { n: a.type };
    var needsText = (a.type === 'hotspot' || a.type === 'dot');   // only labeled annotations carry text
    var html = '<div class="ann-edit"><div class="row"><strong>' + meta.n + '</strong></div>';
    if (needsText) html += '<div class="row"><label>Text</label><textarea class="inp" id="aeText" rows="2" placeholder="' +
      (a.type === 'hotspot' ? 'Revealed on tap/hover…' : 'Callout text…') + '">' + V.esc(a.text) + '</textarea></div>';
    if (a.type === 'dot' || a.type === 'hotspot') html += '<div class="row"><label>Number</label><input class="inp" id="aeNum" type="number" min="1" value="' + (a.number || 1) + '" style="width:70px"></div>';
    if (a.type === 'arrow' || a.type === 'box') html += '<div class="row"><label>Thickness</label><input type="range" id="aeWeight" min="0.4" max="3" step="0.2" value="' + (a.weight || 1) + '"><span class="ae-wval">' + (a.weight || 1) + '×</span></div>';
    html += '<div class="row"><label>Color</label><input type="color" class="swatch" id="aeColor" value="' + a.color + '"></div>';
    html += '<div class="row"><button class="btn sm danger" id="aeDel">Delete</button></div></div>';
    wrap.innerHTML = html;
    var t = $('aeText'); if (t) t.oninput = function () { a.text = t.value; renderAnnList(); };
    var n = $('aeNum'); if (n) n.oninput = function () { a.number = parseInt(n.value, 10) || 1; annotator.render(); renderAnnList(); };
    var wt = $('aeWeight'); if (wt) wt.oninput = function () { a.weight = parseFloat(wt.value); var lbl = wrap.querySelector('.ae-wval'); if (lbl) lbl.textContent = a.weight + '×'; annotator.render(); };
    var c = $('aeColor'); if (c) c.oninput = function () { a.color = c.value; annotator.render(); renderAnnList(); };
    $('aeDel').onclick = function () { var s = currentStep(); s.annotations = s.annotations.filter(function (x) { return x.id !== a.id; }); annotator.selectedId = null; annotator.render(); renderAnnList(); renderAnnEdit(null); renderStepList(); refreshSections(); };
  }

  // ---- footer size ------------------------------------------------------
  function updateFooter() {
    var bytes = S.estimateBytes(project);
    var badge = $('sizeBadge');
    badge.textContent = 'Est. export size: ' + S.fmtBytes(bytes);
    badge.classList.remove('warn', 'danger');
    if (bytes > 20 * 1024 * 1024) badge.classList.add('danger');
    else if (bytes > 15 * 1024 * 1024) badge.classList.add('warn');
    function tot(plat) { return project.tracks[plat].workflow.length + project.tracks[plat].overview.length; }
    $('stepCounts').textContent = project.devices.map(function (plat) {
      return M.DEVICE_META[plat].label + ': ' + tot(plat);
    }).join(' · ') + ' steps';
  }

  // ===== MODALS ==========================================================
  function openModal(html) {
    $('modal').innerHTML = html;
    $('modalBack').classList.add('open');
    $('modalBack').onclick = function (e) { if (e.target === $('modalBack')) closeModal(); };
  }
  function closeModal() { $('modalBack').classList.remove('open'); }

  function openSaveModal() {
    openModal(
      '<div class="m-head"><h2>Save project</h2></div><div class="m-body">' +
      '<div class="choice-card" id="saveFat"><h4>📦 Single file (fat JSON)</h4><p>Everything — screenshots &amp; PDFs — embedded as base64 in one .json. Easiest to move around. Larger.</p></div>' +
      '<div class="choice-card" id="saveFolder"><h4>🗂 JSON + image folder</h4><p>A small .json that references image/PDF files, downloaded alongside it. Friendlier to version control &amp; editing. Keep them together.</p></div>' +
      '</div><div class="m-foot"><button class="btn ghost" id="saveCancel">Cancel</button></div>'
    );
    $('saveFat').onclick = function () { S.saveFat(project); closeModal(); toast('Saved single-file project.'); };
    $('saveFolder').onclick = function () { var n = S.saveFolder(project); closeModal(); toast('Saved JSON + ' + n + ' media file' + (n === 1 ? '' : 's') + ' — keep them in one folder.'); };
    $('saveCancel').onclick = closeModal;
  }

  function openSettingsModal() {
    var p = project;
    openModal(
      '<div class="m-head"><h2>Project settings</h2></div><div class="m-body">' +
      '<div class="field"><label class="label">Guide title</label><input class="inp" id="setTitle" value="' + V.esc(p.title) + '"></div>' +
      '<div class="field"><label class="label">Description</label><textarea class="inp" id="setDesc" rows="2">' + V.esc(p.description) + '</textarea></div>' +
      '<div class="two-col"><div class="field"><label class="label">IPT contact name</label><input class="inp" id="setIptName" value="' + V.esc(p.ipt.name) + '"></div>' +
      '<div class="field"><label class="label">IPT contact email (“I’m stuck”)</label><input class="inp" id="setIptEmail" type="email" value="' + V.esc(p.ipt.email) + '"></div></div>' +
      '<hr class="divider"><label class="label">Device types in this guide</label>' +
      '<div class="dev-checks">' + M.PLATFORMS.map(function (plat) {
        var m = M.DEVICE_META[plat];
        return '<label class="dev-check"><input type="checkbox" value="' + plat + '"' + (p.devices.indexOf(plat) >= 0 ? ' checked' : '') + '>' + m.icon + ' ' + m.label + '</label>';
      }).join('') + '</div>' +
      '<p class="hint" style="margin:2px 0 0">Pick mobile (Android and/or iPhone) <em>or</em> Computer — not both. Readers are asked which device only when more than one is enabled.</p>' +
      '</div><div class="m-foot"><button class="btn ghost" id="setCancel">Close</button><button class="btn primary" id="setSave">Save</button></div>'
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

    $('setCancel').onclick = closeModal;
    $('setSave').onclick = function () {
      var checked = Array.prototype.map.call(document.querySelectorAll('.dev-checks input:checked'), function (i) { return i.value; });
      if (!checked.length) { alert('Select at least one device type.'); return; }
      p.title = $('setTitle').value; p.description = $('setDesc').value;
      p.ipt.name = $('setIptName').value; p.ipt.email = $('setIptEmail').value;
      p.devices = M.sanitizeDevices(M.PLATFORMS.filter(function (x) { return checked.indexOf(x) >= 0; }));
      if (p.devices.indexOf(activeTrack) < 0) { activeTrack = p.devices[0]; activeStepId = null; }
      closeModal(); renderAll(); toast('Project settings saved.');
    };
  }

  // ===== OPEN / LOAD =====================================================
  function openProjectFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var res;
      try { res = S.parseProjectFile(fr.result); }
      catch (err) { alert('Could not read that file: ' + err.message); return; }
      project = res.project; activeTrack = 'android'; activePart = 'workflow'; activeStepId = null;
      if (res.missing && res.missing.length) promptForMedia(res.missing);
      else { renderAll(); toast('Project loaded.'); }
    };
    fr.readAsText(file);
  }

  function promptForMedia(missing) {
    openModal(
      '<div class="m-head"><h2>Locate images</h2></div><div class="m-body">' +
      '<p>This project references <strong>' + missing.length + '</strong> media file' + (missing.length === 1 ? '' : 's') +
      ' that live next to the JSON. Select them (the whole image folder is fine) so they can be loaded for editing.</p>' +
      '<ul class="mono" style="font-size:12px;max-height:140px;overflow:auto">' + missing.map(function (m) { return '<li>' + V.esc(m) + '</li>'; }).join('') + '</ul>' +
      '</div><div class="m-foot"><button class="btn ghost" id="mediaSkip">Load without images</button><button class="btn primary" id="mediaPick">Select files…</button></div>'
    );
    $('mediaPick').onclick = function () { $('fileMedia').click(); };
    $('mediaSkip').onclick = function () { closeModal(); renderAll(); toast('Loaded (some images missing).'); };
    $('fileMedia').onchange = function (e) {
      var files = e.target.files; e.target.value = '';
      S.attachMedia(project, files).then(function (stillMissing) {
        closeModal(); renderAll();
        toast(stillMissing.length ? ('Loaded — ' + stillMissing.length + ' file(s) still missing.') : 'Project + images loaded.');
      });
    };
  }

  // ---- toast ------------------------------------------------------------
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
