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
    // one extra non-link placeholder card at the end
    expect(items).toHaveLength(tools.length + 1);
    for (const tool of tools) {
      const link = screen.getByRole("link", { name: new RegExp(tool.name) });
      // next/link applies the trailingSlash config at build time, not in tests
      expect(link.getAttribute("href")).toMatch(new RegExp(`^/tools/${tool.slug}/?$`));
    }
  });

  it("shows name and tagline, without a badge, on each card", () => {
    render(<ToolGrid tools={tools} />);
    const [card] = screen.getAllByRole("listitem");
    expect(within(card).getByText(tools[0].name)).toBeInTheDocument();
    expect(within(card).getByText(tools[0].tagline)).toBeInTheDocument();
    expect(within(card).queryByText("Private, runs locally")).toBeNull();
  });

  it("labels only beta tools with 'Beta', next to the name", () => {
    render(<ToolGrid tools={tools} />);
    for (const tool of tools) {
      const link = screen.getByRole("link", { name: new RegExp(tool.name) });
      const label = within(link).queryByText("Beta");
      if (tool.beta) {
        expect(label).toBeInTheDocument();
        // same row as the title, i.e. not in a footer below the description
        expect(label?.parentElement).toContainElement(
          within(link).getByText(tool.name),
        );
      } else {
        expect(label).toBeNull();
      }
    }
  });

  it("ends with a non-link 'More tools on the way' card", () => {
    render(<ToolGrid tools={tools} />);
    const items = screen.getAllByRole("listitem");
    const last = items[items.length - 1];
    expect(within(last).getByText("More tools on the way")).toBeInTheDocument();
    expect(within(last).queryByRole("link")).toBeNull();
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
