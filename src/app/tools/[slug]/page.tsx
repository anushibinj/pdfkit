import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ToolLoader } from "@/components/tool-loader";
import { absoluteUrl, site } from "@/lib/site";
import { getTool, tools } from "@/tools/registry";

export const dynamicParams = false;

export function generateStaticParams() {
  return tools.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/tools/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) return {};
  const path = `/tools/${tool.slug}/`;
  const title = `${tool.name} | ${site.name}`;
  return {
    title: { absolute: title },
    description: tool.description,
    keywords: tool.keywords,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      siteName: site.name,
      locale: site.locale,
      title,
      description: tool.description,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: tool.description,
    },
  };
}

const DEFAULT_STEPS = [
  "Add your files. They are read by your browser and never sent anywhere.",
  "The work is done on your device by WebAssembly running in a Web Worker.",
  "Download the result.",
];

export default async function ToolPage({
  params,
}: PageProps<"/tools/[slug]">) {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) notFound();

  const webApp = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: tool.name,
    url: absoluteUrl(`/tools/${tool.slug}/`),
    description: tool.description,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript and WebAssembly",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: tool.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  const steps = tool.howItWorks ?? DEFAULT_STEPS;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webApp) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />
      <nav aria-label="Breadcrumb" className="pt-6 text-sm text-muted-foreground">
        <Link href="/" className="underline underline-offset-4">
          All tools
        </Link>
      </nav>
      <section className="py-6 sm:py-10">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {tool.name}
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
          {tool.description}
        </p>
      </section>

      <section aria-label={tool.name}>
        <ToolLoader slug={tool.slug} />
      </section>

      <div className="mt-16 max-w-2xl space-y-12">
        <section aria-labelledby="how-heading" className="space-y-3">
          <h2 id="how-heading" className="text-2xl font-semibold">
            How it works
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="private-heading" className="space-y-3">
          <h2 id="private-heading" className="text-2xl font-semibold">
            Is it private?
          </h2>
          <p className="text-muted-foreground">
            Yes. {site.name} has no upload step and no server that receives
            your files. Processing happens in your browser, and the site loads
            no analytics, ads or third-party scripts. You can check this in
            your browser&apos;s Network tab, or turn off your connection after
            the page has loaded and see that it still works.
          </p>
        </section>

        <section aria-labelledby="faq-heading" className="space-y-4">
          <h2 id="faq-heading" className="text-2xl font-semibold">
            Frequently asked questions
          </h2>
          <dl className="space-y-5">
            {tool.faq.map((f) => (
              <div key={f.q}>
                <dt className="font-medium">
                  <h3>{f.q}</h3>
                </dt>
                <dd className="mt-1 text-muted-foreground">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}
