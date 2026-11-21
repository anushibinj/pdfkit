import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PasswordPrompt } from "./password-prompt";

describe("PasswordPrompt", () => {
  it("submits the typed password", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PasswordPrompt
        fileName="locked.pdf"
        wrong={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("locked.pdf");
    const open = screen.getByRole("button", { name: "Open" });
    expect(open).toBeDisabled();
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(open);
    expect(onSubmit).toHaveBeenCalledWith("hunter2");
  });

  it("flags a wrong password and can be cancelled", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <PasswordPrompt
        fileName="a.pdf"
        wrong
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Wrong password");
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("does not submit twice while busy", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PasswordPrompt
        fileName="a.pdf"
        wrong={false}
        busy
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Password"), "x{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Opening…" })).toBeDisabled();
  });

  it("adds the tool's note after the privacy sentence", () => {
    render(
      <PasswordPrompt
        fileName="a.pdf"
        wrong={false}
        note="The new files keep the same password."
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "It is used only on this device. The new files keep the same password.",
    );
  });
});
