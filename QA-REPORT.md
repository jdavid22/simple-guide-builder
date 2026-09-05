# QA & UX Report — Guide Builder

Scope: desktop-only, local-first guide builder (vanilla HTML/CSS/JS, no backend).
Method: three code audits (data-loss/destructive actions, copy/jargon/empty states,
keyboard/a11y/perf/sizing), four improvement passes with retesting after each, then a
fresh-eyes adversarial second pass (long titles, 40-step bulk add, wrong file types on
every input, rapid clicks, Save→New→Load round-trip, undo across deletions, refresh /
restore, viewport sweeps at 960 / 1366 / 1920 px). All verification was done by driving
the real app in a browser plus Node-built exports; zero console errors remain.

---

## OVERALL APPLICATION SCORE: **86 / 100**

| Dimension | Score | Notes |
|---|---|---|
| Functional Reliability | 90 | All core flows verified end-to-end; 4 real bugs fixed; double-click guards added |
| Ease of Use | 85 | Steps come from screenshots; one-click add/paste/insert; in-place editing |
| First-Time User Experience | 84 | Guide details opens on launch; "How it works"; both core concepts explained inline; tooltips on every tool |
| Navigation | 88 | Single screen, three clear columns, no page changes |
| Guide Creation Experience | 87 | Drag/drop, paste, insert-below, auto-order, drag or keyboard reorder |
| Editing Experience | 85 | Live in-place card updates, undo for every removal; text edits rely on native field undo |
| Data-Loss Protection | 88 | Autosave draft + restore prompt + unsaved-changes warning + Load/New confirms; browser-storage limits are the residual risk |
| Error Handling | 84 | Friendly, specific messages for wrong files, unreadable guide files, invalid email; a few native confirm/alert dialogs remain |
| Visual Consistency | 86 | Consistent buttons, plus-glyphs, sentence case; contrast raised to AA |
| Accessibility | 78 | Keyboard-operable cards/lists/dots/sections/modals, dialog semantics, focus ring, aria labels; drawing shapes on the canvas is pointer-only |
| Desktop Productivity | 84 | Ctrl+S, Ctrl+Z, Ctrl+V paste, arrow-key nudge, Alt+↑/↓ reorder, Escape; no "duplicate step" yet |
| Performance | 88 | Drag renders coalesced per frame (2 full renders per drag instead of 30+); 40-step add in 6 ms; typing rebuilds nothing |
| User Confidence | 87 | Always-visible save state, honest button labels, toasts that say what happened (with Undo) |
| Overall Product Polish | 85 | Copy reviewed line-by-line; empty states explain purpose + next action |

---

## ISSUE REPORT

