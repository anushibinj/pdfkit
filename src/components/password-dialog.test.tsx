import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PasswordDialog } from "./password-dialog";

const setup = (wrong = false) => {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <PasswordDialog
      fileName="report.pdf"
      wrong={wrong}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  );
  return { onSubmit, onCancel, user: userEvent.setup() };
};

describe("PasswordDialog", () => {
  it("names the file and submits the typed password", async () => {
    const { onSubmit, user } = setup();
    expect(screen.getByRole("dialog")).toHaveTextContent("report.pdf");
    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect(unlock).toBeDisabled();
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(unlock);
    expect(onSubmit).toHaveBeenCalledWith("hunter2");
  });

  it("shows a wrong password as an alert on the field", () => {
    setup(true);
    expect(screen.getByRole("alert")).toHaveTextContent(/Wrong password/);
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("can be skipped", async () => {
    const { onCancel, onSubmit, user } = setup();
    await user.click(screen.getByRole("button", { name: "Skip this file" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
