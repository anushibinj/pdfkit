"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { tools } from "@/tools/registry";

function Loading() {
  return (
    <div
      role="status"
      className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground"
    >
      Loading tool…
    </div>
  );
}

// One lazy, client-only component per registered tool. The tool's code (and
// its WASM worker) is only fetched on that tool's page.
const loaded: Record<string, ComponentType> = Object.fromEntries(
  tools.map((tool) => [
    tool.slug,
    dynamic(tool.component, { ssr: false, loading: Loading }),
  ]),
);

export function ToolLoader({ slug }: { slug: string }) {
  const Tool = loaded[slug];
  return Tool ? <Tool /> : null;
}
