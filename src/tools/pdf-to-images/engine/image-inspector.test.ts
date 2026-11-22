import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { describe, expect, it } from "vitest";
import { COLORSPACE } from "../core/jpeg-passthrough";
import { fakeImagesPdfium } from "../test-utils/fake-images-pdfium";
import { PdfiumImageInspector } from "./image-inspector";
import { METADATA } from "./pdfium-api";

function setup() {
  const { api, runtime } = fakeImagesPdfium();
  const inspector = new PdfiumImageInspector(api, new WasmHeap(runtime));
  return { api, runtime, inspector };
}

/** An ICC profile header whose data colour space is `space`. */
const iccHeader = (space: string) => {
  const bytes = new Uint8Array(132);
  bytes.set(
    [...space].map((c) => c.charCodeAt(0)),
    16,
  );
  return bytes;
};

describe("PdfiumImageInspector", () => {
  it("pixelSize reads two unsigned ints and rejects failures and empty images", () => {
    const { api, runtime, inspector } = setup();
    api.FPDFImageObj_GetImagePixelSize.mockImplementation((_o, w, h) => {
      runtime.setValue(w, 640);
      runtime.setValue(h, 480);
      return true;
    });
    expect(inspector.pixelSize(7)).toEqual({ width: 640, height: 480 });
    api.FPDFImageObj_GetImagePixelSize.mockReturnValue(false);
    expect(inspector.pixelSize(7)).toBeNull();
    api.FPDFImageObj_GetImagePixelSize.mockReturnValue(true); // writes nothing: 0 x 0
    expect(inspector.pixelSize(7)).toBeNull();
    expect(runtime.leaks()).toEqual([]);
  });

  it("filters reads each name with the two-call convention", () => {
    const { api, runtime, inspector } = setup();
    const names = ["FlateDecode", "DCTDecode"];
    api.FPDFImageObj_GetImageFilterCount.mockReturnValue(2);
    api.FPDFImageObj_GetImageFilter.mockImplementation((_o, i, buffer) => {
      const bytes = new TextEncoder().encode(`${names[i]}\0`);
      if (buffer) runtime.HEAPU8.set(bytes, buffer);
      return bytes.length;
    });
    expect(inspector.filters(7)).toEqual(names);
    api.FPDFImageObj_GetImageFilterCount.mockReturnValue(-1);
    expect(inspector.filters(7)).toEqual([]);
    expect(runtime.leaks()).toEqual([]);
  });

  it("colorspace reads the metadata field and falls back to UNKNOWN", () => {
    const { api, runtime, inspector } = setup();
    api.FPDFImageObj_GetImageMetadata.mockImplementation((_o, page, ptr) => {
      expect(page).toBe(3);
      runtime.setValue(ptr + METADATA.COLORSPACE_OFFSET, COLORSPACE.ICC_BASED);
      return true;
    });
    expect(inspector.colorspace(3, 7)).toBe(COLORSPACE.ICC_BASED);
    api.FPDFImageObj_GetImageMetadata.mockReturnValue(false);
    expect(inspector.colorspace(3, 7)).toBe(COLORSPACE.UNKNOWN);
    expect(runtime.leaks()).toEqual([]);
  });

  it("iccColourSpace asks for the size, then reads the profile header", () => {
    const { api, runtime, inspector } = setup();
    const profile = iccHeader("GRAY");
    api.FPDFImageObj_GetIccProfileDataDecoded.mockImplementation(
      (_o, _p, buffer, length, lengthPtr) => {
        runtime.setValue(lengthPtr, profile.length);
        if (buffer) {
          expect(length).toBe(profile.length);
          runtime.HEAPU8.set(profile, buffer);
        }
        return true;
      },
    );
    expect(inspector.iccColourSpace(3, 7)).toBe("GRAY");
    expect(api.FPDFImageObj_GetIccProfileDataDecoded.mock.calls[0][2]).toBe(0);
    api.FPDFImageObj_GetIccProfileDataDecoded.mockReturnValue(false);
    expect(inspector.iccColourSpace(3, 7)).toBeNull();
    expect(runtime.leaks()).toEqual([]);
  });

  it("iccColourSpace returns null when the second call fails", () => {
    const { api, runtime, inspector } = setup();
    api.FPDFImageObj_GetIccProfileDataDecoded.mockImplementation(
      (_o, _p, buffer, _l, lengthPtr) => {
        runtime.setValue(lengthPtr, 128);
        return buffer === 0;
      },
    );
    expect(inspector.iccColourSpace(3, 7)).toBeNull();
    expect(runtime.leaks()).toEqual([]);
  });

  it("rawData copies the stream bytes", () => {
    const { api, runtime, inspector } = setup();
    api.FPDFImageObj_GetImageDataRaw.mockImplementation((_o, buffer) => {
      if (buffer) runtime.HEAPU8.set([0xff, 0xd8, 0xff], buffer);
      return 3;
    });
    expect(Array.from(inspector.rawData(7))).toEqual([0xff, 0xd8, 0xff]);
    api.FPDFImageObj_GetImageDataRaw.mockReturnValue(0);
    expect(inspector.rawData(7)).toEqual(new Uint8Array(0));
    expect(runtime.leaks()).toEqual([]);
  });

  it("inspect combines everything and reads ICC only for ICCBased images", () => {
    const { api, runtime, inspector } = setup();
    api.FPDFImageObj_GetImagePixelSize.mockImplementation((_o, w, h) => {
      runtime.setValue(w, 4);
      runtime.setValue(h, 3);
      return true;
    });
    api.FPDFImageObj_GetImageMetadata.mockImplementation((_o, _p, ptr) => {
      runtime.setValue(ptr + METADATA.COLORSPACE_OFFSET, COLORSPACE.DEVICE_RGB);
      return true;
    });
    expect(inspector.inspect(3, 7)).toEqual({
      object: 7,
      width: 4,
      height: 3,
      filters: [],
      colorspace: COLORSPACE.DEVICE_RGB,
      iccColourSpace: null,
      raw: new Uint8Array(0),
    });
    expect(api.FPDFImageObj_GetIccProfileDataDecoded).not.toHaveBeenCalled();

    api.FPDFImageObj_GetImageMetadata.mockImplementation((_o, _p, ptr) => {
      runtime.setValue(ptr + METADATA.COLORSPACE_OFFSET, COLORSPACE.ICC_BASED);
      return true;
    });
    inspector.inspect(3, 7);
    expect(api.FPDFImageObj_GetIccProfileDataDecoded).toHaveBeenCalled();

    api.FPDFImageObj_GetImagePixelSize.mockReturnValue(false);
    expect(inspector.inspect(3, 7)).toBeNull();
    expect(runtime.leaks()).toEqual([]);
  });
});
