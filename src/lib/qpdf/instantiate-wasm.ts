/** Instantiates a WebAssembly binary with the imports Emscripten provides. */
export type WasmInstantiator = (
  imports: WebAssembly.Imports,
) => Promise<WebAssembly.Instance>;

/** The `fetch` signature, injectable for tests. */
export type Fetcher = (url: string) => Promise<Response>;

/**
 * Instantiate the binary at `url`, compiling while it downloads.
 *
 * `WebAssembly.instantiateStreaming` needs the server to send the file as
 * `application/wasm`. Some static hosts and dev servers do not, and the
 * streaming call then rejects; in that case the file is downloaded again as
 * plain bytes and instantiated from those. (A cached copy usually makes the
 * second request free.)
 *
 * @param url Absolute URL of the `.wasm` file.
 * @param fetcher The `fetch` function (injected for tests).
 * @returns A function that instantiates the binary with given imports.
 */
export function instantiateFromUrl(
  url: string,
  fetcher: Fetcher = (u) => fetch(u),
): WasmInstantiator {
  return async (imports) => {
    try {
      const { instance } = await WebAssembly.instantiateStreaming(
        fetcher(url),
        imports,
      );
      return instance;
    } catch {
      const bytes = await (await fetcher(url)).arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, imports);
      return instance;
    }
  };
}
