import {
  CodeXml,
  Combine,
  FileCode,
  FileImage,
  FilePen,
  Images,
  LayoutGrid,
  Lock,
  LockOpen,
  Scissors,
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
  {
    slug: "merge",
    name: "Merge PDFs",
    tagline: "Combine several PDFs into one, in any order, locally.",
    description:
      "Free PDF merger that runs in your browser. Combine several PDFs into one file in any order, including password-protected ones. Files never leave your device.",
    keywords: [
      "merge pdf",
      "combine pdf",
      "join pdf files",
      "merge pdf offline",
      "merge password protected pdf",
      "private pdf merger",
    ],
    icon: Combine,
    beta: true,
    component: () => import("./merge"),
  },
  {
    slug: "split",
    name: "Split PDF",
    tagline: "Split a PDF, extract pages or remove pages, locally.",
    description:
      "Free PDF splitter that runs in your browser. Split a PDF into several files, extract the pages you pick, or remove pages. Your files are never uploaded.",
    keywords: [
      "split pdf",
      "extract pdf pages",
      "remove pages from pdf",
      "delete pdf pages",
      "separate pdf pages",
      "private pdf splitter",
    ],
    icon: Scissors,
    beta: true,
    component: () => import("./split"),
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
  {
    slug: "pdf-to-images",
    name: "PDF to Images",
    tagline: "Save pages as PNG or JPEG, or extract embedded images, locally.",
    description:
      "Free PDF to image converter in your browser. Save pages as PNG or JPEG at the DPI you choose, or extract the original embedded images. Nothing is uploaded.",
    keywords: [
      "pdf to image",
      "pdf to png",
      "pdf to jpg",
      "convert pdf pages to images",
      "extract images from pdf",
      "pdf image extractor",
      "private pdf to image",
    ],
    icon: FileImage,
    beta: true,
    component: () => import("./pdf-to-images"),
  },
  {
    slug: "images-to-pdf",
    name: "Images to PDF",
    tagline: "Combine PNG and JPEG images into one PDF, locally.",
    description:
      "Free images to PDF converter in your browser. Combine PNG and JPEG photos into one PDF, reorder or rotate pages, and pick paper size. Nothing is uploaded.",
    keywords: [
      "images to pdf",
      "jpg to pdf",
      "png to pdf",
      "convert images to pdf",
      "photos to pdf",
      "combine images into pdf",
      "private images to pdf",
    ],
    icon: Images,
    beta: true,
    component: () => import("./images-to-pdf"),
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
