import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_MARGINS } from "./core/margins";
import { PagePreview, type PagePreviewProps } from "./page-preview";

const info = {
  box: { left: 0, bottom: 0, right: 200, top: 100 },
  rotation: 0 as const,
};

beforeEach(() => {
  // jsdom has no layout or canvas: give the page box a width and stub the
  // 2D context so rendering can be observed.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ putImageData: vi.fn() }) as unknown as CanvasRenderingContext2D,
  );
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(props: Partial<PagePreviewProps> = {}) {
  const all: PagePreviewProps = {
    pageIndex: 0,
    pageCount: 3,
    info,
    renderPage: vi.fn(async () => ({
      status: "rendered" as const,
      width: 4,
      height: 2,
      pixels: new ArrayBuffer(32),
    })),
    margins: NO_MARGINS,
    onMarginsChange: vi.fn(),
    onPageChange: vi.fn(),
    ...props,
  };
  return { ...render(<PagePreview {...all} />), props: all };
}

describe("PagePreview", () => {
  it("renders the page and paints it", async () => {
    const { props, container } = setup();
    await waitFor(() => expect(props.renderPage).toHaveBeenCalled());
    const [index, width] = (props.renderPage as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(index).toBe(0);
    expect(width).toBeGreaterThanOrEqual(400);
    await waitFor(() =>
      expect(
        (container.querySelector("canvas") as HTMLCanvasElement).width,
      ).toBe(4),
    );
  });

  it("shows a render error", async () => {
    setup({
      renderPage: vi.fn(async () => ({
        status: "error" as const,
        reason: "failed" as const,
        message: "broken page",
      })),
    });
    expect(await screen.findByText(/broken page/)).toBeInTheDocument();
  });

  it("moves between pages", async () => {
    const user = userEvent.setup();
    const { props } = setup({ pageIndex: 1 });
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(props.onPageChange).toHaveBeenNthCalledWith(1, 0);
    expect(props.onPageChange).toHaveBeenNthCalledWith(2, 2);
  });

  it("disables the page buttons at the ends and while disabled", () => {
    setup({ pageIndex: 0, pageCount: 1 });
    expect(
      screen.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("turns a drag on the page into margins", () => {
    const { props, container } = setup();
    // Not the first <svg>: the page buttons' icons are SVGs too.
    const svg = screen.getByTestId("crop-overlay");
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 200 }) as DOMRect;
    const handle = container.querySelector('[data-handle="w"]')!;
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 0,
      clientY: 100,
      pointerId: 1,
    });
    fireEvent.pointerMove(svg, { clientX: 40, clientY: 100, pointerId: 1 });
    // 40 CSS px at 2 px per point is 20 points from the left edge.
    expect(props.onMarginsChange).toHaveBeenLastCalledWith({
      top: 0,
      right: 0,
      bottom: 0,
      left: 20,
    });
  });

  it("warns when the margins leave nothing on this page", () => {
    setup({ margins: { ...NO_MARGINS, left: 195 } });
    expect(
      screen.getByText(/leave nothing to keep on this page/),
    ).toBeInTheDocument();
  });

  it("warns specifically when margins are empty or negative", () => {
    setup({ margins: { ...NO_MARGINS, top: NaN } });
    expect(
      screen.getByText("Enter a number for each margin."),
    ).toBeInTheDocument();
  });
});
