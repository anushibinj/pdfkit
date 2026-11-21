import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useElementWidth, useNearViewport } from "./use-element-observers";

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const width = useElementWidth(ref);
  return (
    <div ref={ref} data-testid="probe">
      {String(near)} {width}
    </div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useNearViewport", () => {
  it("counts everything as near without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toContain("true");
  });

  it("follows the observer's intersection reports", () => {
    let report: (entries: { isIntersecting: boolean }[]) => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: typeof report) {
          report = cb;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toContain("false");
    act(() => report([{ isIntersecting: true }]));
    expect(screen.getByTestId("probe").textContent).toContain("true");
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});

describe("useElementWidth", () => {
  it("reports widths from ResizeObserver", () => {
    let notify: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          notify = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    render(<Probe />);
    const el = screen.getByTestId("probe");
    Object.defineProperty(el, "clientWidth", { value: 640 });
    act(() => notify());
    expect(el.textContent).toContain("640");
  });

  it("falls back to an animation frame and window resizes", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    let frame: () => void = () => {};
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { unmount } = render(<Probe />);
    const el = screen.getByTestId("probe");
    Object.defineProperty(el, "clientWidth", {
      value: 300,
      configurable: true,
    });
    act(() => frame());
    expect(el.textContent).toContain("300");
    Object.defineProperty(el, "clientWidth", { value: 500 });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(el.textContent).toContain("500");
    unmount();
  });
});
