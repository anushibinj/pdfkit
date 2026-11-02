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

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webApp) }}
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
    </>
  );
}