Severity | Area | Problem | Why it matters | Fix | Status
---|---|---|---|---|---
### Critical
Critical | Data loss | No autosave, no unsaved-changes warning: refresh/close/crash lost everything silently | Hours of work gone with no recovery | IndexedDB autosave draft (debounced, structured-clone), restore-on-launch prompt, `beforeunload` guard only when dirty, footer save-state indicator; localStorage text-only fallback; multi-tab pause/take-over | **Fixed**
Critical | Data loss | **Load** replaced the current guide with no confirmation | One mis-click wipes unsaved work | Confirm when dirty (skipped when clean) | **Fixed**
Critical | Bug | Delete key crashed (`TypeError`) after New/Load because the annotator kept a stale selection | Console error, unpredictable state | Single `setProject()` swap point clears selection; null-step guard in the annotator | **Fixed**
Critical | Bug | Saved references (links/PDFs) were wiped on load (normalized through the wrong mapper) | Attachments silently disappear from saved guides | One-line normalizer fix; verified by round-trip | **Fixed (earlier in session)**
### High
High | Undo | Deleting an annotation/row/reference or replacing a screenshot had no confirm and no undo | Accidental loss with no recovery | Removal undo stack (last 5) with 8-second "Undo" toasts; Ctrl+Z; named step-removal confirm | **Fixed**
High | Bug | Dismissing the "Find images" dialog left the UI showing the previous guide | Confusing, looks like Load failed | Modal `onDismiss` hook: Escape/backdrop = "Load without images" and re-render | **Fixed**
High | Bug | Backspace inside a dropdown, or with a modal open, deleted the selected annotation | Destructive side-effect of normal typing | Keydown guard skips SELECT/contenteditable, focused step cards and open modals | **Fixed**
High | Perf | Every mouse move during a drag rebuilt the whole stage (re-decoding a multi-MB screenshot) | Laggy annotating with real screenshots | Persistent `<img>`/`<svg>` scaffold, per-frame coalescing, single-annotation partial render, blur filter scoped to its rect | **Fixed**
High | Perf | Every title keystroke rebuilt both step lists with data-URL thumbnails | Typing lag as guides grow | In-place `updateStepCard`; full rebuild only on add/remove/reorder | **Fixed**
High | Discoverability | Annotation tools were inside a collapsed section | New users couldn't find the core feature | Section open by default; tooltips on every tool | **Fixed**
High | Image workflow | No clipboard paste for a screenshot-centric tool | Extra save-then-drag detour for every screenshot | Ctrl+V adds a new step | **Fixed**
High | Image workflow | Dropping one file onto the stage silently REPLACED the current screenshot; non-image files were ignored silently | Surprising destruction; no feedback | Explicit drag-over overlay ("Drop to replace…" vs "Drop to add N…"), replace is undoable, MIME checks with clear toasts on every input | **Fixed**
High | Clarity | "Workflow" / "Overview" never explained; empty states just said "none yet" | Users can't tell which list to use | One-line descriptions under each heading; empty states say what to do | **Fixed**
High | Clarity | "Export PDF" actually opens a print dialog; "Export HTML" is jargon; Save dialog said "fat JSON / base64 / version control" | Mistrust and confusion | "Print / Save as PDF" (+ toast explaining the dialog), "Export web guide", plain-language save options with a recommended default | **Fixed**
### Medium
Medium | Keyboard/a11y | Step cards, annotation items, color dots, section headers, save choices were not focusable; modals had no Escape/focus/trap; icon-only buttons unlabeled | Keyboard users blocked; screen readers get nothing | tabindex/roles/aria, Enter/Space activation, Alt+↑/↓ reorder, arrow-key nudge, `role=dialog` with initial focus, Tab trap, focus return; aria-labels on 🗑/⋮⋮/＋; `role=status` toast | **Fixed**
Medium | Contrast | Muted text ≈3.4:1; footer credit ≈2.9:1 | Below WCAG AA for small text | `--ink-faint` → `#736a63` (≈4.6:1); removed opacity; meta text 11 px | **Fixed**
Medium | Sizing | Image-kind key row overflowed at ≤1000 px; long titles poked out of narrow cards | Clipped controls at half-screen | `flex-wrap` on key rows/footer/toolbar; block-level ellipsized titles; ≤900 px grid rule | **Fixed**
Medium | Forms | Links typed without `https://` exported broken; invalid support email silently broke "I'm stuck" | Broken output the author can't see | Auto-prefix `https://` on blur; email sanity check with a clear confirm | **Fixed**
Medium | Consistency | Insert-below created an empty (screenshot-less) step, contradicting "every step has a screenshot" | Orphan steps | ＋ now opens the picker and inserts the chosen screenshot at that position | **Fixed**
Medium | Confidence | Turning a device off hid its steps with no warning | Steps "vanish" | Confirm naming the device and step count; explains they stay in the file | **Fixed**
Medium | Reader UX | Viewer's last step showed a disabled, dead "Done"; hotspot hint only on overview steps; support email shipped a placeholder line | Dead end / missing affordance / sloppy email | Enabled "Finish ✓" → end card with "Back to the first step"; hint whenever a step has hotspots; clean email body | **Fixed**
Medium | Double actions | Rapid double-clicks duplicated exports/downloads | Multiple files/tabs | 800 ms in-flight guard on Preview/Export/Print; Save closes its modal before acting | **Fixed**
Medium | Desktop space | Canvas capped at 420 px even on 1920+ px displays | Wasted space, small drawing target | 520 px ≥1600 px, 600 px ≥2200 px | **Fixed**
Medium | Image size | Very large screenshots are stored/exported at full resolution (only a size warning) | Multi-MB exports, slow email | Optional downscale (e.g. max 1600 px wide) on import | **Open — recommendation**
Medium | Save format | "Small file + image folder" triggers one browser download per image | Browsers may prompt or block bulk downloads | Marked *advanced*, explained in the dialog; a zip would need a dependency | **Mitigated — recommendation**
### Low
Low | Polish | Undo/confirm toasts could be 480+ characters for very long titles | Unreadable toast | Labels truncated at 40 chars; toast text ellipsized | **Fixed**
Low | Polish | Mixed "+ / ＋" glyphs, "(s)" plurals, raw internal keys in toasts, raw JS error text in alerts | Looks unfinished | Normalized | **Fixed**
Low | Dialogs | A few native `confirm()`/`alert()` remain (New/Load/Remove step/validation) | Unstyled, but keyboard-accessible and reliable | Could move to the in-app modal | **Open — low**
Low | Copy | "guide · v1" version pill is meaningless to users | Minor | Keep or drop | **Open — low**

