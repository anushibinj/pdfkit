import { LockOpen } from "lucide-react";
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
    faq: [
      {
        q: "Is my PDF uploaded anywhere?",
        a: "No. The PDF is read by your browser and processed by qpdf compiled to WebAssembly, inside a Web Worker on your device. There is no server that receives your file.",
      },
      {
        q: "Can it crack a password I have forgotten?",
        a: "No. This tool does not guess or brute-force passwords. It removes restrictions or decrypts a file only when you can open it or know the password.",
      },
      {
        q: "What is the difference between an owner password and a user password?",
        a: "A user password is needed to open the file at all. An owner password only restricts actions such as printing, copying or editing; such files open without a password and can be unlocked automatically.",
      },
      {
        q: "Does it work offline?",
        a: "Yes. After your first visit the app is cached by a service worker, so it keeps working without a connection. You can also install it as an app.",
      },
      {
        q: "Is there a file size limit?",
        a: "There is no fixed limit, but the whole file is held in your browser's memory. Files over 500 MB show a warning and may fail on devices with little memory.",
      },
      {
        q: "Should I only unlock files I am allowed to?",
        a: "Yes. Only remove protection from documents you own or have permission to modify.",
      },
    ],
    component: () => import("./unlock"),
  },
];

export function getTool(slug: string): ToolDefinition | undefined {
  return tools.find((t) => t.slug === slug);
}
