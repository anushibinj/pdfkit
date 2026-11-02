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

      <section
        aria-labelledby="verify-heading"
        className="mt-16 max-w-2xl space-y-3"
      >
        <h2 id="verify-heading" className="text-xl font-semibold">
          How to verify nothing is uploaded
        </h2>
        <p className="text-muted-foreground">
          You do not have to take our word for it. Check it yourself:
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>
            Open your browser&apos;s developer tools (F12, or Ctrl/Cmd +
            Shift + I) and switch to the <strong>Network</strong> tab.
          </li>
          <li>Open a tool and add a PDF.</li>
          <li>
            Watch the Network tab while the file is processed. You will see no
            request carrying your file, and no requests to other websites.
          </li>
          <li>
            For extra proof, switch the browser to offline mode. The tools
            keep working.
          </li>
        </ol>
      </section>
    </>
  );
}
