import {
  FileCode,
  FilePen,
  LayoutGrid,
  LockOpen,
  ShieldCheck,
} from "lucide-react";
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
    tagline: "Edit PDF text in place, add drawings and images, locally.",
    description:
      "Free PDF editor in your browser. Change existing text in place, add text, drawings, highlights and images, and rotate or reorder pages. Nothing is uploaded.",
    keywords: [
      "pdf editor",
      "edit pdf text",
      "edit pdf online",
      "add text to pdf",
      "sign pdf",
      "rotate pdf pages",
      "private pdf editor",
    ],
    icon: FilePen,
    beta: true,
    component: () => import("./edit"),
  },
  {
    slug: "organize",
    name: "Organize Pages",
    tagline: "Reorder, rotate and combine pages from several PDFs, locally.",
    description:
      "Free PDF page organizer in your browser. Combine pages from several PDFs, reorder, rotate, duplicate or delete them, and add blank pages. Nothing is uploaded.",
    keywords: [
      "organize pdf pages",
      "reorder pdf pages",
      "rearrange pdf pages",
      "combine pdf pages",
      "interleave pdf pages",
      "rotate pdf pages",
      "delete pdf pages",
      "private pdf organizer",
    ],
    icon: LayoutGrid,
    beta: true,
    component: () => import("./organize"),
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
