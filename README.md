# pdfkit

Private PDF tools that run entirely in your browser. Files are processed on
your device with WebAssembly inside Web Workers and are **never uploaded**.

Currently shipped tools:

- **PDF Unlocker** (`/tools/unlock/`): removes owner restrictions and decrypts
  files whose password you know, using [qpdf](https://github.com/qpdf/qpdf)
  compiled to WASM. It does not crack or guess passwords.
- **Signature Verifier** (`/tools/verify/`, beta): checks that a signed PDF is
  unmodified and its signature is cryptographically correct.
- **Markdown to PDF** (`/tools/markdown-to-pdf/`, beta): renders Markdown
  (CommonMark + GitHub Flavored Markdown, via [marked](https://marked.js.org))
  with your own CSS into a PDF, using the
  [ironpress](https://github.com/gastongouron/ironpress) HTML/CSS layout engine
  compiled to WASM. Paper size and margins come from the page settings, or from
  an `@page` rule in the CSS (which wins).
- **PDF Editor** (`/tools/edit/`, beta): changes the PDF's own text in place,
  adds text, freehand drawings, boxes, highlights and images (PNG/JPEG, such
  as a signature), and rotates, reorders or deletes pages, using
  [PDFium](https://pdfium.googlesource.com/pdfium/) compiled to WASM
  ([`@embedpdf/pdfium`](https://github.com/embedpdf/embed-pdf-viewer)).
  Editing a line rewrites its text objects in the file; nothing is painted
  over the old text. The line keeps its own (often subset-embedded) font when
  that font demonstrably has every typed character, and otherwise switches to
  the closest standard font at the same position, size and colour. The
  on-screen preview is rendered by the same code that saves, so it shows
  exactly what the file will contain. Password-protected PDFs open with their
  password and stay protected after saving. Text in scanned pages or inside
  form XObjects cannot be edited, and new or substituted text is limited to
  the standard PDF fonts (WinAnsi: English and Western European languages).
- **Organize Pages** (`/tools/organize/`, beta): a thumbnail board for one or
  more PDFs. Pages of every file appear in one grid, numbered and coloured by
  file. Drag (or Ctrl/Cmd + arrow keys) to reorder; rotate, duplicate or
  delete the selection; insert a blank page sized like its neighbour;
  "Interleave" a double-sided scan (fronts, then backs in reverse) or reverse
  the order; turn landscape pages upright; undo and redo everything. Saving
  builds a new PDF from the pages with
  [PDFium](https://pdfium.googlesource.com/pdfium/)'s page import, so page
  content is copied as is and rotation only sets `/Rotate`: text stays text.
  Bookmarks, form fields and document properties are not carried over, and
  files opened with a password are saved without one.

Built with Next.js (App Router, static export), TypeScript (strict), Tailwind
CSS, shadcn/ui, next-themes and Vitest. It is an installable, offline-capable PWA.

## How privacy is enforced

- **No server code.** `output: 'export'` produces plain static files in `out/`.
  There is nothing to upload to.
- **Work happens in a Web Worker.** The file is read with `File.arrayBuffer()`
  and handed to the worker as a transferred `ArrayBuffer`. qpdf runs against an
  in-memory virtual file system that is cleaned up after every job.
- **Same-origin only.** Each `.wasm` and its loader are served from `/wasm/`
  (copied from `node_modules` by `scripts/copy-wasm.mjs`), never a CDN. No
  analytics, no external fonts.
- **A strict CSP** in `firebase.json` blocks every third-party host:
  `connect-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` plus SHA-256
  hashes of Next's inline bootstrap scripts (written after each build by
  `scripts/csp-hash.mjs`), and `style-src 'self'` plus hashes (no
  `unsafe-inline`). Also `nosniff`, `Referrer-Policy: no-referrer`, a
  locked-down `Permissions-Policy` and `frame-ancestors 'none'`.
- **Verify it yourself:** open DevTools > Network, use a tool, and check that no
  request carries your file and none go to other hosts. Or go offline: it still
  works.

## Commands

Requires Node 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev              # dev server on http://localhost:3000
pnpm lint
pnpm typecheck
pnpm test
pnpm build            # static site in out/, then builds sw.js and updates the CSP in firebase.json
pnpm preview          # serves out/ through the Firebase Hosting emulator (real headers)
pnpm preview:simple   # plain static server (no CSP headers)
pnpm icons            # regenerate PWA icons from assets/icon.svg (outputs are committed)
```

`pnpm build` runs `scripts/copy-wasm.mjs` first (prebuild) and
`scripts/build-sw.mjs` then `scripts/csp-hash.mjs` afterwards (postbuild).
**Commit the updated `firebase.json` after building**: the CSP hashes change
when page code changes. Each page adds a few script hashes, so the header grows
with the number of tools; that is fine for dozens of tools.

The service worker registers in production builds only. Test offline and
install behaviour with `pnpm build && pnpm preview` (http://localhost:5000).

## Environment

| Variable               | Purpose                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SITE_URL` | Public origin, e.g. `https://pdfkit.example.com`. Used for canonical URLs, Open Graph/Twitter image URLs, sitemap and robots. Defaults to `http://localhost:3000`. |

```bash
NEXT_PUBLIC_SITE_URL=https://pdfkit.example.com pnpm build
```

## Deploying to Firebase Hosting

`firebase.json` is already configured: `public: "out"`, `cleanUrls`, trailing
slashes, security headers, immutable caching for `/_next/static/**`, `no-cache`
for `sw.js`, and `image/png` for the extensionless OG image files.

```bash
pnpm dlx firebase-tools login
pnpm dlx firebase-tools use --add
NEXT_PUBLIC_SITE_URL=https://your-domain pnpm build
pnpm dlx firebase-tools deploy --only hosting
```

## Adding a new tool

The landing grid, static routes, metadata, JSON-LD, sitemap, OG image and
service worker precache are all derived from `src/tools/registry.ts`.

1. Create `src/tools/<slug>/index.tsx`: a client component (`"use client"`) with
   a default export. For heavy work add a worker in `src/tools/<slug>/worker/`
   and use `WorkerClient` (`src/lib/worker-client.ts`) with `exposeWorker`
   (`src/lib/worker-protocol.ts`). Create the worker with
   `new Worker(new URL("./worker/x.worker.ts", import.meta.url), { type: "module" })`
   in your own code so the bundler can see it.
2. Add **one entry** to `tools` in `src/tools/registry.ts`: `slug`, `name`,
   `tagline`, a 150-160 character `description`, `keywords`, a lucide `icon`,
   `faq`, optional `howItWorks` steps, and `component: () => import("./<slug>")`.
3. Done. `pnpm test` validates the entry; `pnpm build` generates
   `/tools/<slug>/`, its OG card, sitemap entry and precache.

## Large engines and the service worker

The service worker precaches every file in `out/` except those listed in
`ON_FIRST_USE` in `scripts/build-sw.mjs`. The ironpress binary (~15 MB, ~6 MB
gzipped) and PDFium (binary ~4.6 MB, ~2 MB gzipped, plus its JavaScript glue)
are on that list: each is cached the first time a tool loads it (PDFium is shared by the PDF
Editor and Organize Pages), so visitors who never use those tools never download it, and the
tools still work offline after their first use.

## Manual test checklist (Organize Pages)

Sample files live in `fixtures/` (`duplex-scan.pdf`, `duplex-fronts.pdf` and
`duplex-backs.pdf` are made by `scripts/make-duplex-fixture.mjs`;
`user-password.pdf` has password `hunter2`).

- [ ] Drop `duplex-fronts.pdf` and `duplex-backs.pdf` together: 10 pages
      appear, numbered 1 and 2 by file, in two colours; the legend lists both.
- [ ] **Interleave all** puts them in order 1 to 10; **Undo** restores the
      scanned order. `duplex-scan.pdf` alone gives the same result.
- [ ] Click, Ctrl/Cmd+click and Shift+click select pages; the tick on a
      thumbnail toggles it (touch screens); **Select** in the legend selects a
      whole file.
- [ ] Drag a selection to another place; the bar shows where it lands; Escape
      cancels a drag. On a phone, drag with the grip; swiping elsewhere scrolls.
- [ ] Keyboard: Tab to the board, arrows move, Shift+arrows select, Space
      toggles, Ctrl/Cmd+arrows move the selected pages, Delete removes them,
      Ctrl/Cmd+Z undoes.
- [ ] **Rotate**, **Duplicate**, **Insert blank page** (same size as the page
      before it), **Reverse** and **Make portrait** work, and each is undoable.
- [ ] **Download PDF** saves `organized.pdf` (or `<name>-organized.pdf` for
      one file); in a PDF reader the text is selectable on rotated pages.
- [ ] `user-password.pdf`: the password prompt says the result has no
      password; **Skip this file** skips it; `hunter2` adds it.
- [ ] **Start over** with changes asks first; closing the tab with changes
      asks too.
- [ ] A 500-page PDF: the board scrolls smoothly and thumbnails render as
      they come into view.
- [ ] At 360px width there is no horizontal scroll at any thumbnail size.

## Manual test checklist (PDF Editor)

Sample files live in `fixtures/` (`user-password.pdf` has password `hunter2`;
`text-chromium.pdf` is printed by Chromium with embedded subset fonts, see
`scripts/make-text-fixture.mjs`).

- [ ] Opening a PDF shows every page; pages far off screen render when
      scrolled to.
- [ ] **Edit text** on `fixtures/text-chromium.pdf`: click "Total amount due
      is 1250 dollars.", type `1520`, press Enter; the line keeps its font. Type
      `Zoe` into "Contact: billing team"; it switches to Helvetica, stays red
      and a notice says why. Esc cancels; emptying a line deletes it.
- [ ] **Add text:** click a page and type right there; font, size and colour
      in the panel change it. Typing `₹` shows a toast and the character is
      removed. Double-click added text to type into it again.
- [ ] **Draw, Box, Highlight:** drag on a page; each tool stays active for the
      next shape. A click (no drag) makes a default-size box.
- [ ] **Image:** pick a PNG with a transparent background, click a page; it is
      placed at 40% of the page width and the background stays transparent in
      the download.
- [ ] **Select:** drag an object to move it, drag the corner handle to resize a
      box or image; Tab to an object, arrow keys nudge it, Delete removes it,
      Ctrl+Z / Ctrl+Shift+Z undo and redo.
- [ ] Rotate, move and delete pages; the last page cannot be deleted.
- [ ] **Download PDF** saves `<name>-edited.pdf`; in a PDF reader the added
      and edited text is selectable, and the old text of an edited line can no
      longer be found or copied.
- [ ] `user-password.pdf`: wrong password shows "Wrong password"; `hunter2`
      opens it; the download still asks for `hunter2`.
- [ ] **Open another** with unsaved edits asks before discarding them; closing
      the tab with unsaved edits asks too.
- [ ] Offline after one use: reload with DevTools > Network > Offline, open a
      PDF and download it.
- [ ] At 360px width there is no horizontal scroll and drawing with a finger
      does not scroll the page.

## Manual test checklist (Markdown to PDF)

- [ ] The sample document converts; **Download PDF** saves `document.pdf`.
- [ ] Changing `h1 { color: ... }` in the CSS changes the heading colour in the PDF.
- [ ] **Paper size** Letter gives an 8.5 x 11 in page; an `@page { size: A5; }`
      rule in the CSS overrides it.
- [ ] Opening `notes.md` fills the editor and the download is named `notes.pdf`;
      a `.png` is rejected with a toast.
- [ ] Editing anything after converting hides the old **Download PDF** button.
- [ ] **Cancel** stops a long conversion and the next one works.
- [ ] Offline after one conversion: reload with DevTools > Network > Offline
      and convert again.

## Manual test checklist (PDF Unlocker)

Sample files live in `fixtures/` (`plain.pdf`, `owner-restricted.pdf`,
`user-password.pdf` with password `hunter2`).

- [ ] **Unencrypted PDF:** shows "Not encrypted", no download button.
- [ ] **Owner-password PDF:** unlocks automatically ("Restrictions removed");
      Download gives `owner-restricted-unlocked.pdf`, which opens unrestricted.
- [ ] **User-password PDF, wrong password:** dialog shows "Wrong password",
      stays open, retry works.
- [ ] **User-password PDF, right password:** unlocks, Download works, dialog
      closes. "Skip this file" leaves an "Enter password" button on the row.
- [ ] **Non-PDF file:** rejected with a toast.
- [ ] Several files are processed one after another; **Clear all** empties the list.
- [ ] **Network tab** shows no upload and no third-party requests.
- [ ] **Offline:** load the page once, reload, switch DevTools > Network to
      Offline and reload: pages and the unlocker still work; an unvisited URL
      shows the offline page.
- [ ] **Install:** Chrome shows "Install app" in the header (iOS Safari shows the
      Add to Home Screen hint); the installed app opens standalone.
- [ ] **Update:** deploy a new build and reload the installed app twice; a
      "New version available" toast with a Reload button appears.
- [ ] At 360px width there is no horizontal scroll; dark mode follows the
      system and the toggle works.

## Licences

PDF unlocking uses **qpdf**, Copyright (c) Jay Berkenbilt, licensed under the
**Apache License 2.0** (qpdf is also available under the Artistic License 2.0).
The WebAssembly build is [`@jspawn/qpdf-wasm`](https://github.com/jsscheller/qpdf-wasm)
(Apache-2.0). The licence text ships at `/wasm/LICENSE.txt`, a notice at
`/wasm/NOTICE.txt`. qpdf is credited here.

Markdown to PDF uses **ironpress**, Copyright (c) 2026 Gaston Gouron, licensed
under the **MIT License** (licence at `/wasm/LICENSE-ironpress.txt`), and
**marked**, licensed under the **MIT License**. Fonts: Geist and
Inter (SIL Open Font License 1.1), bundled locally.

The PDF Editor and Organize Pages use **PDFium**, Copyright The PDFium
Authors, licensed under the **BSD 3-Clause License** and the **Apache License
2.0** (licence at `/wasm/LICENSE-pdfium.txt`), compiled to WebAssembly by
**@embedpdf/pdfium**, Copyright (c) 2024 CloudPDF, Ji Chang, licensed under the
**MIT License** (licence at `/wasm/LICENSE-embedpdf-pdfium.txt`). Text
measurements come from Adobe's standard font metrics via
**@pdf-lib/standard-fonts** (MIT License).
