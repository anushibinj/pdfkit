/**
 * Checks for what the assembly worker receives. A message from another
 * thread can carry anything, so the plan is validated before qpdf sees it;
 * a bad plan fails with a clear error instead of a confusing qpdf one (or
 * an attempt to build millions of files).
 */

/** A request that cannot be valid, whatever the file. */
export class InvalidRequestError extends Error {
  /** @param message What is wrong. */
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

/** Most output files in one request: the ZIP format's limit. */
export const MAX_OUTPUTS = 65_535;
/**
 * Most pages over all outputs together. Far above any real plan (a
 * 10,000-page file split into single pages lists 10,000), it only stops a
 * runaway request from looping for hours.
 */
export const MAX_TOTAL_PAGES = 1_000_000;

/**
 * Validate the page count and the outputs of an assembly request.
 *
 * Each output must be a non-empty array of whole numbers within
 * `0 .. pageCount - 1`. Checking the indices here matters: qpdf would
 * report an out-of-range page with a message about its own syntax.
 *
 * @param pageCount The claimed page count.
 * @param outputs The claimed outputs.
 * @returns The outputs, typed, as new arrays.
 * @throws {InvalidRequestError} With the first problem found.
 */
export function validateOutputs(
  pageCount: unknown,
  outputs: unknown,
): { pageCount: number; outputs: number[][] } {
  if (!Number.isInteger(pageCount) || (pageCount as number) < 1) {
    throw new InvalidRequestError("The page count is missing or not valid.");
  }
  const count = pageCount as number;
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new InvalidRequestError("There are no files to make.");
  }
  if (outputs.length > MAX_OUTPUTS) {
    throw new InvalidRequestError(
      `That would make ${outputs.length} files; at most ${MAX_OUTPUTS} are possible.`,
    );
  }
  let total = 0;
  const checked = outputs.map((pages: unknown, i) => {
    if (!Array.isArray(pages) || pages.length === 0) {
      throw new InvalidRequestError(`File ${i + 1} has no pages.`);
    }
    total += pages.length;
    if (total > MAX_TOTAL_PAGES) {
      throw new InvalidRequestError("The files would hold too many pages in total.");
    }
    return pages.map((page: unknown) => {
      if (!Number.isInteger(page) || (page as number) < 0 || (page as number) >= count) {
        throw new InvalidRequestError(`File ${i + 1} lists a page that does not exist.`);
      }
      return page as number;
    });
  });
  return { pageCount: count, outputs: checked };
}
