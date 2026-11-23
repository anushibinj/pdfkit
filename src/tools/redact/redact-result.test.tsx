import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RedactionReport } from "./core/model";
import { RedactResult } from "./redact-result";

const REPORT: RedactionReport = {
  pagesRedacted: 2,
  marksApplied: 5,
  textObjectsRemoved: 3,
  textObjectsSplit: 2,
  imagesModified: 1,
  pathsRemoved: 4,
  annotationsRemoved: 2,
  pagesRasterized: 0,
  sanitize: {
    metadataEntriesRemoved: 3,
    xmpStreamsRemoved: 1,
    attachmentsRemoved: 0,
    javascriptActionsRemoved: 0,
    hiddenLayersRemoved: 0,
    bookmarksCleaned: 1,
    annotationsRemoved: 0,
    formValuesCleared: 0,
    objectsPruned: 12,
  },
  verification: {
    verified: true,
    totalTerms: 5,
    remainingTerms: 0,
    leakedTerms: [],
    summary: "0 of 5 redacted terms remain",
  },
};

describe("RedactResult", () => {
  it("renders the post-save verification verdict, breakdown, download, and back actions", () => {
    const onDownload = vi.fn();
    const onBack = vi.fn();

    render(
      <RedactResult
        report={REPORT}
        fileName="contract-redacted.pdf"
        onDownload={onDownload}
        onBack={onBack}
      />,
    );

    expect(screen.getByText("Verified after saving")).toBeInTheDocument();
    expect(screen.getByText("0 of 5 redacted terms remain")).toBeInTheDocument();
    expect(screen.getByText(/1 image pixel-blanked/i)).toBeInTheDocument();
    expect(
      screen.getByText(/1 bookmark titles scrubbed/i),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /download contract-redacted\.pdf/i }),
    );
    expect(onDownload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Back to review" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