---

## TOP 10 IMPROVEMENTS (made)

1. **Autosave + Restore draft + unsaved-changes warning** — the single biggest risk removed.
2. **Undo for every removal** (step, annotation, key row, reference, replaced screenshot) with Ctrl+Z and toast buttons.
3. **Load/New confirm when dirty**, plus the crash/stale-render bug fixes around them.
4. **Paste a screenshot with Ctrl+V**, and explicit drop-to-replace vs drop-to-add.
5. **Frame-coalesced drag rendering** and in-place card updates — annotating stays smooth on real screenshots.
6. **Annotations open by default with tooltips on every tool.**
7. **Honest labels**: "Print / Save as PDF", "Export web guide", plain-language Save options.
8. **Workflow vs Overviews explained inline**, "How it works" empty state, purposeful empty states everywhere.
9. **Keyboard & accessibility**: focusable cards/lists/dots/sections, dialog semantics with Escape/trap/focus return, arrow-key nudge, Alt+↑/↓ reorder, AA contrast.
10. **Always-visible save state** in the footer ("No unsaved changes" / "draft saved 2 min ago").

---

## NOVICE USER REVIEW (first launch, no training)

- **Launch:** Guide details opens automatically; fields are labeled with "(optional)" where they are, the support-email hint explains the "I'm stuck" button. Low hesitation.
- **Empty stage:** "How it works" gives the three steps. The left column explains *Workflow* vs *Overviews*. Most users will start with "＋ Add screenshots" or paste. Low hesitation.
- **Likely hesitation points that remain:**
  - *Overviews* still require a mental model (a deep-dive attached to a step). The description helps; the first time someone adds one, the "Show on workflow steps" checklist makes the relationship concrete.
  - *Hotspot vs Dot:* both carry text. Tooltips distinguish them (tap-to-reveal vs numbered caption), but a novice may still try both.
  - *"Print / Save as PDF":* the browser's print dialog is unfamiliar to some; the toast tells them what to choose.
  - *Mobile vs Computer exclusivity* in Guide details: explained in the hint, but a user who wants "everything" must read it.
- **Mistakes they can now recover from:** deleting the wrong thing (Undo), dropping a screenshot on the wrong step (Undo), closing the tab (warning + draft), loading over unsaved work (confirm).
- **Where they might still need help:** the *advanced* folder-save format; hosting the exported web guide (README covers it).

