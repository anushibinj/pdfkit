import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CLEANUP_OPTIONS,
  DEFAULT_MARK_STYLE,
} from "./core/model";
import { RedactSettings } from "./redact-settings";

describe("RedactSettings", () => {
  it("toggles black/white fill, overlay label, cleanup flags, and rasterize fallback", () => {
    const onStyleChange = vi.fn();
    const onCleanupChange = vi.fn();
    const onRasterizeChange = vi.fn();

    render(
      <RedactSettings
        style={DEFAULT_MARK_STYLE}
        cleanup={DEFAULT_CLEANUP_OPTIONS}
        rasterizePages={false}
        onStyleChange={onStyleChange}
        onCleanupChange={onCleanupChange}
        onRasterizeChange={onRasterizeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "White fill" }));
    expect(onStyleChange).toHaveBeenCalledWith({
      fill: "white",
      label: "REDACTED",
    });

    fireEvent.change(screen.getByLabelText(/overlay label/i), {
      target: { value: "CONFIDENTIAL" },
    });
    expect(onStyleChange).toHaveBeenCalledWith({
      fill: "black",
      label: "CONFIDENTIAL",
    });

    fireEvent.click(screen.getByText("Metadata & XMP"));
    expect(onCleanupChange).toHaveBeenCalledWith({
      ...DEFAULT_CLEANUP_OPTIONS,
      metadata: false,
    });

    fireEvent.click(screen.getByText(/rasterise redacted pages/i));
    expect(onRasterizeChange).toHaveBeenCalledWith(true);
  });
});
