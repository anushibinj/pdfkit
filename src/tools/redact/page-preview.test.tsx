import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MARK_STYLE, type RedactionMark } from "./core/model";
import { PagePreview } from "./page-preview";

const INFO = {
  box: { left: 0, bottom: 0, right: 600, top: 800 },
  rotation: 0 as const,
};

const MARKS: RedactionMark[] = [
  {
    id: "m1",
    pageIndex: 0,
    box: { left: 60, bottom: 700, right: 200, top: 720 },
    term: "secret",
    source: "text",
    label: "Text",
    enabled: true,
  },
  {
    id: "m2",
    pageIndex: 0,
    box: { left: 60, bottom: 600, right: 150, top: 620 },
    term: "false positive",
    source: "text",
    label: "Text",
    enabled: false,
  },
];

describe("PagePreview", () => {
  it("renders page navigation, existing marks, and supports drag-drawing new redaction boxes", () => {
    const onPageChange = vi.fn();
    const onAddBox = vi.fn();
    const onSelectMark = vi.fn();
    const renderPage = vi.fn(async () => ({
      status: "rendered" as const,
      width: 100,
      height: 133,
      pixels: new ArrayBuffer(100 * 133 * 4),
    }));

    render(
      <PagePreview
        pageIndex={0}
        pageCount={3}
        info={INFO}
        marks={MARKS}
        selectedMarkId="m1"
        style={DEFAULT_MARK_STYLE}
        renderPage={renderPage}
        onPageChange={onPageChange}
        onAddBox={onAddBox}
        onSelectMark={onSelectMark}
      />,
    );

    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("REDACTED")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(1);

    const svg = screen.getByRole("img", { name: /redaction canvas for page 1/i });
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 600, height: 800 }),
    });

    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { button: 0, pointerId: 1, clientX: 250, clientY: 140 });
    fireEvent.pointerUp(svg, { button: 0, pointerId: 1, clientX: 250, clientY: 140 });

    expect(onAddBox).toHaveBeenCalledTimes(1);
    const added = onAddBox.mock.calls[0][0];
    expect(added.left).toBeCloseTo(100, 2);
    expect(added.right).toBeCloseTo(250, 2);
    // View y=100..140 maps to PDF user-space y=660..700 (800 - y)
    expect(added.bottom).toBeCloseTo(660, 2);
    expect(added.top).toBeCloseTo(700, 2);
  });
});
