import { render, screen, within } from "@testing-library/react";
import { Lock } from "lucide-react";
import { describe, expect, it } from "vitest";
import { ToolGrid } from "./tool-grid";
import { tools } from "@/tools/registry";
import type { ToolDefinition } from "@/tools/types";

describe("ToolGrid", () => {
  it("renders one focusable link per registered tool", () => {
    render(<ToolGrid tools={tools} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(tools.length);
    for (const tool of tools) {
      const link = screen.getByRole("link", { name: new RegExp(tool.name) });
      // next/link applies the trailingSlash config at build time, not in tests
      expect(link.getAttribute("href")).toMatch(new RegExp(`^/tools/${tool.slug}/?$`));
    }
  });

  it("shows name, tagline and the privacy badge on each card", () => {
    render(<ToolGrid tools={tools} />);
    const [card] = screen.getAllByRole("listitem");
    expect(within(card).getByText(tools[0].name)).toBeInTheDocument();
    expect(within(card).getByText(tools[0].tagline)).toBeInTheDocument();
    expect(within(card).getByText("Private, runs locally")).toBeInTheDocument();
  });

  it("adds a card when a tool is added to the array", () => {
    const extra: ToolDefinition = {
      ...tools[0],
      slug: "extra",
      name: "Extra Tool",
      icon: Lock,
    };
    render(<ToolGrid tools={[...tools, extra]} />);
    expect(
      screen.getByRole("link", { name: /Extra Tool/ }).getAttribute("href"),
    ).toMatch(/^\/tools\/extra\/?$/);
  });
});
