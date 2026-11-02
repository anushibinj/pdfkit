import { ToolCard } from "@/components/tool-card";
import type { ToolDefinition } from "@/tools/types";

export function ToolGrid({ tools }: { tools: ToolDefinition[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((tool) => (
        <ToolCard key={tool.slug} tool={tool} />
      ))}
    </ul>
  );
}
