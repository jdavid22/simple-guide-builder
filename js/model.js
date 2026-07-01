/* model.js — project data model for the Mobile Guide Builder.
 *
 * One project holds two parallel tracks (android, iphone). Each track is one
 * guide TYPE (workflow | overview) and an ordered list of steps. All annotation
 * coordinates are stored as PERCENTAGES of the image (0..100) so that swapping a
 * screenshot of the same aspect ratio leaves the annotations roughly in place.
 *
 * Loaded as a classic script: everything hangs off the global `Model`.
 */
(function (global) {
  'use strict';

  var SCHEMA_VERSION = 1;

  // Small id helper. Date-free Math.random is fine here (ids only need to be
  // unique within a project, not reproducible).
  function uid(prefix) {
    var s = Math.random().toString(36).slice(2, 9);
    return (prefix || 'id') + '_' + s;
  }

  var ANNOTATION_TYPES = ['arrow', 'box', 'hotspot', 'dot', 'redact'];
  var PARTS = ['workflow', 'overview'];   // every track has both, in this order
  var DEFAULT_LEARN_LABEL = 'Learn more about the options on this screen';

  // Reading-text fonts offered for the EXPORTED guide (viewer + PDF). Only
  // offline-safe system stacks — no web fonts that would fail from file://.
  var FONTS = [
    { key: 'system', label: 'System sans (default)', stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
    { key: 'serif', label: 'Serif — Georgia', stack: 'Georgia, Cambria, "Times New Roman", serif' },
    { key: 'verdana', label: 'Legible — Verdana', stack: 'Verdana, Geneva, Tahoma, sans-serif' },
    { key: 'trebuchet', label: 'Friendly — Trebuchet', stack: '"Trebuchet MS", "Segoe UI", Helvetica, Arial, sans-serif' }
  ];
  function fontStack(key) {
    var f = FONTS.filter(function (x) { return x.key === key; })[0];
    return (f || FONTS[0]).stack;
  }
  var PLATFORMS = ['android', 'iphone', 'pc'];   // all supported device tracks
  var DEVICE_META = {
    android: { label: 'Android', icon: '🤖' },
    iphone: { label: 'iPhone', icon: '📱' },
    pc: { label: 'Computer', icon: '💻' }
  };

  // Default palette used by annotation tools and the color/icon legend table.
  var PALETTE = [
    { name: 'Red', value: '#c0392b' },
    { name: 'Blue', value: '#2c5aa0' },
    { name: 'Green', value: '#2e7d32' },
    { name: 'Amber', value: '#e8a317' },
    { name: 'Purple', value: '#7b4397' },
    { name: 'Ink', value: '#1b2733' }
  ];

  function newLegendRow() {
    // kind: 'color' (swatch) | 'icon' (glyph) | 'image' (uploaded crop -> dataURL in .image)
    return { id: uid('row'), kind: 'color', value: '#c0392b', icon: '', image: '', text: '' };
  }

  function newReference() {
    return { id: uid('ref'), kind: 'link', label: '', href: '', data: '', name: '' };
  }

  function newStep() {
    return {
      id: uid('step'),
      title: '',
      body: '',
      note: '',          // inline aside callout
      tip: '',           // tip section
      table: [],         // per-step color/icon rows
      tableTitle: 'Key', // heading shown above the color/icon key
      image: null,       // { src, name, w, h, lastModified } — src is dataURL or filename
      annotations: [],   // array of annotation objects (see normalizeAnnotation)
      references: [],     // array of references (pdf/link)
      linkedStepIds: [], // (overview steps) workflow step ids this overview is attached to
      linkLabel: ''      // (overview steps) custom "learn more" button text; '' => default
    };
  }

  function newTrack() {
    return { workflow: [], overview: [] };
  }

  function newProject() {
    return {
      schema: SCHEMA_VERSION,
      title: '',
      description: '',
      ipt: { name: '', email: '' },   // "I'm stuck" contact
      font: 'system',                  // reading-text font for the exported guide
      devices: ['android', 'iphone'],  // which device tracks this guide includes
      tracks: {
        android: newTrack(),
        iphone: newTrack(),
        pc: newTrack()
      }
    };
  }

  // Annotation factory. All geometry fields are percentages 0..100.
  function newAnnotation(type, init) {
    init = init || {};
    var base = {
      id: uid('ann'),
      type: type,
      color: init.color || '#c0392b',
      text: init.text || '',
      number: init.number || 0,
      weight: num(init.weight, 1)   // stroke thickness multiplier (arrow/box)
    };
    switch (type) {
      case 'arrow':
        base.x1 = num(init.x1, 30); base.y1 = num(init.y1, 30);
        base.x2 = num(init.x2, 60); base.y2 = num(init.y2, 60);
        break;
      case 'box':
      case 'redact':
      case 'hotspot':
        base.x = num(init.x, 25); base.y = num(init.y, 25);
        base.w = num(init.w, 30); base.h = num(init.h, 20);
        break;
      case 'dot':
        base.x = num(init.x, 50); base.y = num(init.y, 50);
        break;
    }
    return base;
  }

  function num(v, d) { return (typeof v === 'number' && !isNaN(v)) ? v : d; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Coerce a raw object (from a loaded file) into a valid annotation.
  function normalizeAnnotation(a) {
    if (!a || ANNOTATION_TYPES.indexOf(a.type) < 0) return null;
    var n = newAnnotation(a.type, a);
    n.id = a.id || n.id;
    return n;
  }

  function normalizeStep(s) {
    var step = newStep();
    if (!s) return step;
    step.id = s.id || step.id;
    step.title = s.title || '';
    step.body = s.body || '';
    step.note = s.note || '';
    step.tip = s.tip || '';
    step.table = Array.isArray(s.table) ? s.table.map(normalizeRow) : [];
    step.tableTitle = typeof s.tableTitle === 'string' ? s.tableTitle : 'Key';
    step.image = s.image || null;
    step.annotations = Array.isArray(s.annotations)
      ? s.annotations.map(normalizeAnnotation).filter(Boolean) : [];
    step.references = Array.isArray(s.references)
      ? s.references.map(normalizeRow.bind(null)).map(normRef) : [];
    step.linkedStepIds = Array.isArray(s.linkedStepIds)
      ? s.linkedStepIds.map(String) : [];
    step.linkLabel = typeof s.linkLabel === 'string' ? s.linkLabel : '';
    return step;
  }

  function normRef(r) {
    return {
      id: r.id || uid('ref'),
      kind: r.kind === 'pdf' ? 'pdf' : 'link',
      label: r.label || '',
      href: r.href || '',
      data: r.data || '',
      name: r.name || ''
    };
  }

  function normalizeRow(r) {
    r = r || {};
    var kind = (r.kind === 'icon' || r.kind === 'image') ? r.kind : 'color';
    return {
      id: r.id || uid('row'),
      kind: kind,
      value: r.value || '#c0392b',
      icon: r.icon || '',
      image: r.image || '',
      text: r.text || ''
    };
  }

  // A guide is EITHER a mobile guide (android and/or iphone) OR a computer
  // guide (pc) — never both. If a mix slips in, favor the mobile set.
  function sanitizeDevices(devs) {
    var hasMobile = devs.indexOf('android') >= 0 || devs.indexOf('iphone') >= 0;
    if (devs.indexOf('pc') >= 0 && hasMobile) {
      return devs.filter(function (d) { return d !== 'pc'; });
    }
    return devs;
  }

  function normalizeTrack(t) {
    var track = newTrack();
    if (!t) return track;
    // migrate the old single-type shape { type, steps } into the matching part
    if (Array.isArray(t.steps) && !t.workflow && !t.overview) {
      var arr = t.steps.map(normalizeStep);
      if (t.type === 'overview') track.overview = arr; else track.workflow = arr;
      return track;
    }
    track.workflow = Array.isArray(t.workflow) ? t.workflow.map(normalizeStep) : [];
    track.overview = Array.isArray(t.overview) ? t.overview.map(normalizeStep) : [];
    return track;
  }

  // Coerce a loaded project into the current schema, filling gaps.
  function normalizeProject(p) {
    var proj = newProject();
    if (!p || typeof p !== 'object') return proj;
    proj.title = p.title || '';
    proj.description = p.description || '';
    proj.ipt = { name: (p.ipt && p.ipt.name) || '', email: (p.ipt && p.ipt.email) || '' };
    proj.font = FONTS.filter(function (f) { return f.key === p.font; })[0] ? p.font : 'system';
    PLATFORMS.forEach(function (plat) {
      proj.tracks[plat] = normalizeTrack(p.tracks && p.tracks[plat]);
    });
    // Enabled device set: validate against PLATFORMS, preserve order, never empty.
    var devs = Array.isArray(p.devices)
      ? PLATFORMS.filter(function (x) { return p.devices.indexOf(x) >= 0; })
      : null;
    proj.devices = sanitizeDevices((devs && devs.length) ? devs : ['android', 'iphone']);
    return proj;
  }

  global.Model = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    ANNOTATION_TYPES: ANNOTATION_TYPES,
    PARTS: PARTS,
    DEFAULT_LEARN_LABEL: DEFAULT_LEARN_LABEL,
    FONTS: FONTS,
    fontStack: fontStack,
    PLATFORMS: PLATFORMS,
    DEVICE_META: DEVICE_META,
    sanitizeDevices: sanitizeDevices,
    PALETTE: PALETTE,
    uid: uid,
    clamp: clamp,
    newProject: newProject,
    newTrack: newTrack,
    newStep: newStep,
    newAnnotation: newAnnotation,
    newLegendRow: newLegendRow,
    newReference: newReference,
    normalizeProject: normalizeProject,
    normalizeStep: normalizeStep,
    normalizeAnnotation: normalizeAnnotation
  };
})(typeof window !== 'undefined' ? window : this);
