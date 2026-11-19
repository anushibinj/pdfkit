import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TOOL_STYLE, type DrawingTool } from "./core/gestures";
import type { EditObject, EditorPage, PageInfo } from "./core/model";
import { PageOverlay, type PageOverlayProps } from "./page-overlay";
import { fakeMetrics } from "./test-utils/fake-metrics";

// jsdom lays nothing out: getBoundingClientRect() is all zeros, which the
// overlay treats as "1 CSS pixel = 1 point". Client coordinates in these
// tests are therefore view coordinates.
const info: PageInfo = {
  box: { left: 0, bottom: 0, right: 600, top: 400 },
  rotation: 0,
};
const rect: EditObject = {
  id: "r1",
  kind: "rect",
  x: 100,
  y: 300, // view (100, 100)
  rotation: 0,
  width: 50,
  height: 20,
  color: { r: 0, g: 0, b: 0 },
  strokeWidth: 2,
};
const page = (objects: EditObject[] = []): EditorPage => ({
  key: "p0",
  sourceIndex: 0,
  rotation: 0,
  objects,
});

function setup(overrides: Partial<PageOverlayProps> = {}) {
  let id = 0;
  const props: PageOverlayProps = {
    page: page([rect]),
    info,
    pageNumber: 1,
    cssWidth: 0,
    tool: "select",
    style: DEFAULT_TOOL_STYLE,
    selectedId: null,
    imageUrls: new Map(),
    metrics: fakeMetrics,
    pendingImage: null,
    newId: () => `n${++id}`,
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };
  const utils = render(<PageOverlay {...props} />);
  const svg = utils.container.querySelector("svg")!;
  return { ...utils, props, svg };
}

const at = (x: number, y: number) => ({
  clientX: x,
  clientY: y,
  button: 0,
  pointerId: 1,
});

describe("PageOverlay", () => {
  it("uses the displayed page size as its viewBox and names itself", () => {
    const { svg } = setup({ page: { ...page(), rotation: 1 } });
    expect(svg.getAttribute("viewBox")).toBe("0 0 400 600");
    expect(svg.getAttribute("aria-label")).toBe("Page 1 editing area");
  });

  it("select tool: clicking paper clears the selection", () => {
    const { svg, props } = setup();
    fireEvent.pointerDown(svg, at(10, 10));
    expect(props.onSelect).toHaveBeenCalledWith(null);
  });

  it("select tool: dragging an object selects and moves it in one step", () => {
    const { container, svg, props } = setup();
    const object = container.querySelector('[data-object-id="r1"]')!;
    fireEvent.pointerDown(object, at(110, 105));
    expect(props.onSelect).toHaveBeenCalledWith("r1");
    fireEvent.pointerMove(svg, at(130, 115));
    // while dragging, the (non-interactive) preview replaces the object
    const copies = container.querySelectorAll('[data-object-id="r1"]');
    expect(copies).toHaveLength(1);
    expect(copies[0].getAttribute("role")).toBeNull();
    fireEvent.pointerUp(svg, at(140, 125));
    expect(props.onUpdate).toHaveBeenCalledWith("r1", { x: 130, y: 280 });
  });

  it("select tool: a click on an object does not record a move", () => {
    const { container, svg, props } = setup();
    fireEvent.pointerDown(
      container.querySelector('[data-object-id="r1"]')!,
      at(110, 105),
    );
    fireEvent.pointerUp(svg, at(110, 105));
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("select tool: focusing an object selects it (keyboard users)", () => {
    const { container, props } = setup();
    fireEvent.focus(container.querySelector('[data-object-id="r1"]')!);
    expect(props.onSelect).toHaveBeenCalledWith("r1");
  });

  it("select tool: the handle resizes the selected box", () => {
    const { container, svg, props } = setup({ selectedId: "r1" });
    fireEvent.pointerDown(
      container.querySelector("[data-resize-handle]")!,
      at(150, 120),
    );
    fireEvent.pointerUp(svg, at(170, 130));
    expect(props.onUpdate).toHaveBeenCalledWith("r1", {
      width: 70,
      height: 30,
    });
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("keeps focus where it is when the page is pressed (e.g. in the text field)", () => {
    const { svg } = setup();
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    svg.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores buttons other than the primary one", () => {
    const { svg, props } = setup();
    fireEvent.pointerDown(svg, { ...at(10, 10), button: 2 });
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("text tool: a click adds a text object there", () => {
    const { svg, props } = setup({ tool: "text" });
    fireEvent.pointerDown(svg, at(20, 30));
    expect(props.onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ id: "n1", kind: "text", x: 20, y: 370 }),
    );
  });

  it("objects are not interactive with drawing tools", () => {
    const { container } = setup({ tool: "ink" });
    expect(container.querySelector('[role="button"]')).toBeNull();
  });

  it("pen tool: press, drag and release adds one stroke", () => {
    const { svg, props } = setup({ tool: "ink" });
    fireEvent.pointerDown(svg, at(10, 10));
    fireEvent.pointerMove(svg, at(20, 10));
    fireEvent.pointerMove(svg, at(20, 20));
    expect(props.onAdd).not.toHaveBeenCalled();
    fireEvent.pointerUp(svg, at(20, 20));
    const added = (props.onAdd as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(added).toMatchObject({ kind: "ink", id: "n1" });
    expect(added.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it.each(["rect", "highlight", "whiteout"] as DrawingTool[])(
    "%s tool: drag adds a box",
    (tool) => {
      const { svg, props } = setup({ tool, page: page() });
      fireEvent.pointerDown(svg, at(10, 10));
      fireEvent.pointerUp(svg, at(60, 40));
      expect(props.onAdd).toHaveBeenCalledWith(
        expect.objectContaining({ kind: tool, width: 50, height: 30 }),
      );
    },
  );

  it("a cancelled pointer drops the gesture", () => {
    const { svg, props } = setup({ tool: "whiteout" });
    fireEvent.pointerDown(svg, at(10, 10));
    fireEvent.pointerCancel(svg, at(10, 10));
    fireEvent.pointerUp(svg, at(60, 40));
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("places a waiting image with the next click, whatever the tool", () => {
    const { svg, props, container } = setup({
      tool: "select",
      pendingImage: { id: "img", pixelWidth: 2, pixelHeight: 1 },
    });
    expect(container.querySelector('[role="button"]')).toBeNull();
    fireEvent.pointerDown(svg, at(50, 50));
    expect(props.onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "image",
        imageId: "img",
        width: 240,
        height: 120,
      }),
    );
  });

  it("draws images with their preview URL", () => {
    const image: EditObject = {
      ...rect,
      id: "i",
      kind: "image",
      imageId: "a",
    } as EditObject;
    const { container } = setup({
      page: page([image]),
      imageUrls: new Map([["a", "blob:a"]]),
    });
    expect(container.querySelector("image")?.getAttribute("href")).toBe(
      "blob:a",
    );
  });

  it("keeps the resize handle about 16 CSS pixels at any zoom", () => {
    const { container } = setup({ selectedId: "r1", cssWidth: 300 }); // 600 pt shown in 300 px
    expect(
      container.querySelector("[data-resize-handle]")?.getAttribute("width"),
    ).toBe("32");
  });
});
