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
- **Split PDF** (`/tools/split/`, beta): splits a PDF into several files
  (every N pages, or one file per typed range such as `1-3, 4-8, 9-`),
  extracts the pages you pick into a new file, or removes the pages you pick.
  Pages are picked by clicking thumbnails (Shift-click picks a stretch) or by
  typing page numbers (the same syntax as Add Watermark's page field). Several
  files download as one ZIP. Each file is made by qpdf with the source as the
  primary file (`--pages . <range>`, in a job JSON file), so it keeps the
  original's password, document properties and the form fields of the kept
  pages; pages left out are not written at all. Bookmarks and links that
  pointed to a left-out page no longer go anywhere. A long split first copies
  short stretches into temporary parts, because each qpdf run reads the whole
  source: 1000 single-page files take about 19 s instead of about 5 minutes.
  Thumbnails are drawn by PDFium.
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
- **Crop PDF** (`/tools/crop/`, beta): crops pages by margins (typed in
  millimetres or dragged on the page, measured on the page as displayed) on
  all pages or a page range. A plain crop only hides what lies outside (it
  sets the CropBox, and anyone can undo it). **Remove what's outside**
  deletes it from the file: text glyph by glyph, drawings, pictures, form
  XObjects (trimmed copies where they cross the edge) and annotations, and
  shrinks the MediaBox, using **pdf-crop**, this repository's own Rust
  library compiled to WASM (`crates/pdf-crop`, see its README for why and
  how). Content inside the crop area is kept intact, and every
  cropped page is then checked against the original with PDFium; a result
  that differs inside the crop area is never offered. Pictures crossing the
  edge are kept whole, and text in fonts that cannot be measured exactly is
  kept; the result lists both. Encrypted PDFs are refused (unlock them
  first).
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
- **PDF to Images** (`/tools/pdf-to-images/`, beta): saves pages as PNG or
  JPEG at the resolution you choose (72 to 600 DPI; a page larger than
  4096 x 4096 = 16.7 million pixels, the iOS canvas limit, is scaled down to
  fit), or extracts the images embedded in the PDF at their own pixel size,
  using [PDFium](https://pdfium.googlesource.com/pdfium/). JPEG photos are
  saved as their original bytes (no re-encoding) when their colours are gray
  or RGB and they have no transparency; every other image, a JPEG with a
  soft mask included, is decoded and saved as a lossless PNG with its
  transparency. An image used on many pages is extracted once. Files
  download one by one or as a ZIP. Images cropped by a clip path come out
  whole but without transparency, images inside annotations or patterns are
  not extracted, and a gray or RGB JPEG stored with an inverting /Decode
  array (rare) is kept as stored.

- **Images to PDF** (`/tools/images-to-pdf/`, beta): turns PNG and JPEG images
  into a single PDF in the order you choose, using
  [PDFium](https://pdfium.googlesource.com/pdfium/) inside a Web Worker (reuses
  the same cached WASM build, no extra download). JPEG photos are embedded as
  their original compressed bytes (`/DCTDecode`, no re-encoding) and PNG images
  keep their transparency as a soft mask. Each image can be reordered or rotated
  in 90° steps, placed on Fit-to-image, A4, Letter, or Legal pages with Auto,
  Portrait, or Landscape orientation, custom margins (0–50 mm), and Fit or
  Actual-size (72 DPI) scaling.
- **Repair PDF** (`/tools/repair/`, beta): recovers damaged, truncated or corrupt
  PDFs locally using a two-tier recovery engine. Broken cross-reference tables,
  missing or corrupted headers (`%PDF-`), missing EOF markers (`%%EOF`), and
  malformed trailers are reconstructed via custom WebAssembly byte scanning
  (`crates/pdf-repair`) and normalized through PDFium. Nothing is uploaded.
- **Compress PDF** (`/tools/compress/`, beta): shrinks PDF file sizes in your
  browser with **Lossless**, **Balanced** (150 DPI, 0.75 quality), **Small**
  (100 DPI, 0.60 quality), **Custom** (DPI, quality, grayscale), and **Target
  size** ("make it under X MB") modes. Combines `crates/pdf-compress`
  WebAssembly (stream deduplication, Flate level-9 recompression, area-averaged
  image downsampling, baseline JPEG encoding, `/SMask` transparency preservation),
  [qpdf](https://github.com/qpdf/qpdf) object-stream optimization, and
  [PDFium](https://pdfium.googlesource.com/pdfium/) image decoding and
  side-by-side before/after page previews. Supports batch compression and ZIP
  downloads; files are never expanded and never leave your device.

Built with Next.js (App Router, static export), TypeScript (strict), Tailwind
CSS, shadcn/ui, next-themes and Vitest, plus two Rust crates compiled to
WebAssembly (`crates/pdf-crop` and `crates/pdf-repair`). It is an installable, offline-capable PWA.

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
pnpm wasm:crop        # rebuild crates/pdf-crop/dist/pdf_crop.wasm (needs rustup; output is committed)
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
and HTML to PDF load the same ironpress files, and the PDF Editor, Add Watermark, Split PDF
(thumbnails), Organize Pages, PDF to Images and Crop PDF the same PDFium files, so using any tool of a group caches its
engine for the others. The pdf-crop module (~1 MB, ~390 KB gzipped) and its dependencies' licence
texts are on the list too.

## Manual test checklist (PDF to Images)

`fixtures/images-chromium.pdf` is printed by Chromium (see
`scripts/make-images-fixture.mjs`): a transparent PNG, a JPEG drawn twice, a
JPEG cropped by CSS. `images-chromium-green.jpg` and `-purple.jpg` are its
source JPEGs.

- [ ] **Pages as images** on `fixtures/images-chromium.pdf`: Convert pages
      gives `images-chromium-page-01.png`, 625 x 313 px at 150 DPI.
- [ ] JPEG at 300 DPI gives a 1250 x 625 `.jpg`; the Quality select only
      shows for JPEG.
- [ ] **Pages** field: `2` on a one-page PDF shows "There is no page 2" and
      disables Convert; `1-3, 5` converts those pages of a longer PDF.
- [ ] **Embedded images** on the same file: 3 images. `image-02.jpg` and
      `image-03.jpg` are byte-identical to the two source JPEGs (the cropped
      one included); `image-01.png` keeps its half-transparent right half;
      the repeated JPEG shows once.
- [ ] **Download all (ZIP)** gives `images-chromium-images.zip`; it opens in
      the OS's archive tool with all files.
- [ ] **Stop** during a long conversion keeps the pages done so far.
- [ ] `user-password.pdf`: wrong password shows "Wrong password"; `hunter2`
      opens it.
- [ ] A 600 DPI A3 page says it was rendered at a lower resolution.
- [ ] Offline after one use: reload with DevTools > Network > Offline and
      convert again. The Network tab shows no request to another host.
- [ ] At 360px width there is no horizontal scroll.

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

## Manual test checklist (Crop PDF)

Use `fixtures/text-chromium.pdf` (Chromium output with subset fonts) and
`fixtures/plain.pdf`.

- [ ] Opening a PDF shows page 1 with the crop frame on the whole page;
      the arrows show the other pages.
- [ ] Dragging a corner or edge handle changes the margin fields, and
      typing a margin moves the frame; dragging inside the frame moves it.
- [ ] Margins that leave nothing show "The margins leave nothing to keep"
      and **Crop PDF** says which page; **Reset margins** clears them.
- [ ] "Only these pages" with `1-2, 9` explains that page 9 does not exist.
- [ ] With **Remove what's outside** (default): cropping shows the
      progress, then a summary of what was removed; the download
      (`<name>-cropped.pdf`) opens at the cropped size, and the text cut
      off can no longer be found or copied in a PDF reader.
- [ ] Without it: the result says the content is only hidden, and a
      reader's "page boxes" or text search still finds it.
- [ ] `fixtures/owner-restricted.pdf` is refused with a pointer to the PDF
      Unlocker.
- [ ] Offline after one crop: reload with DevTools > Network > Offline,
      open a PDF and crop it.
- [ ] At 360px width there is no horizontal scroll, and the handles can be
      dragged with a finger.

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

## Manual test checklist (Split PDF)

Sample files live in `fixtures/` (`user-password.pdf` has password `hunter2`).

- [ ] Opening a PDF shows its name, page count and size, the three modes and
      a thumbnail per page; thumbnails far off screen are drawn when scrolled
      to, and stay drawn when switching modes.
- [ ] **Split, every 1 page** of a 3-page PDF: "Split into 3 files" makes
      `<name>-page-1.pdf` ... `-page-3.pdf`; **Download all (.zip)** saves
      `<name>-split.zip`, which unzips (Explorer, Finder, `unzip -t`) into the
      three files, each opening with the right page.
- [ ] **Split, custom ranges** `1-2, 9` on a 3-page file says "There is no
      page 9" and disables the button; `1-2, 3` makes two files.
- [ ] **Extract pages:** clicking pages 1 and 3 fills the field with `1, 3`;
      Shift-click picks a stretch; typing `2-3` selects those thumbnails.
      "Extract 2 pages" makes `<name>-extracted.pdf` with only those pages.
- [ ] **Remove pages:** picked pages show a red cross; picking every page is
      refused; "Remove 1 page" makes `<name>-pages-removed.pdf`, and text of the
      removed page cannot be found in it.
- [ ] Changing any setting after making files hides the old results.
- [ ] A fillable form: the extracted pages' fields can still be filled in.
- [ ] `user-password.pdf`: the password dialog appears, `hunter2` opens it,
      and the made file still asks for `hunter2`.
- [ ] Splitting a long file (300+ pages) every page shows progress; **Cancel**
      stops it and the next split works.
- [ ] Offline after one use: reload with DevTools > Network > Offline, open a
      PDF and split it.
- [ ] At 360px width there is no horizontal scroll and thumbnails show two
      per row.

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

PDF unlocking, password protection, watermarking, merging and splitting use **qpdf**, Copyright (c) Jay Berkenbilt, licensed under the
**Apache License 2.0** (qpdf is also available under the Artistic License 2.0).
The WebAssembly build is [`@jspawn/qpdf-wasm`](https://github.com/jsscheller/qpdf-wasm)
(Apache-2.0). The licence text ships at `/wasm/LICENSE.txt`, a notice at
`/wasm/NOTICE.txt`. qpdf is credited here.

Markdown to PDF and HTML to PDF use **ironpress**, Copyright (c) 2026 Gaston
Gouron, licensed under the **MIT License** (licence at
`/wasm/LICENSE-ironpress.txt`); Markdown to PDF also uses **marked**, licensed
under the **MIT License**. Fonts: Geist and
Inter (SIL Open Font License 1.1), bundled locally.

Crop PDF uses **pdf-crop** (`crates/pdf-crop`, part of this repository),
which links [lopdf](https://github.com/J-F-Liu/lopdf) (MIT) and other Rust
crates under MIT, Apache-2.0, BSD, Zlib and Unicode licences; their texts
ship at `/wasm/LICENSE-pdf-crop-third-party.txt`. Its standard font metrics
come from Adobe's Core 14 AFM files via **@pdf-lib/standard-fonts** (MIT),
and its encoding tables from ISO 32000-1 Annex D as transcribed by
**pdf.js**, Copyright 2012 Mozilla Foundation (Apache License 2.0). It shows
and checks pages with PDFium (below).

The PDF Editor, Add Watermark, Split PDF's thumbnails, Organize Pages, PDF
to Images, Images to PDF and Crop PDF use **PDFium**, Copyright The PDFium Authors, licensed under the **BSD 3-Clause
License** and the **Apache License 2.0** (licence at
`/wasm/LICENSE-pdfium.txt`), compiled to WebAssembly by **@embedpdf/pdfium**,
Copyright (c) 2024 CloudPDF, Ji Chang, licensed under the **MIT License**
(licence at `/wasm/LICENSE-embedpdf-pdfium.txt`). Text measurements come from
Adobe's standard font metrics via **@pdf-lib/standard-fonts** (MIT License).
PDF to Images' PNG encoder (`src/lib/png`) is part of this project;
compression uses the browser's built-in `CompressionStream`.
