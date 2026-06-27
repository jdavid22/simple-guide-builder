/* annotator.js — interactive SVG annotation editor for one step's screenshot.
 *
 * Geometry contract: annotations are stored as PERCENTAGES (0..100) of the image
 * in the model. The SVG uses a viewBox of the image's natural pixel size so that
 * scaling is uniform (circles stay circular, blur looks right). Pointer events are
 * converted straight to percentages via the SVG's bounding rect, so the viewBox
 * units never leak into the model.
 *
 * Tools: select | arrow | box | hotspot | dot | redact
 * Loaded as a classic script -> global `Annotator`.
 */
(function (global) {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
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
    this._bound = this._onPointerDown.bind(this);
    this.stage.addEventListener('pointerdown', this._bound);
    var self = this;
    if (global.ResizeObserver) {
      this._ro = new ResizeObserver(function () { self._reposition(); });
    }
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
  Annotator.prototype.render = function () {
    var step = this.step();
    var stage = this.stage;
    stage.innerHTML = '';
    if (!step || !step.image || !step.image.src) {
      stage.classList.add('empty');
      stage.innerHTML = '<div>Drop a screenshot here<br><span style="font-size:11px">or use “Add screenshots”</span></div>';
      return;
    }
    stage.classList.remove('empty');

    var img = document.createElement('img');
    img.className = 'shot';
    img.src = step.image.src;
    img.alt = step.title || 'screenshot';
    stage.appendChild(img);

    var w = step.image.w || 1000, h = step.image.h || 2000;
    var svg = el('svg', { class: 'overlay', viewBox: '0 0 ' + w + ' ' + h, preserveAspectRatio: 'xMidYMid meet' });
    this.svg = svg;
    var defs = el('defs');
    svg.appendChild(defs);
    this._defs = defs;

    var self = this;
    (step.annotations || []).forEach(function (a) { self._drawAnnotation(svg, a); });
    stage.appendChild(svg);

    if (this._ro) { this._ro.disconnect(); this._ro.observe(stage); }
  };

  Annotator.prototype._reposition = function () { /* SVG is responsive via viewBox; nothing needed */ };

  Annotator.prototype._drawAnnotation = function (svg, a) {
    var w = this._unit(), h = this.step().image.h || (w * 2);
    var px = function (p) { return p / 100 * w; };
    var py = function (p) { return p / 100 * h; };
    var sel = (a.id === this.selectedId);
    var sw = Math.max(2, w * 0.007);
    var g = el('g', { 'data-ann': a.id, style: 'cursor:pointer' });

    if (a.type === 'arrow') {
      var headId = 'ah_' + a.id;
      var marker = el('marker', {
        id: headId, viewBox: '0 0 10 10', refX: '7', refY: '5',
        markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse'
      });
      marker.appendChild(el('path', { d: 'M0,0 L10,5 L0,10 z', fill: a.color }));
      this._defs.appendChild(marker);
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
        // Blur the actual underlying screenshot inside this rect.
        var fid = 'blur_' + a.id, cid = 'clip_' + a.id;
        var f = el('filter', { id: fid });
        f.appendChild(el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: Math.max(6, w * 0.02) }));
        this._defs.appendChild(f);
        var clip = el('clipPath', { id: cid });
        clip.appendChild(el('rect', { x: x, y: y, width: bw, height: bh }));
        this._defs.appendChild(clip);
        var im = el('image', { x: 0, y: 0, width: w, height: h, filter: 'url(#' + fid + ')', 'clip-path': 'url(#' + cid + ')' });
        im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', this.step().image.src);
        im.setAttribute('href', this.step().image.src);
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
    svg.appendChild(g);
  };

  Annotator.prototype._numBadge = function (cx, cy, n, color, w, centered) {
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
    var c = el('circle', { cx: cx, cy: cy, r: r, class: 'handle', 'data-handle': role });
    return c;
  };

  // ---- Pointer interaction ----------------------------------------------
  Annotator.prototype._toPct = function (evt) {
    var rect = this.svg.getBoundingClientRect();
    // account for letterboxing from preserveAspectRatio meet (image fills width here, so rect matches image)
    return {
      x: clamp((evt.clientX - rect.left) / rect.width * 100, 0, 100),
      y: clamp((evt.clientY - rect.top) / rect.height * 100, 0, 100)
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
      if (handleRole) {
        this._beginHandleDrag(evt, handleRole);
        return;
      }
      if (annId) {
        this.setSelected(annId);
        this._beginMoveDrag(evt, annId);
        return;
      }
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
  };

  Annotator.prototype._onMove = function (evt) {
    if (!this.drag) return;
    var p = this._toPct(evt);
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
    this.render();
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
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    this.drag = null;
    this._emit();
    if (this.opts.onSelect) this.opts.onSelect(this.selectedId);
  };

  Annotator.prototype._find = function (id) {
    return (this.step().annotations || []).filter(function (a) { return a.id === id; })[0];
  };

  Annotator.prototype.deleteSelected = function () {
    if (!this.selectedId) return;
    var step = this.step();
    step.annotations = step.annotations.filter(function (a) { return a.id !== this.selectedId; }, this);
    this.selectedId = null;
    this.render();
    this._emit();
  };

  Annotator.prototype._emit = function () { if (this.opts.onChange) this.opts.onChange(); };

  global.Annotator = Annotator;
})(typeof window !== 'undefined' ? window : this);
