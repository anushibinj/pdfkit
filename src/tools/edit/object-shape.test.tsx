import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EditObject } from "./core/model";
import {
  ObjectShape,
  PREVIEW_FONT_FAMILY,
  describeObject,
} from "./object-shape";
import { fakeMetrics } from "./test-utils/fake-metrics";

const frame = { id: "o1", x: 0, y: 0, rotation: 0 } as const;
const black = { r: 0, g: 0, b: 0 };
const objects: Record<EditObject["kind"], EditObject> = {
  text: {
    ...frame,
    kind: "text",
    text: "Hello\n  world",
    font: "serif",
    fontSize: 10,
    color: black,
  },
  ink: {
    ...frame,
    kind: "ink",
    points: [{ x: 1, y: 2 }],
    color: { r: 255, g: 0, b: 0 },
    strokeWidth: 3,
  },
  rect: {
    ...frame,
    kind: "rect",
    width: 20,
    height: 10,
    color: black,
    strokeWidth: 2,
  },
  highlight: {
    ...frame,
    kind: "highlight",
    width: 20,
    height: 10,
    color: { r: 255, g: 255, b: 0 },
  },
  image: { ...frame, kind: "image", width: 20, height: 10, imageId: "a" },
};

/** Render inside an <svg> so the SVG elements have the right namespace. */
const draw = (ui: React.ReactElement) => render(<svg>{ui}</svg>).container;

describe("describeObject", () => {
  it("names each kind, quoting the first line of text", () => {
    expect(describeObject(objects.text)).toBe("Text: Hello");
    expect(
      describeObject({ ...objects.text, text: "x".repeat(50) } as EditObject),
    ).toBe(`Text: ${"x".repeat(40)}…`);
    expect(describeObject(objects.ink)).toBe("Drawing");
    expect(describeObject(objects.rect)).toBe("Box");
    expect(describeObject(objects.highlight)).toBe("Highlight");
    expect(describeObject(objects.image)).toBe("Image");
  });
});

describe("ObjectShape", () => {
  it("draws text lines at the layout baselines in the preview font", () => {
    const c = draw(
      <ObjectShape
        object={objects.text}
        transform={[1, 0, 0, 1, 5, 6]}
        metrics={fakeMetrics}
      />,
    );
    const lines = c.querySelectorAll("text");
    expect([...lines].map((t) => t.textContent)).toEqual(["Hello", "  world"]);
    expect(lines[0].getAttribute("y")).toBe("8");
    expect(lines[1].getAttribute("y")).toBe("20");
    expect(lines[0].getAttribute("font-family")).toBe(
      PREVIEW_FONT_FAMILY.serif,
    );
    expect(lines[0].getAttribute("xml:space")).toBe("preserve");
    expect(c.querySelector("g")?.getAttribute("transform")).toBe(
      "matrix(1 0 0 1 5 6)",
    );
  });

  it("draws a single ink point as a dot", () => {
    const c = draw(
      <ObjectShape
        object={objects.ink}
        transform={[1, 0, 0, 1, 0, 0]}
        metrics={fakeMetrics}
      />,
    );
    const line = c.querySelector("polyline")!;
    expect(line.getAttribute("points")).toBe("1,2 1,2");
    expect(line.getAttribute("stroke")).toBe("#ff0000");
    expect(line.getAttribute("stroke-linecap")).toBe("round");
  });

  it("draws boxes and highlights", () => {
    const rect = draw(
      <ObjectShape
        object={objects.rect}
        transform={[1, 0, 0, 1, 0, 0]}
        metrics={fakeMetrics}
      />,
    );
    expect(rect.querySelector("rect")?.getAttribute("fill")).toBe("none");
    const hl = draw(
      <ObjectShape
        object={objects.highlight}
        transform={[1, 0, 0, 1, 0, 0]}
        metrics={fakeMetrics}
      />,
    );
    expect(hl.querySelector("rect")?.getAttribute("fill-opacity")).toBe("0.4");
  });

  it("draws images from their preview URL, or a placeholder without one", () => {
    const withUrl = draw(
      <ObjectShape
        object={objects.image}
        transform={[1, 0, 0, 1, 0, 0]}
        metrics={fakeMetrics}
        imageUrl="blob:x"
      />,
    );
    expect(withUrl.querySelector("image")?.getAttribute("href")).toBe("blob:x");
    const without = draw(
      <ObjectShape
        object={objects.image}
        transform={[1, 0, 0, 1, 0, 0]}
        metrics={fakeMetrics}
      />,
    );
    expect(without.querySelector("image")).toBeNull();
  });

  it("is inert unless interactive", () => {
    const c = draw(
      <ObjectShape
        object={objects.rect}
        transform={[1, 0, 0, 1, 0, 0]}
        metrics={fakeMetrics}
      />,
    );
    const g = c.querySelector("g")!;
    expect(g.getAttribute("role")).toBeNull();
    expect(g.getAttribute("class")).toContain("pointer-events-none");
  });

  it("when interactive and selected: focusable, outlined, resizable", () => {
    const onPointerDown = vi.fn();
    const onHandlePointerDown = vi.fn();
    const onFocus = vi.fn();
    const c = draw(
      <ObjectShape
        object={objects.rect}
        transform={[1, 0, 0, 1, 0, 0]}
        metrics={fakeMetrics}
        interactive
        selected
        handleSize={6}
        onPointerDown={onPointerDown}
        onHandlePointerDown={onHandlePointerDown}
        onFocus={onFocus}
      />,
    );
    const g = c.querySelector("g")!;
    expect(g.getAttribute("role")).toBe("button");
    expect(g.getAttribute("aria-label")).toBe("Box");
    expect(g.getAttribute("aria-pressed")).toBe("true");
    expect(c.querySelector("[data-selection-outline]")).not.toBeNull();
    const handle = c.querySelector("[data-resize-handle]")!;
    expect(handle.getAttribute("x")).toBe("17"); // 20 - 6/2
    fireEvent.pointerDown(handle);
    expect(onHandlePointerDown).toHaveBeenCalled();
    fireEvent.pointerDown(g);
    expect(onPointerDown).toHaveBeenCalled();
    fireEvent.focus(g);
    expect(onFocus).toHaveBeenCalled();
  });

  it("has no resize handle for text and ink", () => {
    for (const kind of ["text", "ink"] as const) {
      const c = draw(
        <ObjectShape
          object={objects[kind]}
          transform={[1, 0, 0, 1, 0, 0]}
          metrics={fakeMetrics}
          interactive
          selected
        />,
      );
      expect(c.querySelector("[data-resize-handle]")).toBeNull();
    }
  });

  it("hides its body for an inline editor but keeps outline and hit area", () => {
    const c = draw(
      <ObjectShape
        object={objects.text}
        transform={[1, 0, 0, 1, 0, 0]}
        metrics={fakeMetrics}
        interactive
        selected
        hideBody
      />,
    );
    expect(c.querySelector("text")).toBeNull();
    expect(c.querySelector("[data-selection-outline]")).not.toBeNull();
  });

  it("opens with a double-click or Enter when it can be activated", () => {
    const onActivate = vi.fn();
    const c = draw(
      <ObjectShape
        object={objects.text}
        transform={[1, 0, 0, 1, 0, 0]}
        metrics={fakeMetrics}
        interactive
        onActivate={onActivate}
      />,
    );
    const g = c.querySelector("g")!;
    fireEvent.doubleClick(g);
    fireEvent.keyDown(g, { key: "Enter" });
    fireEvent.keyDown(g, { key: "a" });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });
});
