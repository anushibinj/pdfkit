# pdfkit

Private PDF tools that run entirely in your browser. Files are processed on
your device with WebAssembly inside Web Workers and are **never uploaded**.

Currently shipped tools:

- **PDF Unlocker** (`/tools/unlock/`): removes owner restrictions and decrypts
  files whose password you know, using [qpdf](https://github.com/qpdf/qpdf)
  compiled to WASM. It does not crack or guess passwords.
- **Protect PDF** (`/tools/protect/`, beta): adds an open password to a PDF
  with AES-256 encryption (PDF 2.0, revision 6), using the same qpdf build.
  The password is typed twice and is also set as the owner password, so the
  person who knows it keeps full control (an empty owner password would let
  anyone open an AES-256 file). Before the file is offered, it is re-opened
  to check that it is refused without the password and opens with exactly
  the password typed. Passwords go to qpdf in a job JSON file, never as
  command line arguments (qpdf reads an argument starting with `@` as a file
  of arguments). Passwords longer than 127 UTF-8 bytes are refused: qpdf
  11.0.0 writes them untruncated, while PDF 2.0 readers truncate to 127 bytes,
  so such a file would not open in qpdf or pdf.js. A PDF that already needs a
  password is left alone (unlock it first); one with only restrictions gets
  the password and loses the restrictions, and the page says so. Encrypting
  rewrites the file, so a digitally signed PDF's signatures are no longer
  valid in the protected copy; the page warns about that too (signatures are
  found with the same byte scan as the Signature Verifier).
- **Merge PDFs** (`/tools/merge/`, beta): combines several PDFs into one, in
  the order you choose, using the same qpdf build (no extra download). Pages
  are copied as PDF objects, so nothing is re-rendered or re-compressed;
  links, comments and form fields stay. Each file is checked when added
  (its page count, through qpdf's stdout) and password-protected files open
  with their password, which goes to qpdf in a job JSON file like Protect
  PDF's. qpdf starts from an empty document (`--empty`), so bookmarks and
  document properties are not carried over, the result is not encrypted,
  and digital signatures in the inputs are not valid in it.
- **Signature Verifier** (`/tools/verify/`, beta): checks that a signed PDF is
  unmodified and its signature is cryptographically correct.
- **Markdown to PDF** (`/tools/markdown-to-pdf/`, beta): renders Markdown
  (CommonMark + GitHub Flavored Markdown, via [marked](https://marked.js.org))
  with your own CSS into a PDF, using the
  [ironpress](https://github.com/gastongouron/ironpress) HTML/CSS layout engine
  compiled to WASM. Paper size and margins come from the page settings, or from
  an `@page` rule in the CSS (which wins).
- **HTML to PDF** (`/tools/html-to-pdf/`, beta): lays out HTML (a full page
  or a fragment, typed or opened from an `.html`/`.htm`/`.xhtml` file) with its
  own CSS into a PDF, using the same ironpress engine. Files are read in the
  encoding they declare (a `<meta charset>`, as in Word's windows-1252 "Save as
  Web Page" output), elements with the `hidden` attribute and closed
  `<details>`/`<dialog>` content stay hidden, and an `@page` rule in the HTML
  sets the paper size and margins. The engine has no network access and runs
  no JavaScript, so after converting, the page lists what it left out: images
  that are not PNG/JPEG `data:` URLs, linked stylesheets, and scripts.
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
- **Add Watermark** (`/tools/watermark/`, beta): adds a text or picture
  (PNG/JPEG) watermark to every page or to a page range, with opacity, angle,
  one of nine positions or tiled across the page, over or under the content.
  [PDFium](https://pdfium.googlesource.com/pdfium/) draws the watermark into a
  separate one-page-per-size "stamp" PDF, and [qpdf](https://github.com/qpdf/qpdf)
  lays it onto the pages with `--overlay`/`--underlay`, which adds new content
  streams and leaves the original ones untouched (PDFium's own content
  regeneration was ruled out: it rewrites the whole page and drops shadings).
  Each copy references one form XObject, so a tiled logo is stored once, and
  copies are tagged as `/Artifact` for screen readers. The live preview is the
  real output for that page. Password-protected PDFs keep their password.
  Text uses the standard PDF fonts (WinAnsi); other characters are refused
  rather than silently replaced.

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

A tool that turns something into HTML and then into a PDF can reuse the
ironpress pipeline in `src/lib/html-pdf/` (engine adapter and loader, page
setup, worker handler, conversion state and the `usePdfConversion` hook) and
the converter page components (`CodeEditor`, `PageSettings`,
`ConversionActions`, `ConversionStatus`, `BetaNotice`), as Markdown to PDF and
HTML to PDF do.

## Large engines and the service worker

The service worker precaches every file in `out/` except those listed in
`ON_FIRST_USE` in `scripts/build-sw.mjs`. The ironpress binary (~15 MB, ~6 MB
gzipped) and PDFium (binary ~4.6 MB, ~2 MB gzipped, plus its JavaScript glue)
are on that list: each is cached the first time a tool loads it, so visitors who never use
those tools never download it, and the tools still work offline after first use. Markdown to PDF
and HTML to PDF load the same ironpress files, and the PDF Editor and Add Watermark the same
PDFium files, so using either tool of a pair caches the engine for both.

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

## Manual test checklist (HTML to PDF)

`fixtures/windows-1252.html` is saved in windows-1252, as Word's "Save as Web
Page" does, with a hidden paragraph and an image that is not embedded.

- [ ] The sample invoice converts to one A4 page; **Download PDF** saves
      `document.pdf`, and no "Some content is not in the PDF" notice appears.
- [ ] Opening `fixtures/windows-1252.html` shows `Café “Crème brûlée”` and
      `4,50 €` in the editor; the PDF shows them too, does not contain the
      hidden paragraph, is named `windows-1252.pdf`, and the page says
      "1 image was left out".
- [ ] `<p hidden>`, a closed `<details>` body and a closed `<dialog>` do not
      appear in the PDF; `<details open>` and `<dialog open>` do.
- [ ] An `@page { size: A5; margin: 0 }` rule in the HTML overrides the paper
      size and margin settings.
- [ ] A page with `<link rel="stylesheet">`, `<script>` and an
      `<img src="https://...">` converts, and the notice counts each of them.
- [ ] A `.md` or `.png` file is rejected with a toast; a file over 10 MB is
      refused.
- [ ] Editing the HTML after converting hides the old **Download PDF** button
      and the notice.
- [ ] **Cancel** stops a long conversion and the next one works.
- [ ] DevTools > Console shows no Content Security Policy errors after
      converting (with `pnpm build && pnpm preview`, which serves the real
      headers).
- [ ] Offline after one conversion: reload with DevTools > Network > Offline
      and convert again.

## Manual test checklist (Add Watermark)

- [ ] Open `fixtures/text-chromium.pdf`: the preview shows a grey diagonal
      "CONFIDENTIAL" in the middle; **Download PDF** saves
      `text-chromium-watermarked.pdf`, and its own text can still be
      selected and copied in a PDF reader.
- [ ] Each of the nine positions puts the watermark in that place as the page
      is displayed; **Tile across the page** repeats it over the whole page.
- [ ] Opacity, angle (slider and 0°/45°/90°/-45°), font, bold, size and colour
      change the preview after a short pause.
- [ ] Typing `₹` in the text shows "cannot be written in the standard PDF
      fonts" and disables **Download PDF**.
- [ ] **Picture:** pick a PNG with a transparent background; it is placed at
      40% of the page width and its background stays transparent. Tiled, the
      download is barely larger than with a single copy.
- [ ] **Under the content** on a scanned page: the watermark is hidden by the
      scan (expected); on a text page it shows between the lines.
- [ ] **Pages** `2-3` watermarks only those pages; the preview of page 1 says
      it is not watermarked; `9` on a 3-page file shows an error.
- [ ] `user-password.pdf`: wrong password shows "Wrong password"; `hunter2`
      opens it; the download still asks for `hunter2`.
- [ ] Offline after one use: reload with DevTools > Network > Offline, open a
      PDF and download it.
- [ ] At 360px width there is no horizontal scroll.

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

## Manual test checklist (Protect PDF)

Sample files live in `fixtures/` (`plain.pdf`, `owner-restricted.pdf`,
`user-password.pdf` with password `hunter2`).

- [ ] Choosing `plain.pdf` shows it as "Ready" with the password form; the
      **Protect PDF** button stays disabled until both fields match.
- [ ] A typo in **Confirm password** shows "The passwords do not match." as
      soon as it diverges; typing the right password never shows it.
- [ ] **Show passwords** reveals both fields; pressing it again hides them.
- [ ] A 128-character password shows "The password is too long"; `pass²`
      shows the "Some PDF apps may not accept this password" warning.
- [ ] **Protect PDF** then **Download protected PDF** saves
      `plain-protected.pdf`; Chrome, Firefox and a desktop reader ask for the
      password, refuse a wrong one and open it with the right one.
- [ ] Editing the password after protecting hides the old download button.
- [ ] `user-password.pdf` shows "Already protected" with a link to the PDF
      Unlocker; `owner-restricted.pdf` is protected and the page says its
      restrictions were replaced; `signed.pdf` is protected and the page warns
      that its signature is no longer valid in the protected copy.
- [ ] A `.png` is rejected with a toast; choosing two PDFs opens the first and
      says "Protect one file at a time".
- [ ] The protected file unlocks in the PDF Unlocker with its password.
- [ ] **Network tab** shows no upload and no third-party requests; it works
      offline after one visit.
- [ ] At 360px width there is no horizontal scroll.

## Manual test checklist (Merge PDFs)

Use the files in `fixtures/` (`user-password.pdf` has password `hunter2`).

- [ ] Add `plain.pdf` and `text-chromium.pdf`: each shows "Ready" and its page
      count; with one file, the button is disabled and says to add another.
- [ ] Move the second file up; the numbers change and focus stays on the
      moved row. The first row cannot move up, the last cannot move down.
- [ ] **Merge PDFs**, then **Download merged PDF** saves `plain-merged.pdf`;
      it opens with every page in the chosen order and text is selectable.
- [ ] Add `user-password.pdf`: the password prompt opens; a wrong password
      shows "Wrong password"; `hunter2` makes it "Ready". **Cancel** leaves an
      **Enter password** button and blocks merging until it is unlocked or
      removed.
- [ ] A `.txt` file is rejected with a toast; a renamed non-PDF shows
      "Cannot open" and blocks merging until removed.
- [ ] Changing the list after merging hides the old download button.
- [ ] While merging, the drop area and every list button are disabled.
- [ ] **Network tab** shows no upload and no third-party requests; it works
      offline after one visit.
- [ ] At 360px width there is no horizontal scroll.

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

PDF unlocking, password protection, watermarking and merging use **qpdf**, Copyright (c) Jay Berkenbilt, licensed under the
**Apache License 2.0** (qpdf is also available under the Artistic License 2.0).
The WebAssembly build is [`@jspawn/qpdf-wasm`](https://github.com/jsscheller/qpdf-wasm)
(Apache-2.0). The licence text ships at `/wasm/LICENSE.txt`, a notice at
`/wasm/NOTICE.txt`. qpdf is credited here.

Markdown to PDF and HTML to PDF use **ironpress**, Copyright (c) 2026 Gaston
Gouron, licensed under the **MIT License** (licence at
`/wasm/LICENSE-ironpress.txt`); Markdown to PDF also uses **marked**, licensed
under the **MIT License**. Fonts: Geist and
Inter (SIL Open Font License 1.1), bundled locally.

The PDF Editor and Add Watermark use **PDFium**, Copyright The PDFium Authors, licensed under
the **BSD 3-Clause License** and the **Apache License 2.0** (licence at
`/wasm/LICENSE-pdfium.txt`), compiled to WebAssembly by **@embedpdf/pdfium**,
Copyright (c) 2024 CloudPDF, Ji Chang, licensed under the **MIT License**
(licence at `/wasm/LICENSE-embedpdf-pdfium.txt`). Text measurements come from
Adobe's standard font metrics via **@pdf-lib/standard-fonts** (MIT License).
