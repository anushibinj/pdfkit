import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProtectionState } from "./protection-state";

const hook = vi.hoisted(() => ({
  state: { kind: "idle" } as ProtectionState,
  protect: vi.fn(),
  cancel: vi.fn(),
  passwordChanged: vi.fn(),
  fileChanged: vi.fn(),
}));
vi.mock("./use-pdf-protection", () => ({ usePdfProtection: () => hook }));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/download", () => ({ downloadBlob: download }));
const toast = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

import ProtectTool, {
  LARGE_FILE_BYTES,
  announcementFor,
  signatureNotice,
} from "./index";

beforeEach(() => {
  hook.state = { kind: "idle" };
  vi.clearAllMocks();
});

const pdfFile = (name = "report.pdf") =>
  new File(["%PDF-1.7"], name, { type: "application/pdf" });

/** Render the tool and pick `files` through the dropzone's file input. */
function renderWithFiles(...files: File[]) {
  const view = render(<ProtectTool />);
  if (files.length > 0) {
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files },
    });
  }
  return view;
}

const passwordBox = () => screen.getByLabelText("Password");
const confirmBox = () => screen.getByLabelText("Confirm password");
const protectButton = () => screen.getByRole("button", { name: /Protect PDF/ });

describe("ProtectTool", () => {
  it("shows only the drop area until a file is chosen", () => {
    renderWithFiles();
    expect(
      screen.getByRole("button", { name: "Choose a PDF file" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("protects the chosen file once the passwords match", async () => {
    const user = userEvent.setup();
    const file = pdfFile();
    renderWithFiles(file);
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(hook.fileChanged).toHaveBeenCalled();
    expect(protectButton()).toBeDisabled();

    await user.type(passwordBox(), "hunter2");
    expect(protectButton()).toBeDisabled();
    await user.type(confirmBox(), "hunter2");
    expect(protectButton()).toBeEnabled();
    await user.click(protectButton());
    expect(hook.protect).toHaveBeenCalledWith(file, "hunter2");
    // every edit invalidates a previous result
    expect(hook.passwordChanged).toHaveBeenCalledTimes(14);
  });

  it("does not protect when the passwords differ", async () => {
    const user = userEvent.setup();
    renderWithFiles(pdfFile());
    await user.type(passwordBox(), "hunter2");
    await user.type(confirmBox(), "hunter3");
    expect(protectButton()).toBeDisabled();
    fireEvent.submit(protectButton().closest("form")!);
    expect(hook.protect).not.toHaveBeenCalled();
  });

  it("opens the first of several files and says so", () => {
    renderWithFiles(pdfFile("a.pdf"), pdfFile("b.pdf"));
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.queryByText("b.pdf")).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining("one file at a time"),
    );
  });

  it("rejects files that are not PDFs", () => {
    renderWithFiles(new File(["x"], "photo.png", { type: "image/png" }));
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("photo.png"),
    );
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("warns about very large files", () => {
    const big = pdfFile("big.pdf");
    Object.defineProperty(big, "size", { value: LARGE_FILE_BYTES + 1 });
    renderWithFiles(big);
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("big.pdf"),
    );
    expect(screen.getByText(/Large file/)).toBeInTheDocument();
  });

  it("removes the file", async () => {
    const user = userEvent.setup();
    renderWithFiles(pdfFile());
    vi.clearAllMocks();
    await user.click(screen.getByRole("button", { name: "Remove report.pdf" }));
    expect(screen.queryByText("report.pdf")).toBeNull();
    expect(hook.fileChanged).toHaveBeenCalledTimes(1);
  });

  it("locks the inputs and offers Cancel while protecting", async () => {
    hook.state = { kind: "protecting" };
    const user = userEvent.setup();
    renderWithFiles(pdfFile());
    expect(screen.getByText("Protecting…")).toBeInTheDocument();
    expect(passwordBox()).toBeDisabled();
    expect(confirmBox()).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Choose a PDF file" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Remove report.pdf" }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Protect PDF/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(hook.cancel).toHaveBeenCalled();
  });

  it("downloads the protected PDF as <name>-protected.pdf", async () => {
    const pdf = new Blob(["%PDF-1.7 encrypted"], { type: "application/pdf" });
    hook.state = {
      kind: "done",
      pdf,
      replacedRestrictions: false,
      invalidatedSignatures: 0,
    };
    const user = userEvent.setup();
    renderWithFiles(pdfFile());
    expect(screen.getByText("Protected")).toBeInTheDocument();
    expect(screen.getByText(/→/)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Download protected PDF/ }),
    );
    expect(download).toHaveBeenCalledWith(pdf, "report-protected.pdf");
  });

  it("explains replaced restrictions and qpdf warnings", () => {
    hook.state = {
      kind: "done",
      pdf: new Blob(["x"]),
      replacedRestrictions: true,
      invalidatedSignatures: 0,
      warnings: "File was repaired",
    };
    renderWithFiles(pdfFile());
    expect(
      screen.getByText(/had printing, copying or editing restrictions/),
    ).toBeInTheDocument();
    expect(screen.getByText(/File was repaired/)).toBeInTheDocument();
  });

  it("warns that the protected copy's signatures are no longer valid", () => {
    hook.state = {
      kind: "done",
      pdf: new Blob(["x"]),
      replacedRestrictions: false,
      invalidatedSignatures: 1,
    };
    renderWithFiles(pdfFile());
    expect(screen.getByText(signatureNotice(1))).toBeInTheDocument();
  });

  it("says nothing about signatures for an unsigned PDF", () => {
    hook.state = {
      kind: "done",
      pdf: new Blob(["x"]),
      replacedRestrictions: false,
      invalidatedSignatures: 0,
    };
    renderWithFiles(pdfFile());
    expect(screen.queryByText(/digital signature/)).toBeNull();
  });

  it("points to the PDF Unlocker for a PDF that already has a password", () => {
    hook.state = { kind: "already-protected" };
    renderWithFiles(pdfFile());
    expect(screen.getByText("Already protected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PDF Unlocker" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/tools\/unlock\/?$/),
    );
  });

  it.each([
    ["out-of-memory", "Out of memory"],
    ["failed", "Could not protect this file"],
  ] as const)("shows a %s error", (reason, title) => {
    hook.state = { kind: "error", reason, message: "Details here" };
    renderWithFiles(pdfFile());
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(title);
    expect(alert).toHaveTextContent("Details here");
  });

  it("announces progress to screen readers", () => {
    hook.state = { kind: "protecting" };
    renderWithFiles(pdfFile());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Protecting report.pdf…",
    );
  });
});

describe("announcementFor", () => {
  it.each<[ProtectionState, string]>([
    [{ kind: "idle" }, ""],
    [{ kind: "protecting" }, "Protecting a.pdf…"],
    [
      {
        kind: "done",
        pdf: new Blob(),
        replacedRestrictions: false,
        invalidatedSignatures: 0,
      },
      "a.pdf is protected. Ready to download.",
    ],
    [{ kind: "already-protected" }, "a.pdf already needs a password to open."],
    [
      { kind: "error", reason: "failed", message: "Bad." },
      "Could not protect a.pdf. Bad.",
    ],
  ])("%j", (state, text) => {
    expect(announcementFor(state, "a.pdf")).toBe(text);
  });
});

describe("signatureNotice", () => {
  it("uses singular wording for one signature", () => {
    expect(signatureNotice(1)).toBe(
      "This PDF had a digital signature. Protecting it rewrites the file, so in the protected copy it is no longer valid. Keep the original if you need the signed version.",
    );
  });

  it("uses plural wording and the count for several", () => {
    expect(signatureNotice(3)).toMatch(
      /^This PDF had 3 digital signatures\..* they are no longer valid\./,
    );
  });
});
