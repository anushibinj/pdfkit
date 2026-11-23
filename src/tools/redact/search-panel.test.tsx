import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchPanel } from "./search-panel";

describe("SearchPanel", () => {
  it("runs preset search with all 7 presets enabled by default", () => {
    const onSearch = vi.fn(async () => {});
    render(<SearchPanel onSearch={onSearch} />);

    fireEvent.click(screen.getByRole("button", { name: /find matches/i }));
    expect(onSearch).toHaveBeenCalledWith({
      mode: "presets",
      presets: ["email", "phone", "pan", "aadhaar", "ifsc", "card", "date"],
    });
  });

  it("switches to Plain text and Regex tabs and validates empty or invalid inputs", () => {
    const onSearch = vi.fn(async () => {});
    render(<SearchPanel onSearch={onSearch} />);

    fireEvent.click(screen.getByRole("tab", { name: "Plain text" }));
    fireEvent.click(screen.getByRole("button", { name: /find matches/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/enter text/i);

    fireEvent.change(screen.getByLabelText(/text to find/i), {
      target: { value: "Secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /find matches/i }));
    expect(onSearch).toHaveBeenCalledWith({
      mode: "text",
      query: "Secret",
      caseSensitive: false,
    });

    fireEvent.click(screen.getByRole("tab", { name: "Regex" }));
    fireEvent.change(screen.getByLabelText(/regular expression/i), {
      target: { value: "[invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: /find matches/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/regular expression/i), {
      target: { value: "ACC-\\d+" },
    });
    fireEvent.click(screen.getByRole("button", { name: /find matches/i }));
    expect(onSearch).toHaveBeenLastCalledWith({
      mode: "regex",
      pattern: "ACC-\\d+",
      caseSensitive: false,
    });
  });
});