## WORKFLOW REVIEW (clicks)

New guide → details auto-open (type title, optional contact) → **1 click** to pick screenshots (or Ctrl+V) → first step auto-selected → type title/body → pick a tool (**1 click**) and drag → Next card (click, or Enter on a focused card) … → **1 click** Export web guide. Save is **2 clicks** (Ctrl+S then the recommended option) — the second click exists only to expose the advanced format; acceptable. No screen changes, no dead ends. Unnecessary interactions removed this pass: the empty "+ Step" buttons, the disabled "Done", the redundant right-hand delete icon confirmations.

## SIMPLIFICATION OPPORTUNITIES (not done — product calls)

- **Note/aside vs Tip** are two very similar optional fields; one "Note" with a *tip* style toggle would be simpler. Kept because both were explicitly requested.
- **Save format choice** could be a single "Save" with the folder format under an "Advanced…" disclosure.
- **Device selection** could be a two-option radio (Mobile / Computer) with Android/iPhone sub-checkboxes, instead of three mutually-constrained checkboxes.
- **"Key" heading** per step is rarely renamed; it could live behind a small edit affordance.

## MISSING FEATURES (would materially help)

- **Automatic downscaling of oversized screenshots** on import (quality-preserving max width) — the only lever left against 20 MB+ exports.
- **Duplicate step** (copy title/body/annotations to a new step with a new screenshot).
- **Tool shortcuts** (1–6) for power users, and **Ctrl+D** duplicate.
- **Export size per device** in the footer (currently total).

## DATA-LOSS RISK (scenarios → protection)

| Scenario | Before | Now |
|---|---|---|
| Refresh / close tab / navigate away with unsaved work | Silent total loss | Browser warning (only when dirty) + autosaved draft restored on next launch |
| Browser/OS crash | Total loss | Draft up to ~1.2 s old restored on launch |
| Click **Load** with unsaved work | Silent replacement | Confirm |
| Click **New** with unsaved work | Confirm (always) | Confirm only when dirty; skip when clean |
| Delete a step / annotation / row / reference | Gone | Undo toast + Ctrl+Z (last 5 removals) |
| Drop one file on the stage by accident (replaces screenshot) | Silent | Overlay states "replace"; Undo restores the previous screenshot |
| Two tabs editing the same draft | n/a | Second tab pauses autosave and offers "Take over" |
| Browser storage full / unavailable (private mode) | n/a | Text-only draft fallback, then a clear footer message to save to a file; editing never blocked |
| **Residual:** browser clears site data; user never presses Save | — | Footer always says "Unsaved changes"; drafts are a net, not a substitute for Save |

## FINAL VERDICT

- **Ready for production use?** Yes, for its intended internal/small-team use. Every core flow was exercised and verified; no console errors; no known data-loss path short of a user ignoring the warnings.
- **Comfortable giving it to a user with no training?** Yes. The launch dialog, "How it works", inline concept explanations, tooltips, honest labels, and undo make the first guide achievable without help. The one concept that may still need a sentence of explanation from a colleague is *Overviews*.
- **Is the guide-building workflow intuitive?** Yes — screenshots in, annotate, export; no page changes, no hidden modes (annotation tools are visible by default).
- **Does it protect users from losing work?** Yes: autosave with restore, unsaved-changes warnings, confirms on Load/New, and undo for removals. The remaining caveat is inherent to browser storage — Save (Ctrl+S) is the durable step, and the footer says so.
- **Three biggest things still between this and excellent:**
  1. **Oversized screenshots** are stored at full resolution — exports can get heavy; an import-time downscale option would fix it.
  2. **Canvas drawing is pointer-first** — keyboard users can select, nudge, recolor and delete shapes, but not draw them.
  3. **A few native dialogs and the multi-download folder save** are functional but feel less polished than the rest of the app.
