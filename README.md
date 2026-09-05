# Simple Mobile Guide Builder

A **local-first** web app for creating, editing, and exporting step-by-step
screenshot how-to guides (setting up Microsoft Authenticator, Company Portal,
Concur, and so on). The point: stop wrestling with Word. A guide is a
**structured, reloadable project** — drop in a new screenshot, nudge an arrow,
re-export.

No accounts, no server, no database. You build in the browser, save to a file,
and load it back later. Runs straight from `file://` (double-click `index.html`)
or hosted as a static site (e.g. Netlify). Desktop browsers only.

## How it works

- **One guide, per-device tracks.** A guide is either a **mobile** guide
  (Android and/or iPhone) or a **computer** guide. Each enabled device has its
  own set of steps. Readers are asked which device they use only when more than
  one is enabled.
- **Workflow + Overviews.** The **workflow** is the ordered process a reader
  follows. **Overviews** are optional deep-dives that explain one screen's
  options; attach one to a workflow step and readers open it from a
  "Learn more" button. A guide with only overviews becomes an app tour.

## Building a guide

1. **Add screenshots** — drag & drop several at once, paste one with Ctrl+V, or
   use "+ Add screenshots". They auto-order by file modified-date (phones strip
   EXIF, so that's the reliable signal); drag the cards — or use Alt+↑/↓ — to
   reorder. The + on a card inserts a screenshot right below it.
2. **Fill in each step** — title, body, an optional note, a tip, a per-step
   **color/icon key** (color swatch, a symbol from the built-in icon picker,
   or a small image), and
   **references** (attached PDFs or links).
3. **Annotate the screenshot** — arrow, box, hotspot (tap-to-reveal text),
   numbered dot, and blur (hide private info). Arrows and boxes have a
   thickness control. Coordinates are stored as **percentages of the image**,
   so replacing a screenshot of the same size leaves the annotations in place.
   Arrow keys nudge the selected annotation; Delete removes it. The canvas
   sizes itself to the screenshot (desktop captures fill the workspace, phone
   captures stay phone-sized) and zooms with −/+, Ctrl+scroll, or Ctrl +/−/0.
4. **Guide details** (opens automatically on launch; turn that off inside it) —
   title, description, support contact for the reader's "I'm stuck" button
   (hidden when blank), device types, and the guide's reading font.

## Saving, autosave, and undo

- **Save** (Ctrl+S) downloads a file you can reopen with **Load…**:
  - **One file (recommended)** — everything embedded in a single `.guide.json`.
  - **Small file + image folder (advanced)** — a small JSON plus the images as
    separate files; you re-select them when loading (matched by filename).
- **Autosave** keeps a draft of unsaved work in your browser (IndexedDB, with a
  text-only fallback if storage is tight). On the next launch you're offered
  **Restore draft** / **Discard**. The footer shows the current state
  ("No unsaved changes" / "draft saved 2 min ago"), and the browser warns before
  you close a tab with unsaved changes.
- **Undo** (Ctrl+Z or the toast's Undo button) restores the last few removals:
  a deleted step, annotation, key row or reference, or a replaced screenshot.

## Exporting

- **Export web guide** — one self-contained HTML file. Opens from `file://` or
  drop it on a static host to share. It asks the reader which device they use
  (when more than one), steps them through, reveals hotspots on tap/hover (the
  text pulses in and fades when the pointer leaves), opens any screenshot
  full-screen in a new tab when tapped, shows linked overviews behind a
  "Learn more" button, and offers **"I'm stuck"**
  (prefilled `mailto:` to the support contact, naming the current step).
- **Print / Save as PDF** — renders the active device's guide as a print page
  and opens the browser's print dialog (choose *Save as PDF*). Hotspots become
  numbered callouts; overviews print as their own pages at the end.

## Tech

Vanilla HTML/CSS/JS, no build step, no bundler, classic (non-module) scripts so
it works from `file://`. The Google Fonts `<link>` is the only network reference
and degrades gracefully to system fonts offline.

```
index.html              builder shell
assets/notebook.css     Engineer's Notebook design system
js/model.js             project data model (% annotations)
js/annotator.js         SVG annotation editor (frame-coalesced drags)
js/storage.js           file ingestion, size tally, save/load
js/draft.js             autosave draft (IndexedDB → localStorage fallback)
js/undo.js              removal undo stack
js/viewer-template.js   shared render fns → live preview, web export, PDF
js/export.js            export/preview wrappers
js/app.js               builder controller
```

### Local preview

Just open `index.html`. To serve it instead: `node .claude/static-server.js`
(then visit `http://localhost:4173`).
