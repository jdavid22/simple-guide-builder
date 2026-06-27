/* storage.js — file ingestion, size accounting, save/load (two formats).
 *
 * Formats:
 *  - "fat"    : one .json with every image/PDF base64-embedded (src = dataURL).
 *  - "folder" : a .json whose image/PDF refs are bare FILENAMES, plus the media
 *               files downloaded alongside. Smaller, VCS-friendly. On load the
 *               user re-supplies the media files; we match by basename.
 *
 * No bundler, no CDN at runtime (must work offline from file://), so the folder
 * export ships media as individual downloads rather than a zip.
 *
 * Loaded as a classic script -> global `Storage`.
 */
(function (global) {
  'use strict';

  // ---- ingestion --------------------------------------------------------
  function readAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  function imageDims(dataURL) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = function () { resolve({ w: 1000, h: 2000 }); };
      img.src = dataURL;
    });
  }

  function readImageFile(file) {
    return readAsDataURL(file).then(function (src) {
      return imageDims(src).then(function (d) {
        return { src: src, name: file.name, w: d.w, h: d.h, lastModified: file.lastModified || 0 };
      });
    });
  }

  function readPdfFile(file) {
    return readAsDataURL(file).then(function (data) {
      return { data: data, name: file.name };
    });
  }

  // ---- size accounting --------------------------------------------------
  function dataUrlBytes(d) {
    if (!d || typeof d !== 'string') return 0;
    var i = d.indexOf('base64,');
    if (i < 0) return d.length;
    var b64 = d.slice(i + 7);
    var pad = (b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0));
    return Math.floor(b64.length * 3 / 4) - pad;
  }

  // Walk every step in a project: cb(step, platform, part, indexWithinPart).
  function eachStep(project, cb) {
    Object.keys(project.tracks).forEach(function (plat) {
      ['workflow', 'overview'].forEach(function (part) {
        (project.tracks[plat][part] || []).forEach(function (s, i) { cb(s, plat, part, i); });
      });
    });
  }

  function rowsBytes(rows) {
    var t = 0;
    (rows || []).forEach(function (r) { if (r.kind === 'image' && r.image) t += dataUrlBytes(r.image); });
    return t;
  }

  // Sum of all embedded media bytes (what dominates a fat export).
  function estimateBytes(project) {
    var total = 0;
    eachStep(project, function (s) {
      if (s.image && s.image.src) total += dataUrlBytes(s.image.src);
      (s.references || []).forEach(function (r) { if (r.data) total += dataUrlBytes(r.data); });
      total += rowsBytes(s.table);
    });
    return total;
  }

  function fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }

  // ---- download helpers -------------------------------------------------
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function dataURLtoBlob(dataURL) {
    var parts = dataURL.split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'application/octet-stream';
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function slug(s) {
    return (s || 'guide').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'guide';
  }

  function extFromName(name, fallback) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : fallback;
  }

  // ---- save -------------------------------------------------------------
  function saveFat(project) {
    var json = JSON.stringify(project, null, 2);
    downloadBlob(new Blob([json], { type: 'application/json' }), slug(project.title) + '.guide.json');
  }

  // Returns a deep-ish clone with media replaced by filenames, plus the media list.
  function buildFolderBundle(project) {
    var base = slug(project.title);
    var media = [];               // { filename, dataURL }
    var copy = JSON.parse(JSON.stringify(project));
    eachStep(copy, function (s, plat, part, idx) {
      var nn = String(idx + 1).padStart(2, '0');
      var stem = base + '-' + plat + '-' + part + nn;
      if (s.image && s.image.src && s.image.src.indexOf('data:') === 0) {
        var ext = extFromName(s.image.name, 'png');
        var fn = stem + '.' + ext;
        media.push({ filename: fn, dataURL: s.image.src });
        s.image.src = fn;
      }
      (s.references || []).forEach(function (r, ri) {
        if (r.kind === 'pdf' && r.data && r.data.indexOf('data:') === 0) {
          var pfn = stem + '-ref' + (ri + 1) + '.pdf';
          media.push({ filename: pfn, dataURL: r.data });
          r.data = pfn;
        }
      });
    });
    return { json: copy, media: media };
  }

  // Downloads JSON + each media file. Browsers drop them in one folder.
  function saveFolder(project) {
    var bundle = buildFolderBundle(project);
    var json = JSON.stringify(bundle.json, null, 2);
    downloadBlob(new Blob([json], { type: 'application/json' }), slug(project.title) + '.guide.json');
    // Stagger media downloads so browsers don't drop them.
    bundle.media.forEach(function (m, i) {
      (function (m) {
        // small spacing without Date/timers-of-now; setTimeout delay is fine.
        setTimeout(function () { downloadBlob(dataURLtoBlob(m.dataURL), m.filename); }, 250 * (i + 1));
      })(m);
    });
    return bundle.media.length;
  }

  // ---- load -------------------------------------------------------------
  // Returns { project, missing:[filenames] } — missing media must be re-supplied.
  function parseProjectFile(text) {
    var raw = JSON.parse(text);
    var project = global.Model.normalizeProject(raw);
    var missing = collectFileRefs(project);
    return { project: project, missing: missing };
  }

  function collectFileRefs(project) {
    var refs = [];
    eachStep(project, function (s) {
      if (s.image && s.image.src && s.image.src.indexOf('data:') !== 0) refs.push(s.image.src);
      (s.references || []).forEach(function (r) {
        if (r.kind === 'pdf' && r.data && r.data.indexOf('data:') !== 0) refs.push(r.data);
      });
    });
    return refs;
  }

  // Given supplied File objects, embed any that match outstanding filename refs.
  function attachMedia(project, files) {
    var byName = {};
    Array.prototype.forEach.call(files, function (f) { byName[f.name] = f; });
    var jobs = [];
    eachStep(project, function (s) {
      if (s.image && s.image.src && s.image.src.indexOf('data:') !== 0 && byName[s.image.src]) {
        (function (step) {
          jobs.push(readImageFile(byName[step.image.src]).then(function (im) {
            step.image.src = im.src; step.image.w = im.w; step.image.h = im.h;
          }));
        })(s);
      }
      (s.references || []).forEach(function (r) {
        if (r.kind === 'pdf' && r.data && r.data.indexOf('data:') !== 0 && byName[r.data]) {
          (function (ref) {
            jobs.push(readAsDataURL(byName[ref.data]).then(function (d) { ref.data = d; }));
          })(r);
        }
      });
    });
    return Promise.all(jobs).then(function () { return collectFileRefs(project); });
  }

  global.Storage = {
    readImageFile: readImageFile,
    readPdfFile: readPdfFile,
    readAsDataURL: readAsDataURL,
    eachStep: eachStep,
    estimateBytes: estimateBytes,
    fmtBytes: fmtBytes,
    dataUrlBytes: dataUrlBytes,
    downloadBlob: downloadBlob,
    slug: slug,
    saveFat: saveFat,
    saveFolder: saveFolder,
    parseProjectFile: parseProjectFile,
    attachMedia: attachMedia,
    collectFileRefs: collectFileRefs
  };
})(typeof window !== 'undefined' ? window : this);
