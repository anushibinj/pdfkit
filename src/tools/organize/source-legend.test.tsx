import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BoardPage, BoardSource } from "./core/board";
import { SourceLegend, pagesPerSource } from "./source-legend";

const sources: BoardSource[] = [
  {
    id: "a",
    name: "a.pdf",
    pages: [],
    colorIndex: 0,
    passwordProtected: false,
  },
  { id: "b", name: "b.pdf", pages: [], colorIndex: 1, passwordProtected: true },
];
const page = (key: string, sourceId: string): BoardPage => ({
  kind: "source",
  key,
  sourceId,
  pageIndex: 0,
  rotation: 0,
});
const pages: BoardPage[] = [
  page("1", "a"),
  page("2", "a"),
  { kind: "blank", key: "3", width: 1, height: 1, rotation: 0 },
];

describe("pagesPerSource", () => {
  it("counts board pages per file, ignoring blanks", () => {
    expect(pagesPerSource(pages)).toEqual(new Map([["a", 2]]));
  });
});

describe("SourceLegend", () => {
  it("lists each file with its number, page count and lock", () => {
    render(
      <SourceLegend
        sources={sources}
        pages={pages}
        disabled={false}
        onSelectSource={vi.fn()}
      />,
    );
    const items = within(
      screen.getByRole("list", { name: "Files" }),
    ).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("File 1: a.pdf");
    expect(items[0]).toHaveTextContent("2 pages");
    expect(items[1]).toHaveTextContent("0 pages");
    expect(items[1]).toHaveTextContent("opened with a password");
    expect(items[0]).not.toHaveTextContent("opened with a password");
  });

  it("selects a file's pages; disabled when it has none on the board", async () => {
    const user = userEvent.setup();
    const onSelectSource = vi.fn();
    render(
      <SourceLegend
        sources={sources}
        pages={pages}
        disabled={false}
        onSelectSource={onSelectSource}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Select the pages of a.pdf" }),
    );
    expect(onSelectSource).toHaveBeenCalledWith("a");
    expect(
      screen.getByRole("button", { name: "Select the pages of b.pdf" }),
    ).toBeDisabled();
  });
});
