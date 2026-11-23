import {
  CodeXml,
  Combine,
  Crop,
  FileCode,
  FileDiff,
  FileDown,
  FileImage,
  FilePen,
  Images,
  LayoutGrid,
  Lock,
  LockOpen,
  ScanText,
  Scissors,
  ShieldCheck,
  Stamp,
  Wrench,
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
    betaNote: {
      title: "Beta: how password protection works",
      items: [
        "Encrypts the PDF with AES-256 locally in your browser using qpdf WebAssembly.",
        "Existing digital signatures are invalidated when a file is re-encrypted.",
      ],
    },
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
    betaNote: {
      title: "Beta: signature checks are limited for now",
      items: [
        "We check that the signed content is unchanged and that the signature is cryptographically correct.",
        'We do not yet check who signed. Certificates are not validated against a trusted list (such as Adobe or EU trust lists) or for revocation, so a green tick means "signature intact", not "signer trusted".',
        "The tick is added as an annotation after the original signature. The signature stays valid, but some PDF readers will report a change made after signing.",
      ],
      footer: "We are working on full certificate and revocation checks.",
    },
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
    betaNote: {
      title: "Beta: what the PDF engine can and cannot do yet",
      items: [
        "Fonts cover Latin, Greek, Cyrillic, Hebrew and Arabic. Indic scripts (such as Devanagari), Chinese, Japanese, Korean and emoji do not display correctly yet.",
        "Use the font families sans-serif, serif or monospace; other names fall back to one of them.",
        "Images that point to the web or to files on your computer are not included.",
      ],
    },
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
    betaNote: {
      title: "Beta: what the PDF engine can and cannot do yet",
      items: [
        "Only what is inside the HTML is used: CSS in <style> elements and style attributes, and PNG or JPEG images embedded as data: URLs. Linked stylesheets, images from the web or your computer, and scripts are left out; you are told after converting.",
        "Fonts cover Latin, Greek, Cyrillic, Hebrew and Arabic, in sans-serif, serif and monospace styles (look-alikes of Arial, Times New Roman and Courier New); other font families, including web fonts, fall back to one of them. Indic scripts (such as Devanagari), Chinese, Japanese, Korean and emoji do not display correctly yet.",
        "An @page rule in the HTML sets the paper size and margins, and overrides the page settings below.",
      ],
    },
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
    betaNote: {
      title: "Beta: what the editor can and cannot do yet",
      items: [
        "Change the PDF's own text in place with Edit text: click a line and type. The line keeps its font when the file's font has every character you type; otherwise it switches to the closest standard font (Helvetica, Times or Courier) in the same place, size and colour.",
        "Add text, drawings, boxes, highlights and pictures (such as a signature); rotate, reorder or delete pages.",
        "Text in scanned pages (pictures of text) and in some reused page parts cannot be edited. New and substituted text uses the standard PDF fonts, which cover English and other Western European languages, not other scripts (such as Devanagari, Chinese or Arabic) or emoji.",
        "Editing a digitally signed PDF invalidates its signatures.",
      ],
    },
    component: () => import("./edit"),
  },
  {
    slug: "crop",
    name: "Crop PDF",
    tagline: "Crop PDF pages and remove what lies outside, locally.",
    description:
      "Free PDF cropper that runs in your browser. Trim page margins and remove what lies outside the crop, so hidden parts cannot be restored. Nothing is uploaded.",
    keywords: [
      "crop pdf",
      "crop pdf pages",
      "trim pdf margins",
      "remove cropped content from pdf",
      "cut pdf page",
      "private pdf cropper",
      "offline pdf crop",
    ],
    icon: Crop,
    beta: true,
    betaNote: {
      title: "Beta: how cropping works",
      items: [
        "Crops every chosen page and removes content outside the crop box.",
        "Cropping a digitally signed PDF invalidates its signatures.",
      ],
    },
    component: () => import("./crop"),
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
    betaNote: {
      title: "Beta: what the watermark tool can and cannot do yet",
      items: [
        "Text watermarks use the standard PDF fonts (Helvetica, Times, Courier), which cover English and other Western European languages, not other scripts (such as Devanagari, Chinese or Arabic) or emoji. For those, use a picture of the text.",
        "The page content is not rewritten: the watermark is added on top of it or underneath it. Password-protected PDFs keep their password.",
        "Adding a watermark invalidates the PDF's digital signatures.",
      ],
    },
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
    betaNote: {
      title: "Beta: what is and is not kept",
      items: [
        "Every page is copied as it is: text, images, links, comments and form fields stay, and nothing is re-compressed.",
        "Bookmarks (the outline) and document properties such as the title are not carried over.",
        "The merged file has no password, and digital signatures in the original files are no longer valid in it.",
      ],
    },
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
    betaNote: {
      title: "Beta: what is and is not kept",
      items: [
        "Pages are copied as they are: text, images, comments, form fields and links between kept pages stay, and nothing is re-compressed.",
        "The new files keep the original's password and document properties such as the title.",
        "Bookmarks and links that pointed to a page left out no longer go anywhere, and digital signatures are no longer valid in the new files.",
      ],
    },
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
    betaNote: {
      title: "Beta: what the organizer can and cannot do yet",
      items: [
        "Add several PDFs: their pages appear on one board, numbered and coloured by file. Drag pages (or press Ctrl or ⌘ with the arrow keys) to reorder them; Ctrl, ⌘ or Shift with a click selects several.",
        "Rotate, duplicate or delete pages, insert blank pages, reverse the order, or interleave a double-sided scan (fronts, then backs in reverse). Rotating only turns the page: text stays text.",
        "The download is a new PDF made of the pages. Bookmarks, form fields and document properties are not carried over, links between pages may stop working, digital signatures are not kept, and files opened with a password are saved without one.",
      ],
    },
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
    betaNote: {
      title: "Beta: how image export works",
      items: [
        "Renders PDF pages to PNG or JPEG, or extracts original embedded images locally.",
        "Very large or high-DPI pages may take longer depending on device memory.",
      ],
    },
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
    betaNote: {
      title: "Beta: how images are embedded",
      items: [
        "JPEG photos are embedded as their original compressed bytes without re-encoding, keeping quality intact and file sizes small.",
        "PNG images preserve transparency as a PDF soft mask, and each image becomes one page in the order listed.",
        "All processing runs locally in your browser with PDFium WebAssembly; no images leave your device.",
      ],
    },
    component: () => import("./images-to-pdf"),
  },
  {
    slug: "repair",
    name: "Repair PDF",
    tagline: "Fix damaged, corrupt or unreadable PDFs, locally.",
    description:
      "Free PDF repair tool that runs in your browser. Fix damaged, corrupt or unreadable PDF files and rebuild broken cross-reference tables. Nothing is uploaded.",
    keywords: [
      "repair pdf",
      "fix damaged pdf",
      "corrupt pdf repair",
      "recover broken pdf",
      "rebuild pdf xref",
      "fix pdf online",
      "private pdf repair",
    ],
    icon: Wrench,
    beta: true,
    betaNote: {
      title: "Beta: how PDF repair works",
      items: [
        "Carves undamaged indirect PDF objects from corrupt or truncated files using WebAssembly byte scanning.",
        "Rebuilds missing headers, cross-reference tables, and trailer dictionaries directly in your browser.",
        "All processing runs client-side; your sensitive documents are never uploaded to any server.",
      ],
    },
    component: () => import("./repair"),
  },
  {
    slug: "compress",
    name: "Compress PDF",
    tagline: "Shrink PDF file sizes or fit under a target MB limit, locally.",
    description:
      "Free PDF compressor that runs in your browser. Shrink PDFs with lossless, balanced, or custom DPI presets, or fit under a target MB limit. Nothing is uploaded.",
    keywords: [
      "compress pdf",
      "reduce pdf size",
      "shrink pdf",
      "make pdf under 2mb",
      "optimize pdf",
      "compress pdf offline",
      "private pdf compressor",
    ],
    icon: FileDown,
    beta: true,
    betaNote: {
      title: "Beta: how PDF compression works",
      items: [
        "Lossless mode deduplicates identical streams, recompresses Flate streams at level 9, and optimizes object streams with qpdf without changing appearance.",
        "Balanced, Small, Custom, and Target size modes downsample and re-encode opaque images to JPEG while preserving transparent PNG soft masks.",
        "If an image or document does not shrink, the original bytes are kept so files never grow.",
      ],
    },
    component: () => import("./compress"),
  },
  {
    slug: "compare",
    name: "Compare PDFs",
    tagline: "Compare two PDFs for text and visual differences, locally.",
    description:
      "Free PDF comparison tool in your browser. Compare two PDFs side by side for word-level text differences and visual pixel overlays. Nothing is uploaded.",
    keywords: [
      "compare pdf",
      "pdf diff",
      "compare two pdfs",
      "pdf text comparison",
      "visual pdf compare",
      "pdf revision compare",
      "private pdf compare",
    ],
    icon: FileDiff,
    beta: true,
    betaNote: {
      title: "Beta: how PDF comparison works",
      items: [
        "Text mode aligns pages by similarity so inserted or removed pages do not mark later pages as changed, and highlights word-level insertions and deletions.",
        "Visual mode renders pages at equal DPI and tints per-pixel differences, catching moved logos, drawings, and layout shifts.",
        "Exported comparison reports embed standard PDF Highlight annotations visible in Adobe Acrobat and other readers.",
      ],
    },
    component: () => import("./compare"),
  },
  {
    slug: "ocr",
    name: "OCR PDF",
    tagline: "Make scanned PDFs and images searchable, incl. Indian languages.",
    description:
      "Free PDF OCR in your browser. Turn scanned PDFs or images into searchable PDFs with English and 10 Indian languages, plus text export. Nothing is uploaded.",
    keywords: [
      "ocr pdf",
      "searchable pdf",
      "pdf ocr hindi",
      "indian language ocr",
      "scanned pdf to searchable pdf",
      "image to searchable pdf",
      "offline pdf ocr",
      "private pdf ocr",
    ],
    icon: ScanText,
    beta: true,
    betaNote: {
      title: "Beta: how client-side OCR works",
      items: [
        "Recognizes English and 10 Indian languages (Hindi, Bengali, Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Punjabi, Odia) locally using self-hosted Tesseract WebAssembly.",
        "Adds an invisible Unicode text layer over your original pages via qpdf so the output looks pixel-identical to the input.",
        "Pages that already contain selectable text are skipped automatically unless you enable Redo OCR.",
      ],
    },
    component: () => import("./ocr"),
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
