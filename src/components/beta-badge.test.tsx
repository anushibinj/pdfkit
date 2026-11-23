import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BetaBadge } from "./beta-badge";

describe("BetaBadge", () => {
  it("renders the Beta pill", () => {
    render(<BetaBadge />);
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("shows the beta message in a popover when hovered", async () => {
    const user = userEvent.setup();
    render(
      <BetaBadge
        note={{
          title: "Beta: limits",
          items: ["First limit", "Second limit"],
          footer: "More coming soon.",
        }}
      />,
    );

    expect(screen.queryByText("Beta: limits")).toBeNull();
    await user.hover(screen.getByText("Beta"));

    await waitFor(() => {
      expect(screen.getByText("Beta: limits")).toBeInTheDocument();
    });
    expect(screen.getByText("First limit")).toBeInTheDocument();
    expect(screen.getByText("Second limit")).toBeInTheDocument();
    expect(screen.getByText("More coming soon.")).toBeInTheDocument();
  });
});
