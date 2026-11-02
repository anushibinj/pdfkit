# pdfkit

Private PDF tools that run entirely in your browser. Files are processed on
your device with WebAssembly inside Web Workers and are **never uploaded**.

Currently shipped tools:

- **PDF Unlocker** (`/tools/unlock/`): removes owner restrictions and decrypts
  files whose password you know, using [qpdf](https://github.com/qpdf/qpdf)
  compiled to WASM. It does not crack or guess passwords.

Built with Next.js (App Router, static export), TypeScript (strict), Tailwind
CSS, shadcn/ui, next-themes and Vitest. It is an installable, offline-capable PWA.

## How privacy is enforced

- **No server code.** `output: 'export'` produces plain static files in `out/`.
  There is nothing to upload to.
- **Work happens in a Web Worker.** The file is read with `File.arrayBuffer()`
  and handed to the worker as a transferred `ArrayBuffer`. qpdf runs against an
  in-memory virtual file system that is cleaned up after every job.
- **Same-origin only.** The `.wasm` and its loader are served from `/wasm/`
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

| Variable               | Purpose                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
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
`/wasm/NOTICE.txt`. qpdf is credited here. Fonts: Geist and
Inter (SIL Open Font License 1.1), bundled locally.
