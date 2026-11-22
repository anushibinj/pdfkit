/**
 * Download a file's bytes, failing clearly on an HTTP error (a 404 page
 * would otherwise be handed to `WebAssembly.instantiate` as if it were the
 * module).
 *
 * @param url What to download.
 * @param fetcher The `fetch` to use (injected for tests).
 * @returns The bytes.
 * @throws When the request fails or the response is not OK.
 */
export async function fetchBytes(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<ArrayBuffer> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Could not download ${url} (HTTP ${response.status}).`);
  }
  return response.arrayBuffer();
}
