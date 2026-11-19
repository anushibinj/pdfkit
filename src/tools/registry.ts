import { FileCode, FilePen, LockOpen, ShieldCheck } from "lucide-react";
import type { ToolDefinition } from "./types";

export type { ToolDefinition } from "./types";

/**
 * The single source of truth for tools. The landing grid, static params,
 * metadata, sitemap and OG images are all derived from this array.
 */
export const tools: ToolDefinition[] = [
  {
    slug: "unlock",
    name: "PDF Unlocker",
    tagline: "Remove PDF passwords and restrictions, locally.",
    description:
      "Free PDF unlocker that runs in your browser. Remove a PDF password you know, or lift printing, copying and editing restrictions. Files never leave your device.",
    keywords: [
      "unlock pdf",
      "remove pdf password",
      "remove pdf restrictions",
      "decrypt pdf",
      "private pdf tool",
      "offline pdf unlocker",
    ],
    icon: LockOpen,
    component: () => import("./unlock"),
  },
  {
    slug: "verify",
    name: "Signature Verifier",
    tagline: "Check PDF digital signatures, locally.",
    description:
      "Free PDF signature verifier that runs in your browser. Check that a signed PDF is unmodified and its signature is correct, then export it with a green tick.",
    keywords: [
      "verify pdf signature",
      "check pdf digital signature",
      "validate signed pdf",
      "pdf signature checker",
      "offline pdf verifier",
    ],
    icon: ShieldCheck,
    beta: true,
    component: () => import("./verify"),
  },
  {
    slug: "markdown-to-pdf",
    name: "Markdown to PDF",
    tagline: "Turn Markdown into a styled PDF with your own CSS, locally.",
    description:
      "Free Markdown to PDF converter that runs in your browser. Style the document with your own CSS, pick the paper size, and download the PDF. Nothing is uploaded.",
    keywords: [
      "markdown to pdf",
      "convert markdown to pdf",
      "md to pdf",
      "markdown pdf custom css",
      "offline markdown converter",
      "private markdown to pdf",
    ],
    icon: FileCode,
    beta: true,
    component: () => import("./markdown"),
  },
  {
    slug: "edit",
    name: "PDF Editor",
    tagline: "Add text, drawings, images and white-out to a PDF, locally.",
    description:
      "Free PDF editor that runs in your browser. Add text, drawings, highlights, images and white-out, and rotate, reorder or delete pages. Nothing is uploaded.",
    keywords: [
      "pdf editor",
      "edit pdf online",
      "add text to pdf",
      "sign pdf",
      "white out pdf",
      "rotate pdf pages",
      "private pdf editor",
    ],
    icon: FilePen,
    beta: true,
    component: () => import("./edit"),
  },
];

/**
 * Look a tool up by its URL segment.
 *
 * @param slug For example "edit" (from /tools/edit/).
 * @returns The tool, or `undefined` for an unknown slug.
 */
export function getTool(slug: string): ToolDefinition | undefined {
  return tools.find((t) => t.slug === slug);
}
