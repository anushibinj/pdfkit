import Link from "next/link";
import { site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-5xl space-y-2 px-4 py-8 text-sm text-muted-foreground">
        <p>
          <Link href="/" className="font-medium text-foreground">
            {site.name}
          </Link>{" "}
          processes files on your device. Nothing is uploaded.
        </p>
        <p>
          PDF unlocking is powered by{" "}
          <a
            href="https://github.com/qpdf/qpdf"
            className="underline underline-offset-4"
            target="_blank"
            rel="noopener noreferrer"
          >
            qpdf
          </a>
          , compiled to WebAssembly (
          <a
            href="https://github.com/jsscheller/qpdf-wasm"
            className="underline underline-offset-4"
            target="_blank"
            rel="noopener noreferrer"
          >
            qpdf-wasm
          </a>
          ). qpdf is licensed under the Apache License 2.0; see the{" "}
          <a
            href="https://github.com/qpdf/qpdf/blob/main/LICENSE.txt"
            className="underline underline-offset-4"
            target="_blank"
            rel="noopener noreferrer"
          >
            qpdf licence
          </a>
          .
        </p>
      </div>
    </footer>
  );
}
