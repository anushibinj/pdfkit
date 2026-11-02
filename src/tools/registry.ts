import { LockOpen, ShieldCheck } from "lucide-react";
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
];

export function getTool(slug: string): ToolDefinition | undefined {
  return tools.find((t) => t.slug === slug);
}
