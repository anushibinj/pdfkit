/**
 * Hand a Blob to the browser as a file download.
 *
 * A temporary object URL points at the in-memory Blob (nothing is uploaded).
 * A hidden `<a download>` is clicked to start the save, then removed. The URL
 * is revoked a moment later instead of immediately, because some browsers
 * read it asynchronously after the click returns; revoking at once can cancel
 * the download.
 *
 * @param blob The file content.
 * @param fileName The suggested file name.
 * @param revokeAfterMs Delay before the object URL is released.
 */
export function downloadBlob(
  blob: Blob,
  fileName: string,
  revokeAfterMs = 1000,
): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs);
}
