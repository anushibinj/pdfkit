import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TOOL_STYLE } from "./core/gestures";
import { PageControls, PageView } from "./page-view";
import { fakeMetrics } from "./test-utils/fake-metrics";

function controls(pageNumber: number, pageCount: number, disabled = false) {
  const handlers = { onRotate: vi.fn(), onMove: vi.fn(), onDelete: vi.fn() };
  render(
    <PageControls
      pageNumber={pageNumber}
      pageCount={pageCount}
      disabled={disabled}
      {...handlers}
    />,
  );
  return handlers;
}

describe("PageControls", () => {
  it("shows the position and fires each operation", async () => {
    const user = userEvent.setup();
    const h = controls(2, 3);
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Rotate page 2 left" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Rotate page 2 right" }),
    );
    await user.click(screen.getByRole("button", { name: "Move page 2 up" }));
    await user.click(screen.getByRole("button", { name: "Move page 2 down" }));
    await user.click(screen.getByRole("button", { name: "Delete page 2" }));
    expect(h.onRotate.mock.calls).toEqual([[-1], [1]]);
    expect(h.onMove.mock.calls).toEqual([[-1], [1]]);
    expect(h.onDelete).toHaveBeenCalledTimes(1);
  });

  it("disables moves at the ends and deleting the only page", () => {
    controls(1, 1);
    expect(
      screen.getByRole("button", { name: "Move page 1 up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move page 1 down" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Delete page 1" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Rotate page 1 left" }),
    ).toBeEnabled();
  });

  it("disables everything while busy", () => {
    controls(2, 3, true);
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
  });
});

describe("PageView", () => {
  it("renders the page (jsdom counts it as near) under an editing overlay", () => {
    const renderPage = vi.fn(() => new Promise<never>(() => {}));
    render(
      <PageView
        page={{ key: "p3", sourceIndex: 3, rotation: 1, objects: [] }}
        info={{
          box: { left: 0, bottom: 0, right: 600, top: 400 },
          rotation: 0,
        }}
        pageNumber={1}
        pageCount={2}
        tool="select"
        style={DEFAULT_TOOL_STYLE}
        selectedId={null}
        imageUrls={new Map()}
        metrics={fakeMetrics}
        pendingImage={null}
        newId={() => "x"}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onSelect={vi.fn()}
        renderPage={renderPage}
        onRotate={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Page 1 of 2" }),
    ).toBeInTheDocument();
    // source page 3, user turns 1, minimum render width (width unknown in jsdom)
    expect(renderPage).toHaveBeenCalledWith(3, 1, 512, expect.any(AbortSignal));
    expect(
      screen.getByLabelText("Page 1 editing area").getAttribute("viewBox"),
    ).toBe("0 0 400 600");
  });
});
