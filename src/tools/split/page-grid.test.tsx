import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PageGrid } from "./page-grid";

const pages = [
  { width: 600, height: 400 },
  { width: 400, height: 600 },
  { width: 600, height: 400 },
];
const renderPage = async () => ({
  status: "error" as const,
  reason: "failed" as const,
  message: "not drawn in this test",
});

describe("PageGrid", () => {
  it("lists every page with its mark", () => {
    render(
      <PageGrid
        pages={pages}
        renderPage={renderPage}
        label="Pick pages to remove"
        markOf={(i) => (i === 1 ? "removed" : "none")}
        onToggle={vi.fn()}
      />,
    );
    const list = screen.getByRole("list", { name: "Pick pages to remove" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("passes clicks on, and can be disabled", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(
      <PageGrid
        pages={pages}
        renderPage={renderPage}
        label="Pages"
        markOf={() => "none"}
        onToggle={onToggle}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Page 3" }));
    expect(onToggle).toHaveBeenCalledWith(2, false);
    rerender(
      <PageGrid
        pages={pages}
        renderPage={renderPage}
        label="Pages"
        markOf={() => "none"}
        onToggle={onToggle}
        disabled
      />,
    );
    expect(screen.getByRole("button", { name: "Page 3" })).toBeDisabled();
  });

  it("shows captions and no buttons when pages cannot be picked", () => {
    render(
      <PageGrid
        pages={pages}
        renderPage={renderPage}
        label="Pages"
        markOf={() => "none"}
        captionOf={(i) => `File ${i + 1}`}
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("File 3")).toBeInTheDocument();
  });
});
