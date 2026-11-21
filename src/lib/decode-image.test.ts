import { describe, expect, it, vi } from "vitest";
import { canDecodeImage } from "./decode-image";

describe("canDecodeImage", () => {
  it("decodes the bytes as the given type and frees the bitmap", async () => {
    const close = vi.fn();
    const decode = vi.fn(async () => ({ close }));
    expect(await canDecodeImage(new ArrayBuffer(3), "image/png", decode)).toBe(
      true,
    );
    const [blob] = decode.mock.calls[0] as unknown as [Blob];
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(3);
    expect(close).toHaveBeenCalled();
  });

  it("reports a picture the decoder refuses", async () => {
    const decode = vi.fn(async () => {
      throw new DOMException("The source image could not be decoded.");
    });
    expect(await canDecodeImage(new ArrayBuffer(3), "image/jpeg", decode)).toBe(
      false,
    );
  });

  it("lets the worker decide where no decoder exists", async () => {
    expect(
      await canDecodeImage(new ArrayBuffer(3), "image/png", undefined),
    ).toBe(true);
  });
});
