/**
 * Compress bytes to a zlib stream (RFC 1950: a 2-byte header, deflate data
 * and an Adler-32 checksum), the format PNG's IDAT chunks hold.
 *
 * Uses the platform's native `CompressionStream`. Its "deflate" format is
 * exactly zlib ("deflate-raw" would be the bare RFC 1951 data), and it is
 * available in workers, so nothing has to be bundled. The input is wrapped
 * in a Blob and streamed through the compressor rather than written to it,
 * so a large input cannot deadlock on the stream's backpressure (writing
 * everything before anything is read would stall once the internal queue
 * is full).
 *
 * @param data The bytes to compress.
 * @returns The zlib stream.
 */
export async function deflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const compressed = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}
