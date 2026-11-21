import {
  CodeXml,
  FileCode,
  FilePen,
  Lock,
  LockOpen,
  ShieldCheck,
  Stamp,
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
    slug: "protect",
    name: "Protect PDF",
    tagline: "Add a password to a PDF, locally.",
    description:
      "Free PDF password protector that runs in your browser. Add a password with AES-256 encryption so only people who know it can open the PDF. Nothing is uploaded.",
    keywords: [
      "protect pdf",
      "password protect pdf",
      "add password to pdf",
      "encrypt pdf",
      "lock pdf",
      "aes-256 pdf encryption",
      "private pdf tool",
    ],
    icon: Lock,
    beta: true,
    component: () => import("./protect"),
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
    slug: "html-to-pdf",
    name: "HTML to PDF",
    tagline: "Turn HTML and its CSS into a PDF, locally.",
    description:
      "Free HTML to PDF converter that runs in your browser. Paste HTML or open a file, keep its own CSS, pick the paper size and download a PDF. Nothing is uploaded.",
    keywords: [
      "html to pdf",
      "convert html to pdf",
      "html file to pdf",
      "save html as pdf",
      "offline html to pdf",
      "private html to pdf converter",
    ],
    icon: CodeXml,
    beta: true,
    component: () => import("./html"),
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
    slug: "watermark",
    name: "Add Watermark",
    tagline: "Stamp text or a logo on PDF pages, locally.",
    description:
      "Free PDF watermark tool in your browser. Add text or a logo to every page or chosen pages, set opacity, angle and position, then download. Nothing is uploaded.",
    keywords: [
      "add watermark to pdf",
      "pdf watermark",
      "watermark pdf online",
      "confidential watermark pdf",
      "add logo to pdf",
      "private pdf watermark",
    ],
    icon: Stamp,
    beta: true,
    component: () => import("./watermark"),
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
