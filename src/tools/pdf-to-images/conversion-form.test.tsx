import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ConversionForm,
  DEFAULT_SETTINGS,
  type ConversionSettings,
} from "./conversion-form";

/** The form with real state, so typing and choosing behave as in the app. */
function Harness({
  onConvert = vi.fn(),
  onStop = vi.fn(),
  running = false,
  stopping = false,
  initial = DEFAULT_SETTINGS,
  onSettings = vi.fn(),
}: {
  onConvert?: (pages: number[]) => void;
  onStop?: () => void;
  running?: boolean;
  stopping?: boolean;
  initial?: ConversionSettings;
  onSettings?: (s: ConversionSettings) => void;
}) {
  const [settings, setSettings] = useState(initial);
  return (
    <ConversionForm
      pageCount={10}
      settings={settings}
      onChange={(s) => {
        setSettings(s);
        onSettings(s);
      }}
      running={running}
      stopping={stopping}
      onConvert={onConvert}
      onStop={onStop}
    />
  );
}

describe("ConversionForm", () => {
  it("converts every page by default", async () => {
    const user = userEvent.setup();
    const onConvert = vi.fn();
    render(<Harness onConvert={onConvert} />);
    expect(screen.getByLabelText("Pages")).toHaveAttribute(
      "placeholder",
      "All 10 pages",
    );
    await user.click(screen.getByRole("button", { name: "Convert pages" }));
    expect(onConvert).toHaveBeenCalledWith([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("converts the typed pages, and blocks an invalid selection with its reason", async () => {
    const user = userEvent.setup();
    const onConvert = vi.fn();
    render(<Harness onConvert={onConvert} />);
    const pages = screen.getByLabelText("Pages");
    await user.type(pages, "12");
    expect(pages).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/There is no page 12/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Convert pages" }),
    ).toBeDisabled();
    await user.clear(pages);
    await user.type(pages, "2-3{Enter}");
    expect(onConvert).toHaveBeenCalledWith([1, 2]);
  });

  it("switches to image extraction, which has no format options", async () => {
    const user = userEvent.setup();
    const onSettings = vi.fn();
    render(<Harness onSettings={onSettings} />);
    expect(screen.getByLabelText("Format")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Embedded images/ }));
    expect(onSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "images" }),
    );
    expect(screen.queryByLabelText("Format")).toBeNull();
    expect(screen.queryByLabelText("Resolution")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Extract images" }),
    ).toBeInTheDocument();
  });

  it("changes format, resolution and, for JPEG, quality", async () => {
    const user = userEvent.setup();
    const onSettings = vi.fn();
    render(<Harness onSettings={onSettings} />);
    expect(screen.queryByLabelText("Quality")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Format"), "jpeg");
    await user.selectOptions(screen.getByLabelText("Resolution"), "300");
    await user.selectOptions(screen.getByLabelText("Quality"), "0.8");
    expect(onSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        render: { format: "jpeg", dpi: 300, quality: 0.8 },
      }),
    );
  });

  it("locks the fields while running and offers Stop", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const { rerender } = render(<Harness running onStop={onStop} />);
    expect(screen.getByLabelText("Pages")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Convert pages" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
    rerender(<Harness running stopping onStop={onStop} />);
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
  });
});
