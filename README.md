# Simple Mobile Guide Builder

A **local-first** web app for creating, editing, and exporting step-by-step
mobile how-to guides (setting up Microsoft Authenticator, Company Portal, Concur,
etc.). The point: stop wrestling with Word. A guide is a **structured, reloadable
project** — drop in a new screenshot, nudge an arrow, re-export.

No accounts, no server, no database. You build in the browser, save to a file,
and load it back later. Runs straight from `file://` (double-click `index.html`)
or hosted as a static site (e.g. Netlify).

## How it works

- **One project, two tracks.** Each guide holds parallel **Android** and **iPhone**
  tracks (shared title, description, legend, and support contact, but
  independently authored steps). The builder has a track toggle; the viewer/PDF
  asks **"Android or iPhone?"** first and routes the reader.
- **Two guide types per track:**
  - **Workflow** — ordered steps for setting something up.
  - **Overview** — a tour where hotspots **reveal text on tap (touch) / hover
    (desktop)**.

## Building a guide

1. **Add screenshots** — drag-and-drop several at once (or use the button). They
   auto-order by file modified-date (phones strip EXIF, so that's the reliable
   signal); drag the step cards to fix the order. Insert a step anywhere with the
   `＋` button.
2. **Fill in each step** — title, body, an optional **Note/aside**, a **Tip**, a
   per-step **color/icon key**, and **references** (attach PDFs or external links).
3. **Annotate the screenshot** — arrow, box, hotspot, numbered dot, and
   redaction/blur (for hiding account numbers and names). All coordinates are
   stored as **percentages of the image**, so swapping in a new screenshot of the
   same size leaves the annotations in place.
4. **Project settings** (⚙) — title, description, the guide-wide **legend**, and
   the **IPT support contact** used by the viewer's "I'm stuck" button.

The footer shows a live **export-size estimate** that turns amber past ~15 MB and
red past ~20 MB (big single HTML files choke browsers and email).

## Saving & loading

Two formats, both offered from **Save ▾**:

- **Single file (fat JSON)** — everything (screenshots + PDFs) base64-embedded in
  one `.json`. Easiest to move around.
- **JSON + image folder** — a small `.json` that references image/PDF files,
  downloaded alongside it. Friendlier to version control. Keep the files together;
  on load you re-select them (matched by filename).

**Open…** loads either format back in to edit.

## Exporting

- **Export HTML** — one self-contained file with all CSS/JS/screenshots/PDFs
  inlined. Opens from `file://` or drop it on a static host to share. It opens
  with the device question, steps the reader through, reveals overview hotspots on
  tap/hover, and has an **"I'm stuck"** button on every step that opens a
  prefilled `mailto:` to the configured contact (e.g. *"I'm stuck on Step 4:
  Approve sign-in request."*).
- **Export PDF** — renders the active track as a print-friendly page and opens the
  browser's print dialog (choose *Save as PDF*). Since paper has no tap/hover,
  **hotspots become numbered callouts** with the text listed beside each image.

## Tech

Vanilla HTML/CSS/JS, no build step, no bundler, classic (non-module) scripts so it
works from `file://`. The Google Fonts `<link>` is the only network reference and
degrades gracefully to system fonts offline.

```
index.html              builder shell
assets/notebook.css     Engineer's Notebook design system
js/model.js             project data model (% annotations)
js/annotator.js         SVG annotation editor
js/storage.js           file ingestion, size tally, save/load
js/viewer-template.js   shared render fns -> live preview, HTML export, PDF
js/export.js            export/preview wrappers
js/app.js               builder controller
```

### Local preview

Just open `index.html`. To serve it instead: `node .claude/static-server.js`
(then visit `http://localhost:4173`).
