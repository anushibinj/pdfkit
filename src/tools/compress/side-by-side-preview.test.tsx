import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SideBySidePreview } from "./side-by-side-preview";

vi.mock("@/lib/draw-pixels", () => ({
  drawPixels: vi.fn(),
}));

describe("SideBySidePreview", () => {
  it("displays both Original and Compressed canvases with page navigation", () => {
    const onPageChange = vi.fn();
    const onClose = vi.fn();
    render(
      <SideBySidePreview
        fileName="report.pdf"
        originalBytes={2_000_000}
        compressedBytes={600_000}
        preview={{
          itemId: "1",
          pageIndex: 0,
          pageCount: 3,
          width: 100,
          height: 150,
          loading: false,
          originalPixels: new Uint8Array(100 * 150 * 4),
          compressedPixels: new Uint8Array(100 * 150 * 4),
        }}
        onPageChange={onPageChange}
        onClose={onClose}
      />,
    );

    expect(screen.getByText(/Side-by-side preview: report\.pdf/i)).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Original page render")).toBeInTheDocument();
    expect(screen.getByLabelText("Compressed page render")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Next preview page"));
    expect(onPageChange).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByLabelText("Close preview"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
