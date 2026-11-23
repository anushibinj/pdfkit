import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

export interface BetaNote {
  /** Heading, e.g. "Beta: what the PDF engine can and cannot do yet" */
  title: string;
  /** Bullet points explaining current limitations or beta behavior */
  items: string[];
  /** Optional closing note shown below the list */
  footer?: string;
}

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
  /** Extended explanation shown in a popover when hovering the "Beta" label */
  betaNote?: BetaNote;
  icon: LucideIcon;
  /** Lazy client UI, only loaded on the tool's own page */
  component: () => Promise<{ default: ComponentType }>;
}
