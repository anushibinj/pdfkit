/**
 * Downloads a file's bytes, failing clearly on an HTTP error.
 *
 * Implements Single Responsibility Principle (SRP) by isolating network fetching
 * from WebAssembly compilation and runtime execution.
 *
 * @param url The URL of the file to download.
 * @param fetcher Injected fetch implementation (defaults to global fetch).
 * @returns An ArrayBuffer containing the raw downloaded bytes.
 * @throws {Error} When the HTTP response is not OK.
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
