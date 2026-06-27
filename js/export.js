/* export.js — thin wrappers around Viewer for the three output actions.
 * Loaded as a classic script -> global `Exporter`. */
(function (global) {
  'use strict';

  function exportHTML(project) {
    var html = global.Viewer.buildViewerHTML(project);
    var name = global.Storage.slug(project.title) + '.guide.html';
    global.Storage.downloadBlob(new Blob([html], { type: 'text/html' }), name);
    return html.length;
  }

  // Open the interactive viewer in a new tab (live preview).
  function preview(project) {
    var html = global.Viewer.buildViewerHTML(project);
    var blob = new Blob([html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var win = global.open(url, '_blank');
    if (!win) { alert('Preview was blocked by the popup blocker. Allow popups and try again.'); }
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  // Render the print page for one platform and trigger the browser print dialog.
  function exportPDF(project, platform) {
    var html = global.Viewer.buildPrintHTML(project, platform);
    var win = global.open('', '_blank');
    if (!win) { alert('PDF export needs a popup. Allow popups and try again.'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  global.Exporter = { exportHTML: exportHTML, preview: preview, exportPDF: exportPDF };
})(typeof window !== 'undefined' ? window : this);
