import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  FONT_LABELS,
  ImageSettings,
  TextSettings,
  percent,
} from "./content-settings";
import { DEFAULT_FORM, checkForm, type WatermarkForm } from "./core/form";
import { ANCHOR_LABELS, PositionPicker } from "./position-picker";
import { ROTATION_PRESETS, SettingsPanel } from "./settings-panel";

describe("percent", () => {
  it("formats fractions as whole percentages", () => {
    expect(percent(0.4)).toBe("40%");
    expect(percent(0.05)).toBe("5%");
  });
});

describe("PositionPicker", () => {
  it("offers nine places and tiling as one radio group", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PositionPicker value="center" onChange={onChange} />);
    const group = screen.getByRole("group", { name: "Position" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(10);
    expect(screen.getByRole("radio", { name: "Centre" })).toBeChecked();
    await user.click(
      screen.getByRole("radio", { name: ANCHOR_LABELS["top-left"] }),
    );
    expect(onChange).toHaveBeenLastCalledWith("top-left");
    await user.click(
      screen.getByRole("radio", { name: "Tile across the page" }),
    );
    expect(onChange).toHaveBeenLastCalledWith("tile");
  });
});

describe("TextSettings", () => {
  it("edits the text, font, bold, size and colour", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TextSettings
        text={DEFAULT_FORM.text}
        onChange={onChange}
        error={null}
      />,
    );
    fireEvent.change(screen.getByLabelText("Watermark text"), {
      target: { value: "DRAFT" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_FORM.text,
      text: "DRAFT",
    });
    await user.selectOptions(
      screen.getByLabelText("Font"),
      FONT_LABELS.courier,
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_FORM.text,
      font: "courier",
    });
    await user.click(screen.getByLabelText("Bold"));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_FORM.text,
      bold: false,
    });
    fireEvent.change(screen.getByLabelText("Size (pt)"), {
      target: { value: "24" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_FORM.text,
      fontSize: 24,
    });
    fireEvent.change(screen.getByLabelText("Colour"), {
      target: { value: "#ff0000" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_FORM.text,
      color: { r: 255, g: 0, b: 0 },
    });
  });

  it("marks the text invalid and describes the problem", () => {
    render(
      <TextSettings
        text={DEFAULT_FORM.text}
        onChange={vi.fn()}
        error="These characters cannot be written in the standard PDF fonts: ₹"
      />,
    );
    const field = screen.getByLabelText("Watermark text");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/cannot be written/);
  });
});

describe("ImageSettings", () => {
  it("picks a picture and changes its width", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onScaleChange = vi.fn();
    const { container } = render(
      <ImageSettings
        imageName={null}
        scale={0.4}
        onPick={onPick}
        onScaleChange={onScaleChange}
        error="Choose a picture."
      />,
    );
    const button = screen.getByRole("button", { name: "Choose a picture" });
    expect(button).toHaveAccessibleDescription("Choose a picture.");
    const file = new File(["x"], "logo.png", { type: "image/png" });
    await user.upload(container.querySelector('input[type="file"]')!, file);
    expect(onPick).toHaveBeenCalledWith(file);
    fireEvent.change(screen.getByLabelText("Width (of the page width)"), {
      target: { value: "0.6" },
    });
    expect(onScaleChange).toHaveBeenCalledWith(0.6);
  });

  it("shows the picked picture's name", () => {
    render(
      <ImageSettings
        imageName="logo.png"
        scale={0.4}
        onPick={vi.fn()}
        onScaleChange={vi.fn()}
        error={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Choose another picture" }),
    ).toHaveAccessibleDescription("logo.png");
  });
});

describe("SettingsPanel", () => {
  function renderPanel(patch: Partial<WatermarkForm> = {}, pageCount = 3) {
    const form = { ...DEFAULT_FORM, ...patch };
    const onChange = vi.fn();
    render(
      <SettingsPanel
        form={form}
        onChange={onChange}
        check={checkForm(form, pageCount)}
        pageCount={pageCount}
        onPickImage={vi.fn()}
      />,
    );
    return onChange;
  }

  it("switches between text and picture", async () => {
    const user = userEvent.setup();
    const onChange = renderPanel();
    expect(screen.getByLabelText("Watermark text")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Picture" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "image" });
  });

  it("shows picture settings for a picture watermark", () => {
    renderPanel({ kind: "image" });
    expect(
      screen.getByRole("button", { name: "Choose a picture" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Watermark text")).toBeNull();
  });

  it("changes opacity, angle (slider and presets), layer and pages", async () => {
    const user = userEvent.setup();
    const onChange = renderPanel();
    fireEvent.change(screen.getByLabelText("Opacity"), {
      target: { value: "0.5" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ opacity: 0.5 });
    fireEvent.change(screen.getByLabelText("Angle"), {
      target: { value: "-30" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ rotation: -30 });
    for (const deg of ROTATION_PRESETS) {
      await user.click(screen.getByRole("button", { name: `${deg}°` }));
      expect(onChange).toHaveBeenLastCalledWith({ rotation: deg });
    }
    expect(screen.getByRole("button", { name: "45°" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const under = screen.getByRole("radio", { name: "Under the content" });
    expect(under).toHaveAccessibleDescription(/opaque background/);
    await user.click(under);
    expect(onChange).toHaveBeenLastCalledWith({ layer: "under" });
    fireEvent.change(screen.getByLabelText("Pages"), {
      target: { value: "1-2" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ pages: "1-2" });
  });

  it("explains the page range and its problems", () => {
    renderPanel({ pages: "7" }, 3);
    const field = screen.getByLabelText("Pages");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(
      "For example 1-3, 5. This PDF has 3 pages. There is no page 7: this PDF has 3 pages.",
    );
  });
});
