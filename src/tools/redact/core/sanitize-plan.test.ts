import { describe, expect, it } from "vitest";
import {
  InvalidRedactionPlanError,
  encodeSanitizePlan,
  sanitizeBox,
  sanitizeCleanupOptions,
  sanitizeMark,
  sanitizeRedactionPlan,
  sanitizeStyle,
} from "./sanitize-plan";

describe("sanitize-plan", () => {
  it("normalises inverted box coordinates and rejects empty or non-finite boxes", () => {
    expect(sanitizeBox({ left: 100, bottom: 50, right: 20, top: 10 })).toEqual({
      left: 20,
      bottom: 10,
      right: 100,
      top: 50,
    });
    expect(() => sanitizeBox(null)).toThrow(InvalidRedactionPlanError);
    expect(() =>
      sanitizeBox({ left: 0, bottom: 0, right: 0, top: 10 }),
    ).toThrow(InvalidRedactionPlanError);
    expect(() =>
      sanitizeBox({ left: Number.NaN, bottom: 0, right: 10, top: 10 }),
    ).toThrow(InvalidRedactionPlanError);
  });

  it("sanitizes individual marks and rejects out-of-range page indices", () => {
    const mark = sanitizeMark(
      {
        id: "m1",
        pageIndex: 0,
        box: { left: 10, bottom: 10, right: 50, top: 20 },
        term: "secret",
        source: "email",
        label: "Email",
        enabled: true,
      },
      2,
    );
    expect(mark.source).toBe("email");
    expect(mark.enabled).toBe(true);

    expect(() =>
      sanitizeMark(
        {
          id: "m2",
          pageIndex: 2,
          box: { left: 10, bottom: 10, right: 50, top: 20 },
        },
        2,
      ),
    ).toThrow(InvalidRedactionPlanError);
  });

  it("sanitizes style, cleanup options, and full plans", () => {
    expect(sanitizeStyle({ fill: "white", label: "  CONFIDENTIAL  " })).toEqual(
      { fill: "white", label: "CONFIDENTIAL" },
    );
    expect(sanitizeStyle(null)).toEqual({ fill: "black", label: "REDACTED" });

    expect(
      sanitizeCleanupOptions({
        metadata: false,
        attachments: true,
        javascript: false,
        hiddenLayers: true,
        bookmarks: false,
      }),
    ).toEqual({
      metadata: false,
      attachments: true,
      javascript: false,
      hiddenLayers: true,
      bookmarks: false,
    });

    const plan = sanitizeRedactionPlan(
      {
        marks: [
          {
            id: "m1",
            pageIndex: 0,
            box: { left: 10, bottom: 20, right: 60, top: 40 },
            term: "alice@example.com",
            source: "email",
            label: "Email",
            enabled: true,
          },
        ],
        style: { fill: "black", label: "" },
        cleanup: { metadata: true },
        rasterizePages: true,
      },
      1,
    );
    expect(plan.rasterizePages).toBe(true);
    expect(plan.style.label).toBe("");

    expect(() =>
      sanitizeRedactionPlan(
        {
          marks: [
            {
              id: "m1",
              pageIndex: 0,
              box: { left: 10, bottom: 20, right: 60, top: 40 },
              enabled: false,
            },
          ],
        },
        1,
      ),
    ).toThrow(InvalidRedactionPlanError);
  });

  it("encodes binary SanitizePlan matching the Rust wire format", () => {
    const encoded = encodeSanitizePlan(
      {
        metadata: true,
        attachments: false,
        javascript: true,
        hiddenLayers: false,
        bookmarks: true,
      },
      "REDACTED",
      ["alice@example.com"],
      [{ pageIndex: 0, box: { left: 10, bottom: 20, right: 50, top: 40 } }],
    );
    const view = new DataView(encoded.buffer);
    expect(view.getUint32(0, true)).toBe(1); // version
    expect(view.getUint32(4, true)).toBe((1 << 0) | (1 << 2) | (1 << 4)); // flags
    expect(view.getUint32(8, true)).toBe(8); // "REDACTED".length
    expect(encoded.byteLength).toBe(4 + 4 + 12 + 4 + 21 + 4 + 36);
  });
});
