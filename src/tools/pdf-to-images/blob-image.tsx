"use client";

import { useCallback } from "react";

interface BlobImageProps {
  blob: Blob;
  alt: string;
  className?: string;
}

/**
 * Show an image held in memory as a Blob.
 *
 * A `blob:` URL pins its bytes until it is revoked, so its lifetime is tied
 * to the `<img>` element through a ref callback with a clean-up (React 19):
 * the URL is created when the element mounts and revoked when it unmounts
 * or the blob changes. No state is involved, so a render can never create a
 * URL that is not cleaned up. The URL points at data on this device; the
 * page's CSP allows `blob:` images for exactly this.
 *
 * @param props The blob, its text alternative and classes.
 * @returns A lazily decoded image.
 */
export function BlobImage({ blob, alt, className }: BlobImageProps) {
  const attach = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return;
      const url = URL.createObjectURL(blob);
      img.src = url;
      return () => {
        img.removeAttribute("src");
        URL.revokeObjectURL(url);
      };
    },
    [blob],
  );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local blob, not an optimisable asset
    <img
      ref={attach}
      alt={alt}
      className={className}
      decoding="async"
      loading="lazy"
    />
  );
}
