import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";
import { tools } from "@/tools/registry";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl("/"), changeFrequency: "monthly", priority: 1 },
    ...tools.map((tool) => ({
      url: absoluteUrl(`/tools/${tool.slug}/`),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
