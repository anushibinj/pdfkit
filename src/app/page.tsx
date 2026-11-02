import { ToolGrid } from "@/components/tool-grid";
import { site } from "@/lib/site";
import { tools } from "@/tools/registry";

export default function HomePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
    url: site.url,
    description: site.description,
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <section className="py-12 sm:py-20">
        <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-balance sm:text-5xl">
          PDF tools that run entirely in your browser.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">
          Your files never leave your device.
        </p>
      </section>

      <section aria-labelledby="tools-heading">
        <h2 id="tools-heading" className="mb-4 text-xl font-semibold">
          Tools
        </h2>
        <ToolGrid tools={tools} />
      </section>
    </>
  );
}
