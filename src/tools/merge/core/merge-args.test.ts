import { describe, expect, it } from "vitest";
import {
  ALL_PAGES,
  mergeArgs,
  pageCountArgs,
  passwordArgs,
} from "./merge-args";

describe("passwordArgs", () => {
  it("passes a password as one argument", () => {
    expect(passwordArgs("hunter2")).toEqual(["--password=hunter2"]);
  });

  it("keeps spaces and dashes inside the single argument", () => {
    expect(passwordArgs("-- a b")).toEqual(["--password=-- a b"]);
  });

  it("adds nothing without a password, or for an empty one", () => {
    expect(passwordArgs()).toEqual([]);
    expect(passwordArgs("")).toEqual([]);
  });
});

describe("pageCountArgs", () => {
  it("asks for the page count", () => {
    expect(pageCountArgs({ path: "/job-1-in.pdf" })).toEqual([
      "--show-npages",
      "/job-1-in.pdf",
    ]);
  });

  it("passes the password before the file", () => {
    expect(pageCountArgs({ path: "/job-1-in.pdf", password: "pw" })).toEqual([
      "--show-npages",
      "--password=pw",
      "/job-1-in.pdf",
    ]);
  });
});

describe("mergeArgs", () => {
  it("selects every page of every file, in order, into an empty document", () => {
    expect(
      mergeArgs(
        [{ path: "/job-1-in-0.pdf" }, { path: "/job-1-in-1.pdf" }],
        "/job-1-out.pdf",
      ),
    ).toEqual([
      "--empty",
      "--pages",
      "/job-1-in-0.pdf",
      ALL_PAGES,
      "/job-1-in-1.pdf",
      ALL_PAGES,
      "--",
      "/job-1-out.pdf",
    ]);
  });

  it("puts each password between its file and its page range", () => {
    expect(
      mergeArgs(
        [
          { path: "/a.pdf" },
          { path: "/b.pdf", password: "x" },
          { path: "/c.pdf", password: "" },
        ],
        "/out.pdf",
      ),
    ).toEqual([
      "--empty",
      "--pages",
      "/a.pdf",
      "1-z",
      "/b.pdf",
      "--password=x",
      "1-z",
      "/c.pdf",
      "1-z",
      "--",
      "/out.pdf",
    ]);
  });

  it("always writes the page range out", () => {
    expect(ALL_PAGES).toBe("1-z");
  });

  it("refuses an empty input list", () => {
    expect(() => mergeArgs([], "/out.pdf")).toThrow("Nothing to merge");
  });
});
