import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ConversionState } from "@/lib/html-pdf/conversion-state";
import { ConversionActions } from "./conversion-actions";

function setup(state: ConversionState, canConvert = true) {
  const props = {
    state,
    canConvert,
    onConvert: vi.fn(),
    onCancel: vi.fn(),
    onDownload: vi.fn(),
  };
  render(<ConversionActions {...props} />);
  return props;
}

describe("ConversionActions", () => {
  it("offers Convert when idle", async () => {
    const props = setup({ kind: "idle" });
    await userEvent.click(
      screen.getByRole("button", { name: /Convert to PDF/ }),
    );
    expect(props.onConvert).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
  });

  it("disables Convert when there is nothing to convert", () => {
    setup({ kind: "idle" }, false);
    expect(
      screen.getByRole("button", { name: /Convert to PDF/ }),
    ).toBeDisabled();
  });

  it("replaces Convert with Cancel while converting", async () => {
    const props = setup({ kind: "converting" });
    expect(screen.queryByRole("button", { name: /Convert to PDF/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it("offers the finished PDF, with its size, for download", async () => {
    const pdf = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    const props = setup({ kind: "done", pdf });
    const download = screen.getByRole("button", { name: /Download PDF/ });
    expect(download).toHaveTextContent("Download PDF (8 B)");
    await userEvent.click(download);
    expect(props.onDownload).toHaveBeenCalledWith(pdf);
    // a finished PDF can be converted again
    expect(
      screen.getByRole("button", { name: /Convert to PDF/ }),
    ).toBeEnabled();
  });
});
