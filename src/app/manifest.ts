import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${site.name}: private PDF tools`,
    short_name: site.name,
    description: site.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: site.themeColor.dark,
    theme_color: site.themeColor.light,
    categories: ["utilities", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
