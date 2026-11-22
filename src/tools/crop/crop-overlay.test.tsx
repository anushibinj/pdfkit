import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CropOverlay, HANDLE_PX, handleOf } from "./crop-overlay";

const view = { width: 200, height: 100 };
const rect = { x: 20, y: 10, width: 100, height: 50 };

/** Render the overlay as if it were 400 x 200 CSS pixels at (0, 0). */
function setup(props: Partial<Parameters<typeof CropOverlay>[0]> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <CropOverlay
      view={view}
      rect={rect}
      cssWidth={400}
      onChange={onChange}
      {...props}
    />,
  );
  const svg = utils.getByTestId("crop-overlay") as unknown as SVGSVGElement;
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 200 }) as DOMRect;
  const handle = (name: string) =>
    utils.container.querySelector(`[data-handle="${name}"]`)!;
  return { ...utils, svg, handle, onChange };
}

describe("CropOverlay", () => {
  it("draws the frame and eight handles sized in screen pixels", () => {
    const { container, handle } = setup();
    expect(container.querySelectorAll("[data-handle]")).toHaveLength(9);
    // 14 CSS px at 2 CSS px per point is 7 points.
    expect(handle("nw").getAttribute("width")).toBe(String(HANDLE_PX / 2));
  });

  it("resizes from a handle, converting pointer pixels to points", () => {
    const { svg, handle, onChange } = setup();
    fireEvent.pointerDown(handle("se"), {
      button: 0,
      clientX: 240,
      clientY: 120,
      pointerId: 1,
    });
    fireEvent.pointerMove(svg, { clientX: 260, clientY: 140, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith({
      x: 20,
      y: 10,
      width: 110,
      height: 60,
    });
    fireEvent.pointerUp(svg, { pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 190, pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("moves the frame", () => {
    const { svg, handle, onChange } = setup();
    fireEvent.pointerDown(handle("move"), {
      button: 0,
      clientX: 100,
      clientY: 50,
      pointerId: 1,
    });
    fireEvent.pointerMove(svg, { clientX: 120, clientY: 40, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith({ ...rect, x: 30, y: 5 });
  });

  it("does nothing while disabled, and draws no handles", () => {
    const { svg, container, handle, onChange } = setup({ disabled: true });
    expect(container.querySelectorAll("[data-handle]")).toHaveLength(1);
    fireEvent.pointerDown(handle("move"), {
      button: 0,
      clientX: 100,
      clientY: 50,
      pointerId: 1,
    });
    fireEvent.pointerMove(svg, { clientX: 120, clientY: 40, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores presses outside the frame and handles", () => {
    const { svg, onChange } = setup();
    fireEvent.pointerDown(svg, {
      button: 0,
      clientX: 1,
      clientY: 1,
      pointerId: 1,
    });
    fireEvent.pointerMove(svg, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("draws nothing when there is no crop area", () => {
    const { container } = setup({ rect: null });
    expect(container.querySelectorAll("rect, path")).toHaveLength(0);
  });
});

describe("handleOf", () => {
  it("reads known handles from data-handle only", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    el.setAttribute("data-handle", "ne");
    expect(handleOf(el)).toBe("ne");
    el.setAttribute("data-handle", "bogus");
    expect(handleOf(el)).toBeNull();
    expect(handleOf(document.createElement("div"))).toBeNull();
    expect(handleOf(null)).toBeNull();
  });
});
