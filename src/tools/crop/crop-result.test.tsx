import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CropResult } from "./crop-result";

describe("CropResult", () => {
  it("shows the summary, what stays in the file, notes and the actions", async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    const onBack = vi.fn();
    render(
      <CropResult
        summary={{
          summary: "Cropped 1 page.",
          kept: ["A picture stays."],
          notes: ["A note."],
        }}
        fileName="a-cropped.pdf"
        onDownload={onDownload}
        onBack={onBack}
      />,
    );
    expect(screen.getByText("Cropped 1 page.")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("A picture stays.");
    expect(screen.getByText("A note.")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Download a-cropped.pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Change the crop" }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("has no 'still in the file' panel when nothing stays", () => {
    render(
      <CropResult
        summary={{ summary: "Done.", kept: [], notes: [] }}
        fileName="a.pdf"
        onDownload={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.queryByRole("note")).toBeNull();
  });
});
