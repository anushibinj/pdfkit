import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og";
import { getTool, tools } from "@/tools/registry";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "pdfkit tool preview card";

export function generateStaticParams() {
  return tools.map((tool) => ({ slug: tool.slug }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) throw new Error(`Unknown tool: ${slug}`);
  return renderOgCard({
    title: tool.name,
    tagline: tool.tagline,
    icon: tool.icon,
  });
}
