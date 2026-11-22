import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { BetaBadge } from "@/components/beta-badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ToolDefinition } from "@/tools/types";

export function ToolCard({ tool }: { tool: ToolDefinition }) {
  const Icon = tool.icon;
  return (
    <li>
      <Link
        href={`/tools/${tool.slug}/`}
        className="group focus-visible:ring-ring/60 block h-full rounded-xl outline-none focus-visible:ring-3"
      >
        <Card className="group-hover:ring-foreground/30 h-full transition-shadow">
          <CardHeader className="gap-3">
            <div className="flex items-center justify-between">
              <span className="bg-muted flex size-11 items-center justify-center rounded-lg">
                <Icon className="size-6" aria-hidden="true" />
              </span>
              <ArrowRight
                className="text-muted-foreground size-5 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-lg">{tool.name}</CardTitle>
              {tool.beta && <BetaBadge />}
            </div>
            <CardDescription>{tool.tagline}</CardDescription>
          </CardHeader>
        </Card>
      </Link>
    </li>
  );
}
