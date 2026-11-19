import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TOOL_STYLE, type DrawingTool } from "./core/gestures";
import { FONT_SIZE_LIMITS, type EditObject } from "./core/model";
import {
  ColorField,
  FontField,
  NumberField,
  ObjectProperties,
  TOOL_HINTS,
  TextContentField,
  type ObjectPropertiesProps,
} from "./object-properties";
import { fakeMetrics } from "./test-utils/fake-metrics";

const toast = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const frame = { id: "s1", x: 0, y: 0, rotation: 0 } as const;
const text: EditObject = {
  ...frame,
  kind: "text",
  text: "Hi",
  font: "sans",
  fontSize: 12,
  color: { r: 0, g: 0, b: 0 },
};

function setup(overrides: Partial<ObjectPropertiesProps> = {}) {
  const props: ObjectPropertiesProps = {
    tool: "select",
    style: DEFAULT_TOOL_STYLE,
    onStyleChange: vi.fn(),
    selected: null,
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    pendingImageName: null,
    onCancelImage: vi.fn(),
    metrics: fakeMetrics,
    ...overrides,
  };
  render(<ObjectProperties {...props} />);
  return props;
}

describe("NumberField", () => {
  it("reports clamped numbers and tolerates an empty field while typing", () => {
    const onChange = vi.fn();
    render(
      <NumberField
        label="Size"
        value={12}
        limits={FONT_SIZE_LIMITS}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Size");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue(null);
    fireEvent.change(input, { target: { value: "999" } });
    expect(onChange).toHaveBeenLastCalledWith(FONT_SIZE_LIMITS.max);
    fireEvent.blur(input);
    expect(input).toHaveValue(12); // back to the value in use
  });
});

describe("ColorField", () => {
  it("shows and reports colours", () => {
    const onChange = vi.fn();
    render(
      <ColorField
        label="Colour"
        value={{ r: 255, g: 0, b: 0 }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Colour");
    expect(input).toHaveValue("#ff0000");
    fireEvent.change(input, { target: { value: "#00ff00" } });
    expect(onChange).toHaveBeenCalledWith({ r: 0, g: 255, b: 0 });
  });
});

describe("FontField", () => {
  it("offers the three standard fonts", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FontField value="sans" onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText("Font"), "mono");
    expect(onChange).toHaveBeenCalledWith("mono");
  });
});

describe("TextContentField", () => {
  it("cleans typed text and says which characters were removed", () => {
    const onChange = vi.fn();
    render(
      <TextContentField
        object={text as never}
        metrics={fakeMetrics}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Text content"), {
      target: { value: "Pay ₹5\r\nnow" },
    });
    expect(onChange).toHaveBeenCalledWith("Pay 5\nnow");
    expect(toast.warning).toHaveBeenCalledWith(
      "Removed ₹: the standard PDF fonts cannot show this character.",
    );
    fireEvent.change(screen.getByLabelText("Text content"), {
      target: { value: "₹ and emojis 😀" },
    });
    expect(toast.warning).toHaveBeenLastCalledWith(
      "Removed ₹ 😀: the standard PDF fonts cannot show these characters.",
    );
    toast.warning.mockClear();
    fireEvent.change(screen.getByLabelText("Text content"), {
      target: { value: "fine" },
    });
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

describe("ObjectProperties", () => {
  it.each(Object.keys(TOOL_HINTS) as DrawingTool[])(
    "explains the %s tool when nothing is selected",
    (tool) => {
      setup({ tool });
      expect(screen.getByText(TOOL_HINTS[tool])).toBeInTheDocument();
    },
  );

  it("edits the style for new text", async () => {
    const props = setup({ tool: "text" });
    fireEvent.change(screen.getByLabelText("Size (pt)"), {
      target: { value: "20" },
    });
    expect(props.onStyleChange).toHaveBeenCalledWith({ fontSize: 20 });
    fireEvent.change(screen.getByLabelText("Colour"), {
      target: { value: "#123456" },
    });
    expect(props.onStyleChange).toHaveBeenCalledWith({
      textColor: { r: 0x12, g: 0x34, b: 0x56 },
    });
    await userEvent
      .setup()
      .selectOptions(screen.getByLabelText("Font"), "serif");
    expect(props.onStyleChange).toHaveBeenCalledWith({ font: "serif" });
  });

  it("edits the pen and highlighter styles", () => {
    const props = setup({ tool: "ink" });
    fireEvent.change(screen.getByLabelText("Width (pt)"), {
      target: { value: "4" },
    });
    expect(props.onStyleChange).toHaveBeenCalledWith({ strokeWidth: 4 });
    fireEvent.change(screen.getByLabelText("Colour"), {
      target: { value: "#000000" },
    });
    expect(props.onStyleChange).toHaveBeenCalledWith({
      color: { r: 0, g: 0, b: 0 },
    });
  });

  it("edits the highlighter colour", () => {
    const props = setup({ tool: "highlight" });
    fireEvent.change(screen.getByLabelText("Colour"), {
      target: { value: "#00ff00" },
    });
    expect(props.onStyleChange).toHaveBeenCalledWith({
      highlightColor: { r: 0, g: 255, b: 0 },
    });
  });

  it("edits a selected text object with one undo step per setting", async () => {
    const props = setup({ selected: text });
    fireEvent.change(screen.getByLabelText("Text content"), {
      target: { value: "Hello" },
    });
    expect(props.onUpdate).toHaveBeenCalledWith({ text: "Hello" }, "text:s1");
    fireEvent.change(screen.getByLabelText("Size (pt)"), {
      target: { value: "30" },
    });
    expect(props.onUpdate).toHaveBeenCalledWith({ fontSize: 30 }, "size:s1");
    fireEvent.change(screen.getByLabelText("Colour"), {
      target: { value: "#ff0000" },
    });
    expect(props.onUpdate).toHaveBeenCalledWith(
      { color: { r: 255, g: 0, b: 0 } },
      "color:s1",
    );
    await userEvent
      .setup()
      .selectOptions(screen.getByLabelText("Font"), "mono");
    expect(props.onUpdate).toHaveBeenCalledWith(
      { font: "mono", text: "Hi" },
      "font:s1",
    );
  });

  it("edits a selected stroke's width", () => {
    const ink: EditObject = {
      ...frame,
      kind: "ink",
      points: [{ x: 0, y: 0 }],
      color: { r: 0, g: 0, b: 0 },
      strokeWidth: 2,
    };
    const props = setup({ selected: ink });
    fireEvent.change(screen.getByLabelText("Width (pt)"), {
      target: { value: "3.5" },
    });
    expect(props.onUpdate).toHaveBeenCalledWith(
      { strokeWidth: 3.5 },
      "width:s1",
    );
  });

  it("offers Delete for any selection", async () => {
    const props = setup({
      selected: { ...frame, kind: "image", width: 5, height: 5, imageId: "i" },
    });
    expect(screen.queryByLabelText("Colour")).toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Delete/ }));
    expect(props.onDelete).toHaveBeenCalled();
  });

  it("explains image placement and lets the user cancel it", async () => {
    const props = setup({ pendingImageName: "signature.png", selected: text });
    expect(screen.getByText(/Click on a page to place/)).toHaveTextContent(
      "signature.png",
    );
    expect(screen.queryByLabelText("Text content")).toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Cancel/ }));
    expect(props.onCancelImage).toHaveBeenCalled();
  });
});
