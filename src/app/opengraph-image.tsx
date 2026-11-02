import { FileLock2 } from "lucide-react";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og";
import { site } from "@/lib/site";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "pdfkit: private PDF tools that run in your browser";

export default async function Image() {
  return renderOgCard({
    title: "Private PDF tools",
    tagline: `${site.tagline}. Your files never leave your device.`,
    icon: FileLock2,
  });
}
