import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ImagesToPdfTool, {
  focusMoveButton,
  imagesLabel,
  isSupportedImageFile,
  outcomeAnnouncement,
  summaryText,
} from "./index";

describe("ImagesToPdfTool helpers", () => {
  it("isSupportedImageFile matches PNG and JPEG by MIME or extension", () => {
    expect(isSupportedImageFile({ name: "a.png", type: "image/png" })).toBe(true);
    expect(isSupportedImageFile({ name: "a.JPEG", type: "" })).toBe(true);
    expect(isSupportedImageFile({ name: "a.jpg", type: "" })).toBe(true);
    expect(isSupportedImageFile({ name: "doc.pdf", type: "application/pdf" })).toBe(
      false,
    );
  });

  it("imagesLabel handles singular and plural counts", () => {
    expect(imagesLabel(1)).toBe("1 image");
    expect(imagesLabel(3)).toBe("3 images");
  });

  it("summaryText formats blockers and ready summaries", () => {
    expect(
      summaryText({ imageCount: 0, totalBytes: 0, blocker: "empty" }),
    ).toMatch(/at least one/i);
    expect(
      summaryText({ imageCount: 2, totalBytes: 2048 }),
    ).toBe("2 images, 2 KB");
  });

  it("outcomeAnnouncement covers idle, building, done, and error states", () => {
    expect(outcomeAnnouncement({ kind: "idle" })).toBe("");
    expect(
      outcomeAnnouncement({
        kind: "building",
        progress: 0.5,
        stage: "Adding image 1 of 2…",
      }),
    ).toBe("Adding image 1 of 2…");
    expect(
      outcomeAnnouncement({
        kind: "done",
        pdf: new Blob([new Uint8Array(100)]),
        pageCount: 1,
      }),
    ).toMatch(/PDF ready, 1 page/);
    expect(
      outcomeAnnouncement({
        kind: "error",
        reason: "failed",
        message: "Broken file",
      }),
    ).toBe("Could not create the PDF. Broken file");
  });

  it("focusMoveButton falls back to the opposite button when reaching list bounds", () => {
    const list = document.createElement("ol");
    const up = document.createElement("button");
    up.dataset.moveId = "1";
    up.dataset.moveOffset = "-1";
    up.disabled = true;
    const down = document.createElement("button");
    down.dataset.moveId = "1";
    down.dataset.moveOffset = "1";
    list.append(up, down);
    document.body.append(list);

    focusMoveButton(list, "1", -1);
    expect(document.activeElement).toBe(down);
    list.remove();
  });
});

describe("ImagesToPdfTool component", () => {
  it("renders the beta notice and image dropzone", () => {
    render(<ImagesToPdfTool />);
    expect(screen.getByText(/Drop PNG or JPEG images here/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose images/i })).toBeInTheDocument();
  });
});
