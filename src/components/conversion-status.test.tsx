import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ConversionState } from "@/lib/html-pdf/conversion-state";
import { ConversionStatus, conversionAnnouncement } from "./conversion-status";

const pdf = new Blob(["x".repeat(2048)], { type: "application/pdf" });

describe("conversionAnnouncement", () => {
  it.each<[ConversionState, string]>([
    [{ kind: "idle" }, ""],
    [{ kind: "converting" }, "Creating the PDF…"],
    [{ kind: "done", pdf }, "PDF ready, 2 KB."],
    [
      { kind: "error", reason: "failed", message: "Bad input." },
      "Could not create the PDF. Bad input.",
    ],
  ])("%j -> %j", (state, expected) => {
    expect(conversionAnnouncement(state)).toBe(expected);
  });
});

describe("ConversionStatus", () => {
  it("announces the state in a polite live region", () => {
    render(<ConversionStatus state={{ kind: "done", pdf }} busyMessage="" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("PDF ready, 2 KB.");
  });

  it("shows the busy hint only while converting", () => {
    const { rerender } = render(
      <ConversionStatus state={{ kind: "converting" }} busyMessage="Hold on" />,
    );
    expect(screen.getByText("Hold on")).toBeInTheDocument();
    rerender(
      <ConversionStatus state={{ kind: "idle" }} busyMessage="Hold on" />,
    );
    expect(screen.queryByText("Hold on")).toBeNull();
  });

  it("shows failures in an alert", () => {
    render(
      <ConversionStatus
        state={{ kind: "error", reason: "crashed", message: "Engine trap." }}
        busyMessage=""
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not create the PDF",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Engine trap.");
  });

  it("titles memory exhaustion as such", () => {
    render(
      <ConversionStatus
        state={{ kind: "error", reason: "out-of-memory", message: "Too big" }}
        busyMessage=""
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Out of memory");
  });
});
