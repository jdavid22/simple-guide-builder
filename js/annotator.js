/* annotator.js — interactive SVG annotation editor for one step's screenshot.
 *
 * Geometry contract: annotations are stored as PERCENTAGES (0..100) of the image
 * in the model. The SVG uses a viewBox of the image's natural pixel size so that
 * scaling is uniform (circles stay circular, blur looks right). Pointer events are
 * converted straight to percentages via the SVG's bounding rect, so the viewBox
 * units never leak into the model.
 *
 * Rendering is split so a drag is cheap: the <img> and <svg> scaffold persist,
 * the screenshot src is only swapped when it actually changes, and during a
 * drag only the moving annotation's <g> is rebuilt (coalesced per animation
 * frame). A full rebuild happens on pointer-up / selection / create.
 *
 * Tools: select | arrow | box | hotspot | dot | redact
 * Loaded as a classic script -> global `Annotator`.
 */
(function (global) {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var XLINK = 'http://www.w3.org/1999/xlink';
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  function el(name, attrs) {
    var e = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function Annotator(stageEl, opts) {
    this.stage = stageEl;
    this.opts = opts;                 // { getStep, getTool, getColor, onChange, onSelect }
    this.selectedId = null;
    this.drag = null;                 // active drag state
    this._img = null;                 // persistent <img class="shot">
    this._imgSrc = null;              // src currently applied to it
    this.svg = null; this._defs = null;
    this._nodes = {};                 // annId -> <g>
    this._raf = 0; this._lastPointer = null;
    this._bound = this._onPointerDown.bind(this);
    this.stage.addEventListener('pointerdown', this._bound);
  }

  Annotator.prototype.step = function () { return this.opts.getStep(); };

  // strokeW / radius scale with image width so they look consistent across
  // screenshots of different resolutions.
  Annotator.prototype._unit = function () {
    var img = this.step() && this.step().image;
    return img ? img.w : 1000;
  };

  Annotator.prototype.setSelected = function (id) {
    this.selectedId = id;
    this.render();
    if (this.opts.onSelect) this.opts.onSelect(id);
  };

  // ---- Rendering ---------------------------------------------------------
  // Full render: scaffold + image sync + rebuild every annotation.
  Annotator.prototype.render = function () {
    var step = this.step();
    if (!this._ensureScaffold(step)) return;
    this._syncImage(step);
    this._rebuildAnnotations(step);
  };

  Annotator.prototype._ensureScaffold = function (step) {
    var stage = this.stage;
    if (!step || !step.image || !step.image.src) {
      stage.classList.add('empty');
      stage.innerHTML = '<div>Drop a screenshot here<br><span style="font-size:11px">or use “Add screenshots”</span></div>';
      this._img = null; this._imgSrc = null; this.svg = null; this._defs = null; this._nodes = {};
      return false;
    }
    stage.classList.remove('empty');
    if (!this._img || this._img.parentNode !== stage) {
      stage.innerHTML = '';
      var img = document.createElement('img');
      img.className = 'shot';
      stage.appendChild(img);
      var svg = el('svg', { class: 'overlay', preserveAspectRatio: 'xMidYMid meet' });
      var defs = el('defs');
      svg.appendChild(defs);
      stage.appendChild(svg);
      this._img = img; this.svg = svg; this._defs = defs; this._imgSrc = null; this._nodes = {};
    }
    return true;
  };

  // Only touch the (expensive) image src when it really changed.
  Annotator.prototype._syncImage = function (step) {
    var im = step.image;
    if (im.src !== this._imgSrc) { this._img.src = im.src; this._imgSrc = im.src; }
    this._img.alt = step.title || 'screenshot';
    var vb = '0 0 ' + (im.w || 1000) + ' ' + (im.h || 2000);
    if (this.svg.getAttribute('viewBox') !== vb) this.svg.setAttribute('viewBox', vb);
  };

  Annotator.prototype._rebuildAnnotations = function (step) {
    var svg = this.svg, defs = this._defs;
    defs.textContent = '';
    Array.prototype.slice.call(svg.childNodes).forEach(function (n) { if (n !== defs) svg.removeChild(n); });
    this._nodes = {};
    var self = this;
    (step.annotations || []).forEach(function (a) { svg.appendChild(self._buildAnnotation(a)); });
  };

  // Partial render: replace one annotation's <g> (and its defs) in place.
  Annotator.prototype.renderAnnotation = function (id) {
    var a = this._find(id);
    if (!a || !this.svg) { this.render(); return; }
    var defs = this._defs;
    Array.prototype.slice.call(defs.children).forEach(function (n) {
      if (n.getAttribute('data-ann-def') === id) defs.removeChild(n);
    });
    var old = this._nodes[id];
    var g = this._buildAnnotation(a, old);
    if (old && old.parentNode === this.svg) this.svg.replaceChild(g, old);
    else this.svg.appendChild(g);
  };

  // Builds (and registers) the <g> for one annotation. reuseG lets a redact
  // keep its decoded <image> across drag frames.
  Annotator.prototype._buildAnnotation = function (a, reuseG) {
    var w = this._unit(), h = this.step().image.h || (w * 2);
    var px = function (p) { return p / 100 * w; };
    var py = function (p) { return p / 100 * h; };
    var sel = (a.id === this.selectedId);
    var sw = Math.max(2, w * 0.007);
    var g = el('g', { 'data-ann': a.id, style: 'cursor:pointer' });
    var defs = this._defs;

    if (a.type === 'arrow') {
      var headId = 'ah_' + a.id;
      var marker = el('marker', {
        id: headId, viewBox: '0 0 10 10', refX: '7', refY: '5',
        markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse', 'data-ann-def': a.id
      });
      marker.appendChild(el('path', { d: 'M0,0 L10,5 L0,10 z', fill: a.color }));
      defs.appendChild(marker);
      g.appendChild(el('line', {
        x1: px(a.x1), y1: py(a.y1), x2: px(a.x2), y2: py(a.y2),
        stroke: a.color, 'stroke-width': sw * (a.weight || 1), 'stroke-linecap': 'round',
        'marker-end': 'url(#' + headId + ')'
      }));
      if (sel) {
        g.appendChild(this._handle(px(a.x1), py(a.y1), 'p1', w));
        g.appendChild(this._handle(px(a.x2), py(a.y2), 'p2', w));
      }
    } else if (a.type === 'box' || a.type === 'hotspot' || a.type === 'redact') {
      var x = px(a.x), y = py(a.y), bw = px(a.w), bh = py(a.h);
      if (a.type === 'redact') {
        // Blur the actual underlying screenshot inside this rect. The filter
        // region is scoped to the rect so the blur isn't computed over the
        // whole screenshot on every frame.
        var fid = 'blur_' + a.id, cid = 'clip_' + a.id;
        var std = Math.max(6, w * 0.02), m = std * 3;
        var f = el('filter', {
          id: fid, 'data-ann-def': a.id, filterUnits: 'userSpaceOnUse',
          x: Math.max(0, x - m), y: Math.max(0, y - m), width: bw + 2 * m, height: bh + 2 * m
        });
        f.appendChild(el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: std }));
        defs.appendChild(f);
        var clip = el('clipPath', { id: cid, 'data-ann-def': a.id });
        clip.appendChild(el('rect', { x: x, y: y, width: bw, height: bh }));
        defs.appendChild(clip);
        var im = reuseG && reuseG.querySelector('image');
        if (!im) {
          im = el('image', { x: 0, y: 0, width: w, height: h });
          im.setAttributeNS(XLINK, 'href', this.step().image.src);
          im.setAttribute('href', this.step().image.src);
        }
        im.setAttribute('filter', 'url(#' + fid + ')');
        im.setAttribute('clip-path', 'url(#' + cid + ')');
        g.appendChild(im);
        g.appendChild(el('rect', { x: x, y: y, width: bw, height: bh, fill: 'none', stroke: '#333', 'stroke-width': sw * 0.5, 'stroke-dasharray': sw + ',' + sw }));
      } else {
        var fill = a.type === 'hotspot' ? a.color : 'none';
        var op = a.type === 'hotspot' ? '0.14' : '1';
        g.appendChild(el('rect', {
          x: x, y: y, width: bw, height: bh, rx: w * 0.01,
          fill: fill, 'fill-opacity': op, stroke: a.color, 'stroke-width': sw * (a.weight || 1)
        }));
        if (a.type === 'hotspot' && a.number) {
          g.appendChild(this._numBadge(x + bw - sw, y + sw, a.number, a.color, w));
        }
      }
      if (sel) {
        g.appendChild(this._handle(x, y, 'nw', w));
        g.appendChild(this._handle(x + bw, y, 'ne', w));
        g.appendChild(this._handle(x, y + bh, 'sw', w));
        g.appendChild(this._handle(x + bw, y + bh, 'se', w));
      }
    } else if (a.type === 'dot') {
      var r = w * 0.045;
      g.appendChild(this._numBadge(px(a.x), py(a.y), a.number || '?', a.color, w, true));
      if (sel) g.appendChild(this._handle(px(a.x), py(a.y) - r, 'move', w));
    }

    if (sel) g.setAttribute('class', 'ann-selected');
    this._nodes[a.id] = g;
    return g;
  };

  Annotator.prototype._numBadge = function (cx, cy, n, color, w) {
    var r = w * 0.045;
    var g = el('g', {});
    g.appendChild(el('circle', { cx: cx, cy: cy, r: r, fill: color, stroke: '#fff', 'stroke-width': r * 0.18 }));
    var t = el('text', {
      x: cx, y: cy, fill: '#fff', 'font-family': 'monospace', 'font-weight': '700',
      'font-size': r * 1.2, 'text-anchor': 'middle', 'dominant-baseline': 'central'
    });
    t.textContent = String(n);
    g.appendChild(t);
    return g;
  };

  Annotator.prototype._handle = function (cx, cy, role, w) {
    var r = Math.max(5, w * 0.018);
    return el('circle', { cx: cx, cy: cy, r: r, class: 'handle', 'data-handle': role });
  };

  // ---- Pointer interaction ----------------------------------------------
  // Works for any object with clientX/clientY (events or cached points).
  Annotator.prototype._toPct = function (pt) {
    var rect = this.svg.getBoundingClientRect();
    return {
      x: clamp((pt.clientX - rect.left) / rect.width * 100, 0, 100),
      y: clamp((pt.clientY - rect.top) / rect.height * 100, 0, 100)
    };
  };

  Annotator.prototype._onPointerDown = function (evt) {
    var step = this.step();
    if (!step || !step.image || !this.svg) return;
    var tool = this.opts.getTool();
    var color = this.opts.getColor();
    var p = this._toPct(evt);
    var target = evt.target;
    var handleRole = target.getAttribute && target.getAttribute('data-handle');
    var annNode = target.closest ? target.closest('[data-ann]') : null;
    var annId = annNode && annNode.getAttribute('data-ann');

    if (tool === 'select' || handleRole) {
      if (handleRole) { this._beginHandleDrag(evt, handleRole); return; }
      if (annId) { this.setSelected(annId); this._beginMoveDrag(evt, annId); return; }
      this.setSelected(null);
      return;
    }
    // Drawing tools create a new annotation.
    this._createAnnotation(tool, color, p, evt);
  };

  Annotator.prototype._nextNumber = function (kind) {
    var anns = this.step().annotations || [];
    var max = 0;
    anns.forEach(function (a) { if (a.type === kind && a.number > max) max = a.number; });
    return max + 1;
  };

  Annotator.prototype._createAnnotation = function (tool, color, p, evt) {
    var a;
    if (tool === 'arrow') {
      a = global.Model.newAnnotation('arrow', { x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: color });
    } else if (tool === 'dot') {
      a = global.Model.newAnnotation('dot', { x: p.x, y: p.y, color: color, number: this._nextNumber('dot') });
    } else { // box, hotspot, redact
      a = global.Model.newAnnotation(tool, { x: p.x, y: p.y, w: 0.1, h: 0.1, color: color });
      if (tool === 'hotspot') a.number = this._nextNumber('hotspot');
    }
    this.step().annotations.push(a);
    this.selectedId = a.id;
    this.render();
    this._emit();

    if (tool === 'dot') { if (this.opts.onSelect) this.opts.onSelect(a.id); return; }
    // immediately enter a sizing drag
    if (tool === 'arrow') this._beginHandleDrag(evt, 'p2', a.id);
    else this._beginHandleDrag(evt, 'se', a.id);
  };

  Annotator.prototype._beginMoveDrag = function (evt, annId) {
    var a = this._find(annId);
    if (!a) return;
    var start = this._toPct(evt);
    this.drag = { kind: 'move', a: a, start: start, orig: JSON.parse(JSON.stringify(a)) };
    this._attachMove();
  };

  Annotator.prototype._beginHandleDrag = function (evt, role, annId) {
    var a = this._find(annId || this.selectedId);
    if (!a) return;
    this.drag = { kind: 'handle', role: role, a: a };
    this._attachMove();
  };

  Annotator.prototype._attachMove = function () {
    var self = this;
    this._move = function (e) { self._onMove(e); };
    this._up = function (e) { self._onUp(e); };
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._up);
  };

  // Coalesce pointermoves into one partial render per animation frame.
  Annotator.prototype._onMove = function (evt) {
    if (!this.drag) return;
    this._lastPointer = { clientX: evt.clientX, clientY: evt.clientY };
    if (this._raf) return;
    var self = this;
    this._raf = requestAnimationFrame(function () {
      self._raf = 0;
      if (!self.drag) return;
      self._applyPointer(self._lastPointer);
      self.renderAnnotation(self.drag.a.id);
    });
  };

  Annotator.prototype._applyPointer = function (pt) {
    var p = this._toPct(pt);
    var a = this.drag.a;
    if (this.drag.kind === 'handle') {
      this._applyHandle(a, this.drag.role, p);
    } else if (this.drag.kind === 'move') {
      var dx = p.x - this.drag.start.x, dy = p.y - this.drag.start.y;
      var o = this.drag.orig;
      if (a.type === 'arrow') {
        a.x1 = clamp(o.x1 + dx, 0, 100); a.y1 = clamp(o.y1 + dy, 0, 100);
        a.x2 = clamp(o.x2 + dx, 0, 100); a.y2 = clamp(o.y2 + dy, 0, 100);
      } else if (a.type === 'dot') {
        a.x = clamp(o.x + dx, 0, 100); a.y = clamp(o.y + dy, 0, 100);
      } else {
        a.x = clamp(o.x + dx, 0, 100 - a.w); a.y = clamp(o.y + dy, 0, 100 - a.h);
      }
    }
  };

  Annotator.prototype._applyHandle = function (a, role, p) {
    if (a.type === 'arrow') {
      if (role === 'p1') { a.x1 = p.x; a.y1 = p.y; }
      else { a.x2 = p.x; a.y2 = p.y; }
      return;
    }
    if (a.type === 'dot') { a.x = p.x; a.y = p.y; return; }
    // rectangle-like: keep opposite corner fixed
    var x1 = a.x, y1 = a.y, x2 = a.x + a.w, y2 = a.y + a.h;
    if (role.indexOf('w') >= 0) x1 = p.x;
    if (role.indexOf('e') >= 0) x2 = p.x;
    if (role.indexOf('n') >= 0) y1 = p.y;
    if (role.indexOf('s') >= 0) y2 = p.y;
    if (role === 'se') { x2 = p.x; y2 = p.y; }
    a.x = Math.min(x1, x2); a.y = Math.min(y1, y2);
    a.w = Math.max(1, Math.abs(x2 - x1)); a.h = Math.max(1, Math.abs(y2 - y1));
  };

  Annotator.prototype._onUp = function () {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    if (this.drag && this._lastPointer) this._applyPointer(this._lastPointer);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('pointercancel', this._up);
    this.drag = null; this._lastPointer = null;
    this.render();
    this._emit();
    if (this.opts.onSelect) this.opts.onSelect(this.selectedId);
  };

  // Keyboard: move the selected annotation by (dx, dy) percent, preserving shape.
  Annotator.prototype.nudgeSelected = function (dx, dy) {
    var a = this.selectedId && this._find(this.selectedId);
    if (!a) return false;
    if (a.type === 'arrow') {
      var minX = Math.min(a.x1, a.x2), maxX = Math.max(a.x1, a.x2);
      var minY = Math.min(a.y1, a.y2), maxY = Math.max(a.y1, a.y2);
      dx = clamp(dx, -minX, 100 - maxX); dy = clamp(dy, -minY, 100 - maxY);
      a.x1 += dx; a.x2 += dx; a.y1 += dy; a.y2 += dy;
    } else if (a.type === 'dot') {
      a.x = clamp(a.x + dx, 0, 100); a.y = clamp(a.y + dy, 0, 100);
    } else {
      a.x = clamp(a.x + dx, 0, 100 - a.w); a.y = clamp(a.y + dy, 0, 100 - a.h);
    }
    this.renderAnnotation(a.id);
    this._emit();
    return true;
  };

  Annotator.prototype._find = function (id) {
    var step = this.step();
    return step ? (step.annotations || []).filter(function (a) { return a.id === id; })[0] : null;
  };

  Annotator.prototype.deleteSelected = function () {
    if (!this.selectedId) return;
    var step = this.step();
    if (!step) { this.selectedId = null; return; }   // stale selection after New/Load
    step.annotations = step.annotations.filter(function (a) { return a.id !== this.selectedId; }, this);
    this.selectedId = null;
    this.render();
    this._emit();
  };

  Annotator.prototype._emit = function () { if (this.opts.onChange) this.opts.onChange(); };

  global.Annotator = Annotator;
})(typeof window !== 'undefined' ? window : this);
