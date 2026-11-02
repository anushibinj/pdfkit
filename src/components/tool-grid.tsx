import { ToolCard } from "@/components/tool-card";
import type { ToolDefinition } from "@/tools/types";

export function ToolGrid({ tools }: { tools: ToolDefinition[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((tool) => (
        <ToolCard key={tool.slug} tool={tool} />
      ))}
      <li data-testid="more-tools-card">
        <div className="flex h-full min-h-32 items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/40 p-6 text-center text-muted-foreground">
          More tools on the way
        </div>
      </li>
    </ul>
  );
}
