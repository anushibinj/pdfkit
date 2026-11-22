import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_SCROLL_MAX } from "./core/drag";
import { gapAtPoint, useBoardDrag } from "./use-board-drag";

/**
 * A board with three 100 px wide cards side by side at y 0..100; card i
 * spans x = i*100 .. i*100+100. `elementFromPoint` is faked to match.
 */
function makeBoard() {
  const container = document.createElement("div");
  const cards = [0, 1, 2].map((i) => {
    const card = document.createElement("div");
    card.dataset.boardIndex = String(i);
    card.dataset.key = `k${i}`;
    const handle = document.createElement("span");
    handle.dataset.dragHandle = "";
    card.append(handle);
    card.getBoundingClientRect = () =>
      ({ left: i * 100, width: 100, top: 0, height: 100 }) as DOMRect;
    container.append(card);
    return card;
  });
  document.body.append(container);
  document.elementFromPoint = (x: number, y: number) =>
    y >= 0 && y < 100 && x >= 0 && x < 300 ? cards[Math.floor(x / 100)] : null;
  return { container, cards };
}

/** A pointer event for window listeners (jsdom may lack PointerEvent). */
function pointer(type: string, x: number, y: number, pointerId = 1) {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

/** The React event the card's onPointerDown receives. */
function press(
  target: Element,
  x: number,
  y: number,
  pointerType = "mouse",
  button = 0,
) {
  return {
    button,
    pointerType,
    pointerId: 1,
    clientX: x,
    clientY: y,
    target,
  } as unknown as ReactPointerEvent<HTMLElement>;
}

let frames: FrameRequestCallback[];
beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** Mount the hook over the fake board. */
function setup(disabled = false) {
  const { container, cards } = makeBoard();
  const onDrop = vi.fn();
  const keysFor = vi.fn((key: string) => [key]);
  const hook = renderHook(() =>
    useBoardDrag({
      containerRef: { current: container },
      keysFor,
      onDrop,
      disabled,
    }),
  );
  return { container, cards, onDrop, keysFor, hook };
}

describe("gapAtPoint", () => {
  it("finds the gap from the card under the point", () => {
    const { container } = makeBoard();
    expect(gapAtPoint(container, 120, 50)).toBe(1); // left half of card 1
    expect(gapAtPoint(container, 180, 50)).toBe(2); // right half of card 1
    expect(gapAtPoint(container, 50, 500)).toBeNull(); // not over a card
  });

  it("ignores cards outside the board", () => {
    makeBoard();
    expect(gapAtPoint(document.createElement("div"), 120, 50)).toBeNull();
  });
});

describe("useBoardDrag", () => {
  it("a press that does not travel is a click, not a drag", () => {
    const { cards, onDrop, hook } = setup();
    act(() => hook.result.current.onPointerDown(press(cards[0], 10, 10), "k0"));
    act(() => {
      window.dispatchEvent(pointer("pointermove", 12, 11));
      window.dispatchEvent(pointer("pointerup", 12, 11));
    });
    expect(hook.result.current.drag).toBeNull();
    expect(onDrop).not.toHaveBeenCalled();
    expect(hook.result.current.consumeClick()).toBe(false);
  });

  it("drags past the threshold, tracks the gap and drops there", () => {
    const { cards, onDrop, keysFor, hook } = setup();
    act(() => hook.result.current.onPointerDown(press(cards[0], 10, 10), "k0"));
    act(() => {
      window.dispatchEvent(pointer("pointermove", 260, 50));
    });
    expect(keysFor).toHaveBeenCalledWith("k0");
    expect(hook.result.current.drag).toEqual({
      keys: ["k0"],
      x: 260,
      y: 50,
      gap: 3,
    });
    // Crossing a gap between cards keeps the last known gap.
    act(() => {
      window.dispatchEvent(pointer("pointermove", 400, 50));
    });
    expect(hook.result.current.drag?.gap).toBe(3);
    act(() => {
      window.dispatchEvent(pointer("pointerup", 400, 50));
    });
    expect(onDrop).toHaveBeenCalledWith(["k0"], 3);
    expect(hook.result.current.drag).toBeNull();
    // The click that follows the drop is swallowed, once.
    expect(hook.result.current.consumeClick()).toBe(true);
    expect(hook.result.current.consumeClick()).toBe(false);
  });

  it("Escape and pointercancel abandon the drag", () => {
    const { cards, onDrop, hook } = setup();
    act(() => hook.result.current.onPointerDown(press(cards[0], 10, 10), "k0"));
    act(() => {
      window.dispatchEvent(pointer("pointermove", 150, 50));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(hook.result.current.drag).toBeNull();
    act(() => {
      window.dispatchEvent(pointer("pointerup", 150, 50));
    });
    act(() => hook.result.current.onPointerDown(press(cards[0], 10, 10), "k0"));
    act(() => {
      window.dispatchEvent(pointer("pointermove", 150, 50));
      window.dispatchEvent(pointer("pointercancel", 150, 50));
      window.dispatchEvent(pointer("pointerup", 150, 50));
    });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("ignores other pointers (a second finger)", () => {
    const { cards, hook } = setup();
    act(() => hook.result.current.onPointerDown(press(cards[0], 10, 10), "k0"));
    act(() => {
      window.dispatchEvent(pointer("pointermove", 250, 50, 2));
    });
    expect(hook.result.current.drag).toBeNull();
  });

  it("touch drags start only on the grip, so swiping scrolls", () => {
    const { cards, hook } = setup();
    act(() =>
      hook.result.current.onPointerDown(press(cards[0], 10, 10, "touch"), "k0"),
    );
    act(() => {
      window.dispatchEvent(pointer("pointermove", 250, 50));
    });
    expect(hook.result.current.drag).toBeNull();
    const grip = cards[0].querySelector("[data-drag-handle]")!;
    act(() =>
      hook.result.current.onPointerDown(press(grip, 10, 10, "touch"), "k0"),
    );
    act(() => {
      window.dispatchEvent(pointer("pointermove", 250, 50));
    });
    expect(hook.result.current.drag?.keys).toEqual(["k0"]);
  });

  it("does nothing while disabled or for a secondary button", () => {
    const { cards, hook } = setup(true);
    act(() => hook.result.current.onPointerDown(press(cards[0], 10, 10), "k0"));
    act(() => {
      window.dispatchEvent(pointer("pointermove", 250, 50));
    });
    expect(hook.result.current.drag).toBeNull();
    const other = setup();
    act(() =>
      other.hook.result.current.onPointerDown(
        press(other.cards[0], 10, 10, "mouse", 2),
        "k0",
      ),
    );
    act(() => {
      window.dispatchEvent(pointer("pointermove", 250, 50));
    });
    expect(other.hook.result.current.drag).toBeNull();
  });

  it("scrolls the window while the pointer is near an edge", () => {
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const { cards, hook } = setup();
    act(() => hook.result.current.onPointerDown(press(cards[0], 10, 10), "k0"));
    act(() => {
      window.dispatchEvent(pointer("pointermove", 50, window.innerHeight));
    });
    act(() => frames.at(-1)!(0));
    expect(scrollBy).toHaveBeenCalledWith(0, AUTO_SCROLL_MAX);
  });

  it("stops listening when unmounted mid-drag", () => {
    const { cards, onDrop, hook } = setup();
    act(() => hook.result.current.onPointerDown(press(cards[0], 10, 10), "k0"));
    act(() => {
      window.dispatchEvent(pointer("pointermove", 250, 50));
    });
    hook.unmount();
    window.dispatchEvent(pointer("pointerup", 250, 50));
    expect(onDrop).not.toHaveBeenCalled();
  });
});
