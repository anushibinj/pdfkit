/**
 * Same-origin WebAssembly binary fetcher for the Compress PDF worker.
 *
 * @param url Same-origin URL to a `.wasm` asset.
 * @returns Raw `ArrayBuffer` of the fetched WebAssembly binary.
 * @throws When the HTTP response is not OK.
 */
export async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch WebAssembly module (${response.status} ${response.statusText})`,
    );
  }
  return response.arrayBuffer();
}
