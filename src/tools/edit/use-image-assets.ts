"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageAsset } from "./core/model";

/** Images added to the document, with a preview URL for each. */
export interface ImageAssets {
  /** Every added image by id (also those no longer used, for redo). */
  assets: ReadonlyMap<string, ImageAsset>;
  /** A `blob:` URL per image id, for drawing it in the page overlay. */
  urls: ReadonlyMap<string, string>;
  /** Store an image and create its preview URL. */
  add(asset: ImageAsset): void;
  /** Forget every image and release its URL. */
  clear(): void;
}

/**
 * Keep the images the user added, plus `blob:` URLs to preview them.
 *
 * A `blob:` URL pins its bytes in memory until it is revoked, so URLs are
 * created when an image is added (an event, not a render, so React's
 * double-rendering in development cannot create spares) and revoked when
 * the images are cleared and when the component unmounts. The URLs point at
 * in-memory data on this device; nothing is uploaded. The page's CSP allows
 * `blob:` images for exactly this.
 *
 * @returns The images, their URLs and the two actions.
 */
export function useImageAssets(): ImageAssets {
  const [state, setState] = useState<{
    assets: Map<string, ImageAsset>;
    urls: Map<string, string>;
  }>(() => ({ assets: new Map(), urls: new Map() }));
  // Mirror of the URLs for the unmount clean-up, which must see the latest.
  const urlsRef = useRef(state.urls);
  useEffect(() => {
    urlsRef.current = state.urls;
  }, [state.urls]);
  useEffect(
    () => () => urlsRef.current.forEach((url) => URL.revokeObjectURL(url)),
    [],
  );

  const add = useCallback((asset: ImageAsset) => {
    const url = URL.createObjectURL(
      new Blob([asset.bytes], { type: asset.mime }),
    );
    setState((prev) => ({
      assets: new Map(prev.assets).set(asset.id, asset),
      urls: new Map(prev.urls).set(asset.id, url),
    }));
  }, []);

  const clear = useCallback(() => {
    setState((prev) => {
      if (prev.assets.size === 0) return prev;
      // React may run this updater twice in development; revoking a URL
      // that is already revoked does nothing, so that is harmless.
      prev.urls.forEach((url) => URL.revokeObjectURL(url));
      return { assets: new Map(), urls: new Map() };
    });
  }, []);

  return { assets: state.assets, urls: state.urls, add, clear };
}
