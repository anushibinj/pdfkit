import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

export interface ToolDefinition {
  /** URL segment, e.g. "unlock" -> /tools/unlock/ */
  slug: string;
  /** Display name, e.g. "PDF Unlocker" */
  name: string;
  /** Short line used on cards and OG images */
  tagline: string;
  /** Meta description, 150-160 characters */
  description: string;
  keywords: string[];
  /** Shows a "Beta" label on the tool card and the tool page */
  beta?: boolean;
  icon: LucideIcon;
  /** Lazy client UI, only loaded on the tool's own page */
  component: () => Promise<{ default: ComponentType }>;
}
