/* viewer-template.js — single source of truth for how a guide RENDERS.
 *
 * The same rendering functions power three surfaces:
 *   1. Live preview inside the builder (open the built HTML in a blob tab).
 *   2. The exported self-contained HTML viewer (interactive, tap-to-reveal).
 *   3. The print/PDF page (static, hotspots -> numbered callouts).
 *
 * Trick for self-containment without a bundler: the shared pure functions
 * (esc/annMarkup/renderStepText/…) are defined here as normal functions so the
 * builder can call them directly for the static print page, AND their source is
 * captured with Function.toString() and injected into the interactive runtime
 * string. One definition, two execution contexts.
 *
 * Loaded as a classic script -> global `Viewer`.
 */
(function (global) {
  'use strict';

  // ===== shared pure render helpers (also injected into the runtime) =====

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

  // Build the SVG annotation overlay for one image.
  // opts.calloutMode = true -> every annotation with text gets a sequential
  // number badge (print). Returns { svg, callouts:[{num,text,type}] }.
  function annMarkup(image, anns, opts) {
    opts = opts || {};
    anns = anns || [];
    var w = image.w || 1000, h = image.h || 2000;
    function px(p) { return (p / 100 * w).toFixed(2); }
    function py(p) { return (p / 100 * h).toFixed(2); }
    var sw = Math.max(2, w * 0.007);
    var rdot = w * 0.045;
    var defs = '', body = '', callouts = [], counter = 0;

    function badge(cx, cy, n, color) {
      var r = rdot;
      return '<g><circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(2) +
        '" fill="' + color + '" stroke="#fff" stroke-width="' + (r * 0.18).toFixed(2) + '"/>' +
        '<text x="' + cx + '" y="' + cy + '" fill="#fff" font-family="monospace" font-weight="700" font-size="' +
        (r * 1.2).toFixed(2) + '" text-anchor="middle" dominant-baseline="central">' + n + '</text></g>';
    }

    anns.forEach(function (a, i) {
      var hasText = a.text && String(a.text).trim() !== '';
      var num = a.number;
      if (opts.calloutMode && hasText && !num) { num = ++counter; }
      else if (num && num > counter) counter = num;

      if (a.type === 'arrow') {
        var mid = 'ah' + i;
        defs += '<marker id="' + mid + '" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + a.color + '"/></marker>';
        body += '<line x1="' + px(a.x1) + '" y1="' + py(a.y1) + '" x2="' + px(a.x2) + '" y2="' + py(a.y2) +
          '" stroke="' + a.color + '" stroke-width="' + (sw * (a.weight || 1)).toFixed(2) + '" stroke-linecap="round" marker-end="url(#' + mid + ')"/>';
      } else if (a.type === 'box') {
        body += '<rect x="' + px(a.x) + '" y="' + py(a.y) + '" width="' + px(a.w) + '" height="' + py(a.h) +
          '" rx="' + (w * 0.01).toFixed(2) + '" fill="none" stroke="' + a.color + '" stroke-width="' + (sw * (a.weight || 1)).toFixed(2) + '"/>';
      } else if (a.type === 'redact') {
        var fid = 'bl' + i, cid = 'cl' + i;
        defs += '<filter id="' + fid + '"><feGaussianBlur in="SourceGraphic" stdDeviation="' + Math.max(6, w * 0.02).toFixed(2) + '"/></filter>';
        defs += '<clipPath id="' + cid + '"><rect x="' + px(a.x) + '" y="' + py(a.y) + '" width="' + px(a.w) + '" height="' + py(a.h) + '"/></clipPath>';
        body += '<image href="' + image.src + '" x="0" y="0" width="' + w + '" height="' + h + '" filter="url(#' + fid + ')" clip-path="url(#' + cid + ')" preserveAspectRatio="none"/>';
        body += '<rect x="' + px(a.x) + '" y="' + py(a.y) + '" width="' + px(a.w) + '" height="' + py(a.h) + '" fill="none" stroke="#333" stroke-width="' + (sw * 0.5).toFixed(2) + '" stroke-dasharray="' + sw.toFixed(2) + ',' + sw.toFixed(2) + '"/>';
      } else if (a.type === 'hotspot') {
        var hx = px(a.x), hy = py(a.y), hw = px(a.w), hh = py(a.h);
        if (opts.calloutMode) {
          body += '<rect x="' + hx + '" y="' + hy + '" width="' + hw + '" height="' + hh + '" rx="' + (w * 0.01).toFixed(2) + '" fill="' + a.color + '" fill-opacity="0.12" stroke="' + a.color + '" stroke-width="' + sw.toFixed(2) + '"/>';
          body += badge(parseFloat(hx) + parseFloat(hw) - rdot, parseFloat(hy) + rdot, num || (++counter), a.color);
        } else {
          body += '<g class="hs" data-hs="' + i + '" style="cursor:pointer">' +
            '<rect x="' + hx + '" y="' + hy + '" width="' + hw + '" height="' + hh + '" rx="' + (w * 0.01).toFixed(2) + '" fill="' + a.color + '" fill-opacity="0.10" stroke="' + a.color + '" stroke-width="' + sw.toFixed(2) + '"/>' +
            badge(parseFloat(hx) + parseFloat(hw) - rdot, parseFloat(hy) + rdot, num || (i + 1), a.color) + '</g>';
        }
        if (hasText) callouts.push({ num: num || callouts.length + 1, text: a.text, type: 'hotspot', idx: i });
      } else if (a.type === 'dot') {
        body += badge(px(a.x), py(a.y), num || (i + 1), a.color);
        if (hasText) callouts.push({ num: num || callouts.length + 1, text: a.text, type: 'dot', idx: i });
      }
    });

    var svg = '<svg class="ovl" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><defs>' + defs + '</defs>' + body + '</svg>';
    return { svg: svg, callouts: callouts };
  }

  function renderTable(rows, title) {
    if (!rows || !rows.length) return '';
    var out = '<div class="g-table">';
    if (title) out += '<div class="g-table-title">' + esc(title) + '</div>';
    rows.forEach(function (r) {
      var key;
      if (r.kind === 'image' && r.image) key = '<img class="g-keyimg" src="' + esc(r.image) + '" alt="">';
      else if (r.kind === 'icon') key = '<span class="g-icon">' + esc(r.icon || '•') + '</span>';
      else key = '<span class="g-swatch" style="background:' + esc(r.value) + '"></span>';
      out += '<div class="g-trow">' + key + '<span class="g-tdesc">' + nl2br(r.text) + '</span></div>';
    });
    return out + '</div>';
  }

  function renderRefs(refs) {
    if (!refs || !refs.length) return '';
    var out = '<div class="g-refs"><div class="g-label">References</div>';
    refs.forEach(function (r) {
      if (r.kind === 'pdf') {
        var href = r.data || r.href || '';
        out += '<a class="g-ref pdf" href="' + esc(href) + '" target="_blank" rel="noopener" ' +
          (href.indexOf('data:') === 0 ? 'download="' + esc(r.name || 'document.pdf') + '"' : '') +
          '>📄 ' + esc(r.label || r.name || 'PDF') + '</a>';
      } else {
        out += '<a class="g-ref link" href="' + esc(r.href) + '" target="_blank" rel="noopener">🔗 ' + esc(r.label || r.href) + '</a>';
      }
    });
    return out + '</div>';
  }

  // The text portion of a step (everything except the image).
  function renderStepText(step, callouts) {
    var out = '';
    if (step.body) out += '<p class="g-body">' + nl2br(step.body) + '</p>';
    if (step.note) out += '<div class="g-note"><span class="g-tag">Note</span>' + nl2br(step.note) + '</div>';
    if (callouts && callouts.length) {
      out += '<div class="g-callouts"><div class="g-label">Callouts</div>';
      callouts.forEach(function (c) {
        out += '<div class="g-callout"><span class="g-conum">' + c.num + '</span><span>' + nl2br(c.text) + '</span></div>';
      });
      out += '</div>';
    }
    out += renderTable(step.table, step.tableTitle || 'Key');
    if (step.tip) out += '<div class="g-tip"><span class="g-tag">Tip</span>' + nl2br(step.tip) + '</div>';
    out += renderRefs(step.references);
    return out;
  }

  // The image block (image + overlay). calloutMode for print.
  function renderImageBlock(step, calloutMode) {
    if (!step.image || !step.image.src) return { html: '', callouts: [] };
    var m = annMarkup(step.image, step.annotations, { calloutMode: calloutMode });
    var html = '<div class="g-shot"><img src="' + esc(step.image.src) + '" alt="' + esc(step.title) + '">' + m.svg + '</div>';
    return { html: html, callouts: m.callouts };
  }

  // ===== static PRINT page (fully pre-rendered, no runtime) ==============
  var DEVICE_LABELS = { android: 'Android', iphone: 'iPhone', pc: 'Computer' };
  var DEFAULT_LEARN_LABEL = 'Learn more about the options on this screen';

  function buildPrintHTML(project, platform) {
    var track = project.tracks[platform];
    var devName = DEVICE_LABELS[platform] || platform;
    var body = '';
    body += '<header class="p-head"><h1>' + esc(project.title || 'Guide') + '</h1>' +
      '<div class="p-sub">' + esc(devName) + '</div>';
    if (project.description) body += '<p class="p-desc">' + nl2br(project.description) + '</p>';
    body += '</header>';

    var workflow = track.workflow || [];
    var overview = track.overview || [];
    function ovForStep(id) { return overview.filter(function (o) { return (o.linkedStepIds || []).indexOf(id) >= 0; }); }
    function stepNumsForOv(o) {
      return (o.linkedStepIds || []).map(function (id) {
        var ix = workflow.map(function (w) { return w.id; }).indexOf(id);
        return ix >= 0 ? ix + 1 : null;
      }).filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
    }

    // Workflow section (numbered process). Skipped entirely for an overview-only guide.
    if (workflow.length) {
      body += '<h2 class="p-part">Workflow</h2>';
      workflow.forEach(function (step, i) {
        var n = i + 1;
        var img = renderImageBlock(step, true); // print -> numbered callouts
        var ovs = ovForStep(step.id);
        var learn = '';
        if (ovs.length) {
          var titles = ovs.map(function (o) { return '“' + esc(o.title || 'Overview') + '”'; }).join(', ');
          learn = '<div class="p-learn"><span class="g-tag">More</span>Learn more about other options on this screen in the Overview section: ' + titles + '.</div>';
        }
        body += '<section class="p-step">' +
          '<div class="p-step-head"><span class="p-num">' + n + '</span>' +
          '<h2>' + esc(step.title || 'Step ' + n) + '</h2></div>' +
          '<div class="p-step-grid">' +
          '<div class="p-step-img">' + img.html + '</div>' +
          '<div class="p-step-text">' + renderStepText(step, img.callouts) + learn + '</div>' +
          '</div></section>';
      });
    }

    // Overview pages — each on its own page, labeled by title.
    overview.forEach(function (ov, i) {
      var img = renderImageBlock(ov, true);
      var rel = stepNumsForOv(ov);
      var relNote = (workflow.length && rel.length)
        ? '<div class="p-learn"><span class="g-tag">Relates to</span>Step ' + rel.join(', ') + '</div>' : '';
      var brk = (workflow.length || i > 0) ? ' p-pagebreak' : '';
      body += '<section class="p-step p-overview' + brk + '">' +
        '<div class="p-step-head"><span class="p-ovtag">Overview</span>' +
        '<h2>' + esc(ov.title || ('Overview ' + (i + 1))) + '</h2></div>' +
        relNote +
        '<div class="p-step-grid">' +
        '<div class="p-step-img">' + img.html + '</div>' +
        '<div class="p-step-text">' + renderStepText(ov, img.callouts) + '</div>' +
        '</div></section>';
    });

    if (project.ipt && project.ipt.email) {
      body += '<footer class="p-foot">Need help? Contact ' + esc(project.ipt.name || project.ipt.email) +
        ' &lt;' + esc(project.ipt.email) + '&gt;</footer>';
    }

    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(project.title || 'Guide') +
      ' — ' + esc(devName) + '</title><style>' + PRINT_CSS + '</style></head><body class="print">' + body +
      '<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>';
  }

  // ===== interactive self-contained VIEWER ===============================
  // Controller that runs inside the exported file.
  function runViewer() {
    var DATA = window.__GUIDE_DATA__;
    var root = document.getElementById('app');
    var state = { platform: null, idx: 0, multi: false, overviewId: null, returnIdx: 0 };
    var DEV = { android: { label: 'Android', icon: '🤖' }, iphone: { label: 'iPhone', icon: '📱' }, pc: { label: 'Computer', icon: '💻' } };
    var DEFAULT_LEARN = 'Learn more about the options on this screen';

    function track() { return DATA.tracks[state.platform]; }
    function hasSteps(plat) { var t = DATA.tracks[plat]; return !!(t && ((t.workflow || []).length + (t.overview || []).length)); }
    // Main reader flow = workflow steps; an overview-only track is an app "tour".
    function mainFlow() { var t = track(); return (t.workflow && t.workflow.length) ? t.workflow : (t.overview || []); }
    function isTour() { var t = track(); return !(t.workflow && t.workflow.length); }
    function overviewsForStep(id) { var t = track(); return (t.overview || []).filter(function (o) { return (o.linkedStepIds || []).indexOf(id) >= 0; }); }
    function findOverview(id) { var t = track(); return (t.overview || []).filter(function (o) { return o.id === id; })[0]; }
    // Interactive: hotspots are tap-to-reveal, so only DOT text is listed below.
    function dotCallouts(img) { return img.callouts.filter(function (c) { return c.type === 'dot'; }); }

    function devicePicker() {
      var devices = (DATA.devices && DATA.devices.length) ? DATA.devices : ['android', 'iphone'];
      var avail = devices.filter(hasSteps);
      if (!avail.length) avail = devices;
      // Single-device guide: skip the question entirely.
      if (avail.length === 1) { state.platform = avail[0]; state.multi = false; state.idx = 0; renderGuide(); return; }
      var btns = avail.map(function (d) {
        return '<button class="v-dev" data-dev="' + d + '"><span class="v-dev-ic">' + DEV[d].icon + '</span>' + DEV[d].label + '</button>';
      }).join('');
      root.innerHTML =
        '<div class="v-pick"><div class="v-pick-card">' +
        '<div class="v-kicker">Guide</div>' +
        '<h1>' + esc(DATA.title || 'How-to Guide') + '</h1>' +
        (DATA.description ? '<p class="v-desc">' + nl2br(DATA.description) + '</p>' : '') +
        '<div class="v-q">Which device are you using?</div>' +
        '<div class="v-dev-row">' + btns + '</div></div></div>';
      Array.prototype.forEach.call(root.querySelectorAll('.v-dev'), function (b) {
        b.onclick = function () { state.platform = b.getAttribute('data-dev'); state.multi = true; state.idx = 0; renderGuide(); };
      });
    }

    function renderGuide() {
      // If an overview deep-dive is open, render that instead.
      if (state.overviewId) {
        var ov = findOverview(state.overviewId);
        if (ov) { renderOverview(ov); return; }
        state.overviewId = null;
      }
      var seq = mainFlow();
      if (!seq.length) { root.innerHTML = '<div class="v-empty">This guide has no steps yet.</div>'; return; }
      if (state.idx >= seq.length) state.idx = seq.length - 1;
      var step = seq[state.idx];
      var tour = isTour();
      var img = renderImageBlock(step, false);
      var devName = (DEV[state.platform] && DEV[state.platform].label) || state.platform;

      var nav = '<div class="v-progress">';
      for (var i = 0; i < seq.length; i++) nav += '<span class="v-dot' + (i === state.idx ? ' on' : (i < state.idx ? ' done' : '')) + '" data-go="' + i + '"></span>';
      nav += '</div>';

      // workflow mode: a "Learn more" button for each overview attached to this step
      var learn = '';
      if (!tour) {
        overviewsForStep(step.id).forEach(function (o) {
          learn += '<button class="v-learn" data-ov="' + o.id + '"><span class="v-learn-ic">ⓘ</span>' + esc(o.linkLabel || DEFAULT_LEARN) + '</button>';
        });
      }
      var pill = tour ? 'Overview' : 'Step ' + (state.idx + 1);

      root.innerHTML =
        '<div class="v-top">' +
        (state.multi ? '<button class="v-back" data-act="home">‹ ' + esc(devName) + '</button>' : '<span class="v-home-static">' + esc(devName) + '</span>') +
        '<span class="v-title">' + esc(DATA.title || 'Guide') + '</span>' +
        '<span></span>' +
        '</div>' +
        nav +
        '<div class="v-step"><div class="v-step-main">' +
        '<div class="v-info">' +
        '<div class="v-step-head"><span class="v-step-pill' + (tour ? ' overview' : '') + '">' + pill + '</span>' +
        (step.title ? '<h2>' + esc(step.title) + '</h2>' : '<span class="v-headspacer"></span>') +
        '<span class="v-count">' + (tour ? 'Overview · ' : '') + (state.idx + 1) + ' / ' + seq.length + '</span></div>' +
        '<div class="v-text">' + renderStepText(step, dotCallouts(img)) + '</div>' +
        (tour ? '<div class="v-tap-hint">Tap a highlighted area to reveal details</div>' : '') +
        learn +
        '</div>' +
        '<div class="v-img">' + img.html + '</div>' +
        '</div></div>' +
        '<div class="v-controls">' +
        '<button class="v-btn" data-act="prev"' + (state.idx === 0 ? ' disabled' : '') + '>‹ Back</button>' +
        (tour ? '' : '<button class="v-stuck" data-act="stuck">🙋 I\'m stuck</button>') +
        '<button class="v-btn primary" data-act="next"' + (state.idx === seq.length - 1 ? ' disabled' : '') + '>' +
        (state.idx === seq.length - 1 ? 'Done' : 'Next ›') + '</button>' +
        '</div>' +
        '<div class="v-pop" id="v-pop" style="display:none"></div>';

      wireMain(seq, step);
    }

    // Overview deep-dive opened from a workflow step.
    function renderOverview(ov) {
      var img = renderImageBlock(ov, false);
      var backLabel = isTour() ? 'Back' : ('Back to Step ' + (state.returnIdx + 1));
      root.innerHTML =
        '<div class="v-top">' +
        '<button class="v-back" data-act="ovback">‹ ' + esc(backLabel) + '</button>' +
        '<span class="v-title">' + esc(DATA.title || 'Guide') + '</span>' +
        '<span></span>' +
        '</div>' +
        '<div class="v-step"><div class="v-step-main">' +
        '<div class="v-info">' +
        '<div class="v-step-head"><span class="v-step-pill overview">Overview</span>' +
        (ov.title ? '<h2>' + esc(ov.title) + '</h2>' : '<span class="v-headspacer"></span>') +
        '</div>' +
        '<div class="v-text">' + renderStepText(ov, dotCallouts(img)) + '</div>' +
        '<div class="v-tap-hint">Tap a highlighted area to reveal details</div>' +
        '</div>' +
        '<div class="v-img">' + img.html + '</div>' +
        '</div></div>' +
        '<div class="v-pop" id="v-pop" style="display:none"></div>';
      root.querySelector('[data-act=ovback]').onclick = function () { state.overviewId = null; renderGuide(); };
      wireHotspots(ov);
    }

    function wireMain(seq, step) {
      var homeBtn = root.querySelector('[data-act=home]');
      if (homeBtn) homeBtn.onclick = function () { state.platform = null; devicePicker(); };
      var prev = root.querySelector('[data-act=prev]'), next = root.querySelector('[data-act=next]');
      if (prev) prev.onclick = function () { if (state.idx > 0) { state.idx--; renderGuide(); } };
      if (next) next.onclick = function () { if (state.idx < seq.length - 1) { state.idx++; renderGuide(); } };
      Array.prototype.forEach.call(root.querySelectorAll('.v-dot'), function (d) {
        d.onclick = function () { state.idx = parseInt(d.getAttribute('data-go'), 10); renderGuide(); };
      });
      var stuck = root.querySelector('[data-act=stuck]');
      if (stuck) stuck.onclick = function () { imStuck(step); };
      Array.prototype.forEach.call(root.querySelectorAll('.v-learn'), function (b) {
        b.onclick = function () { state.returnIdx = state.idx; state.overviewId = b.getAttribute('data-ov'); renderGuide(); };
      });
      wireHotspots(step);
    }

    // hotspot reveal (tap on touch, hover on desktop)
    function wireHotspots(step) {
      var pop = document.getElementById('v-pop');
      Array.prototype.forEach.call(root.querySelectorAll('.hs'), function (g) {
        var idx = g.getAttribute('data-hs');
        var a = step.annotations[idx];
        function show() {
          if (!a || !a.text) return;
          pop.innerHTML = '<span class="v-pop-close">×</span>' + nl2br(a.text);
          pop.style.display = 'block';
          pop.querySelector('.v-pop-close').onclick = function () { pop.style.display = 'none'; };
        }
        g.addEventListener('click', show);
        g.addEventListener('mouseenter', function () { if (matchMedia('(hover:hover)').matches) show(); });
      });
    }

    function imStuck(step) {
      var email = (DATA.ipt && DATA.ipt.email) || '';
      var devName = (DEV[state.platform] && DEV[state.platform].label) || state.platform;
      var stepLabel = 'Step ' + (state.idx + 1) + (step.title ? ': ' + step.title : '');
      var subject = 'Help: ' + (DATA.title || 'Guide') + ' (' + devName + ')';
      var body = "I'm stuck on " + stepLabel + ".\n\nGuide: " + (DATA.title || '') +
        "\nDevice: " + devName + "\n\n(Describe what you're seeing here.)";
      if (!email) { alert('No support contact was configured for this guide.'); return; }
      window.location.href = 'mailto:' + encodeURIComponent(email) +
        '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    }

    devicePicker();
  }

  // ===== assemble the interactive HTML ===================================
  // Capture shared function sources so the runtime is self-contained.
  var SHARED_SRC = [esc, nl2br, annMarkup, renderTable, renderRefs, renderStepText, renderImageBlock]
    .map(function (f) { return f.toString(); }).join('\n\n');
  var RUNTIME_SRC = SHARED_SRC + '\n\n(' + runViewer.toString() + ')();';

  function buildViewerHTML(project, opts) {
    opts = opts || {};
    var data = JSON.stringify(project)
      .replace(/<\//g, '<\\/'); // guard against </script> in data
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">' +
      '<title>' + esc(project.title || 'How-to Guide') + '</title>' +
      '<style>' + VIEWER_CSS + '</style></head><body>' +
      '<div id="app"></div>' +
      '<script>window.__GUIDE_DATA__=' + data + ';<\/script>' +
      '<script>' + RUNTIME_SRC + '<\/script>' +
      '</body></html>';
  }

  // ===== stylesheets =====================================================
  var VIEWER_CSS = [
    ':root{--paper:#f7f4ea;--ink:#1b2733;--ink-soft:#44525f;--red:#c0392b;--panel:#fffdf6;--line:#d8cdb5;--mono:"JetBrains Mono",Consolas,monospace}',
    '*{box-sizing:border-box}html,body{margin:0;height:100%}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--paper);background-image:linear-gradient(#e3e9f0 1px,transparent 1px),linear-gradient(90deg,#e3e9f0 1px,transparent 1px);background-size:22px 22px}',
    '#app{max-width:560px;margin:0 auto;min-height:100%;background:rgba(255,253,246,.6)}',
    '.v-pick{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}',
    '.v-pick-card{background:var(--panel);border:2px solid var(--ink);border-radius:8px;box-shadow:5px 5px 0 rgba(27,39,51,.15);padding:28px;max-width:440px;width:100%;text-align:center}',
    '.v-kicker{font-family:var(--mono);font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:var(--red)}',
    '.v-pick-card h1{margin:6px 0 10px;font-size:24px}.v-desc{color:var(--ink-soft);font-size:14px}',
    '.v-q{font-family:var(--mono);margin:22px 0 12px;font-weight:700}',
    '.v-dev-row{display:flex;gap:12px;flex-wrap:wrap}',
    '.v-dev{flex:1;min-width:120px;font-family:var(--mono);font-size:15px;padding:18px 10px;border:2px solid var(--ink);border-radius:6px;background:#fff;cursor:pointer;box-shadow:2px 2px 0 rgba(27,39,51,.15);display:flex;flex-direction:column;gap:8px;align-items:center}',
    '.v-dev:hover{background:var(--red);color:#fff;border-color:#8c271b}.v-dev-ic{font-size:30px}',
    '.v-top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--ink);color:var(--paper);padding:10px 14px;border-bottom:3px solid var(--red)}',
    '.v-top .v-title{font-family:var(--mono);font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.v-back{font-family:var(--mono);font-size:12px;background:transparent;border:1px solid rgba(255,255,255,.4);color:var(--paper);padding:5px 9px;border-radius:4px;cursor:pointer}',
    '.v-home-static{font-family:var(--mono);font-size:12px;color:rgba(255,255,255,.7);padding:5px 2px}',
    '.v-progress{display:flex;gap:6px;flex-wrap:wrap;padding:12px 16px 4px;justify-content:center}',
    '.v-dot{width:9px;height:9px;border-radius:50%;background:#cdd6e0;cursor:pointer}.v-dot.on{background:var(--red);transform:scale(1.3)}.v-dot.done{background:var(--ink-soft)}',
    '.v-step{padding:8px 18px 18px}',
    '.v-step-main{display:flex;flex-direction:column;gap:16px}',
    '.v-info{min-width:0}',
    '.v-img{min-width:0}',
    '.v-step-head{display:flex;align-items:center;gap:10px;margin:8px 0 14px}',
    '.v-step-pill{font-family:var(--mono);font-weight:700;font-size:12px;color:#fff;background:var(--red);padding:4px 12px;border-radius:999px;flex-shrink:0;letter-spacing:.02em}',
    '.v-step-pill.overview{background:#2c5aa0}',
    '.v-learn{display:flex;align-items:center;gap:9px;width:100%;text-align:left;margin:14px 0 0;padding:12px 14px;border:1.5px solid #2c5aa0;border-radius:9px;background:#eef2f8;color:#1f3c66;font-size:14px;font-weight:600;cursor:pointer}',
    '.v-learn:hover{background:#2c5aa0;color:#fff}',
    '.v-learn-ic{font-size:18px;flex-shrink:0}',
    '.v-headspacer{flex:1}',
    '.v-step-head h2{font-size:18px;flex:1;margin:0}.v-count{font-family:var(--mono);font-size:11px;color:var(--ink-soft);flex-shrink:0}',
    '@media(min-width:780px){#app{max-width:960px}.v-step-main{flex-direction:row-reverse;align-items:flex-start;gap:30px}.v-img{flex:0 0 300px;max-width:300px;position:sticky;top:72px}.v-info{flex:1}.v-step{padding:14px 28px 24px}}',
    '.g-shot{position:relative;background:#fff;border:1.5px solid var(--line);box-shadow:3px 3px 0 rgba(27,39,51,.12);line-height:0;border-radius:4px;overflow:hidden}',
    '.g-shot img{display:block;width:100%;height:auto}.g-shot .ovl{position:absolute;inset:0;width:100%;height:100%}',
    '.v-text,.p-step-text{font-size:15px;line-height:1.55}.g-body{margin:14px 0}',
    '.g-note,.g-tip{border-left:4px solid var(--red);background:#fdf0ee;padding:10px 12px;border-radius:4px;margin:12px 0;font-size:14px}',
    '.g-tip{border-left-color:var(--green,#2e7d32);background:#eef6ee}',
    '.g-tag{display:inline-block;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--red);margin-right:8px;font-weight:700}',
    '.g-tip .g-tag{color:#2e7d32}',
    '.g-label{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft);margin:14px 0 6px}',
    '.g-table{border:1.5px solid var(--line);border-radius:4px;overflow:hidden;margin:12px 0;background:#fff}',
    '.g-table-title{font-family:var(--mono);font-size:11px;background:var(--ink);color:var(--paper);padding:5px 10px}',
    '.g-trow{display:flex;gap:10px;align-items:center;padding:8px 10px;border-top:1px solid #eee}.g-trow:first-of-type{border-top:none}',
    '.g-swatch{width:22px;height:22px;border-radius:4px;border:1px solid var(--ink);flex-shrink:0}.g-icon{font-size:20px;width:22px;text-align:center;flex-shrink:0}',
    '.g-keyimg{height:30px;max-width:80px;width:auto;object-fit:contain;border:1px solid var(--line);border-radius:3px;background:#fff;flex-shrink:0}',
    '.g-tdesc{font-size:14px}',
    '.g-callouts{margin:12px 0}.g-callout{display:flex;gap:10px;align-items:flex-start;margin:6px 0;font-size:14px}',
    '.g-conum{font-family:var(--mono);font-weight:700;background:var(--ink);color:#fff;min-width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}',
    '.g-refs{margin:14px 0}.g-ref{display:inline-flex;gap:6px;align-items:center;font-size:13px;padding:6px 10px;border:1.5px solid var(--line);border-radius:4px;margin:0 6px 6px 0;text-decoration:none;color:var(--ink);background:#fff}',
    '.g-ref:hover{border-color:var(--red);color:var(--red)}',
    '.v-tap-hint{font-family:var(--mono);font-size:11px;color:var(--ink-soft);text-align:center;margin-top:10px}',
    '.v-controls{position:sticky;bottom:0;display:flex;gap:8px;padding:12px 16px;background:var(--panel);border-top:2px solid var(--line)}',
    '.v-btn{flex:1;font-family:var(--mono);font-size:14px;padding:12px;border:1.5px solid var(--ink);border-radius:5px;background:#fff;cursor:pointer}',
    '.v-btn.primary{background:var(--red);color:#fff;border-color:#8c271b}.v-btn[disabled]{opacity:.4}',
    '.v-stuck{font-family:var(--mono);font-size:13px;padding:12px;border:1.5px dashed var(--red);border-radius:5px;background:#fff;color:var(--red);cursor:pointer}',
    '.v-pop{position:fixed;left:50%;bottom:80px;transform:translateX(-50%);max-width:440px;width:calc(100% - 32px);background:var(--ink);color:var(--paper);padding:16px 18px;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.4);z-index:20;font-size:15px;line-height:1.5}',
    '.v-pop-close{position:absolute;top:6px;right:12px;cursor:pointer;font-size:22px;color:#fff;opacity:.7}',
    '.v-empty{padding:60px 20px;text-align:center;font-family:var(--mono);color:var(--ink-soft)}',
    '.hs{transition:opacity .15s}'
  ].join('\n');

  var PRINT_CSS = [
    ':root{--ink:#1b2733;--ink-soft:#44525f;--red:#c0392b;--line:#cbd3dc}',
    '*{box-sizing:border-box}body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);font-size:12pt;line-height:1.5}',
    '.print{max-width:760px;margin:0 auto;padding:24px}',
    '.p-head h1{font-size:24pt;margin:0}.p-sub{font-family:monospace;color:var(--red);letter-spacing:.06em;margin:4px 0 10px}',
    '.p-desc{color:var(--ink-soft)}',
    '.p-step{margin:18px 0;page-break-inside:avoid}',
    '.p-step-head{display:flex;align-items:center;gap:10px;border-bottom:2px solid var(--ink);padding-bottom:6px;margin-bottom:12px}',
    '.p-num{font-family:monospace;font-weight:700;background:var(--red);color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center}',
    '.p-step-head h2{font-size:15pt;margin:0}',
    '.p-step-grid{display:grid;grid-template-columns:240px 1fr;gap:20px;align-items:start}',
    '.p-step-img .g-shot{position:relative;line-height:0;border:1px solid var(--line)}.p-step-img img{width:100%;display:block}.p-step-img .ovl{position:absolute;inset:0;width:100%;height:100%}',
    '.g-note,.g-tip{border-left:4px solid var(--red);background:#f7eeec;padding:8px 10px;margin:8px 0;font-size:11pt}',
    '.g-tip{border-left-color:#2e7d32;background:#eef6ee}',
    '.g-tag{font-family:monospace;font-size:8pt;text-transform:uppercase;color:var(--red);font-weight:700;margin-right:6px}',
    '.g-label{font-family:monospace;font-size:8pt;text-transform:uppercase;color:var(--ink-soft);margin:10px 0 4px}',
    '.g-table{border:1px solid var(--line);margin:8px 0}.g-table-title{background:var(--ink);color:#fff;font-family:monospace;font-size:9pt;padding:3px 8px}',
    '.g-trow{display:flex;gap:8px;align-items:center;padding:5px 8px;border-top:1px solid #eee}',
    '.g-swatch{width:18px;height:18px;border:1px solid var(--ink);border-radius:3px}.g-icon{width:18px;text-align:center}',
    '.g-keyimg{height:26px;max-width:70px;width:auto;object-fit:contain;border:1px solid var(--line)}',
    '.p-part{font-family:monospace;font-size:13pt;color:var(--red);border-bottom:2px solid var(--red);padding-bottom:3px;margin:22px 0 6px;letter-spacing:.05em}',
    '.p-pagebreak{page-break-before:always}',
    '.p-ovtag{font-family:monospace;font-size:9pt;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:#2c5aa0;padding:3px 11px;border-radius:999px}',
    '.p-learn{border-left:4px solid #2c5aa0;background:#eef2f8;padding:7px 10px;margin:8px 0;font-size:10.5pt}',
    '.p-learn .g-tag{color:#2c5aa0}',
    '.g-callout{display:flex;gap:8px;margin:4px 0;font-size:11pt}.g-conum{font-family:monospace;font-weight:700;background:var(--ink);color:#fff;min-width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10pt}',
    '.g-refs{margin:8px 0}.g-ref{display:inline-block;font-size:10pt;margin-right:10px;color:var(--ink)}',
    '.p-foot{margin-top:24px;border-top:1px solid var(--line);padding-top:10px;font-size:10pt;color:var(--ink-soft)}',
    '@media print{.p-step{page-break-inside:avoid}}'
  ].join('\n');

  global.Viewer = {
    buildViewerHTML: buildViewerHTML,
    buildPrintHTML: buildPrintHTML,
    esc: esc,
    VIEWER_CSS: VIEWER_CSS
  };
})(typeof window !== 'undefined' ? window : this);
