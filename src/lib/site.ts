export const site = {
  name: "pdfkit",
  tagline: "PDF tools that run entirely in your browser",
  description:
    "Private PDF tools that run entirely in your browser. Your files are processed on your device with WebAssembly and are never uploaded.",
  locale: "en_US",
  url: (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(
    /\/+$/,
    "",
  ),
  themeColor: { light: "#ffffff", dark: "#0a0a0a" },
} as const;

/** Absolute URL for a site path such as "/tools/unlock/". */
export function absoluteUrl(path: string): string {
  return `${site.url}${path.startsWith("/") ? path : `/${path}`}`;
}
