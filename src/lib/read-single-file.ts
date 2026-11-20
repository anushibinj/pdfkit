import { formatBytes } from "./format";

/** Where user-facing messages go; sonner's `toast` fits this shape. */
export interface FileNotifier {
  info(message: string): void;
  error(message: string): void;
}

/** The file that was opened and what was read from it. */
export interface OpenedFile<T> {
  file: File;
  content: T;
}

/**
 * Open one file from a picker or drop, for editors that hold one document.
 *
 * Steps:
 * 1. Only the first file is used; if there were more, the user is told which
 *    one was opened (rather than the others silently disappearing).
 * 2. A file over `maxBytes` is refused with a message, before reading it, so
 *    a huge file never has to be loaded into memory.
 * 3. The file is read with `read`, which decides how bytes become content
 *    (plain UTF-8 text, or text in the encoding an HTML file declares). A
 *    read failure (the file was moved, or permission was revoked) is
 *    reported instead of thrown.
 *
 * @param files The accepted files, in the order the user picked them.
 * @param maxBytes Largest file size to open.
 * @param read Turns the file into content.
 * @param notify Shows messages to the user.
 * @returns The opened file and its content, or `null` when nothing was opened.
 */
export async function readSingleFile<T>(
  files: readonly File[],
  maxBytes: number,
  read: (file: File) => Promise<T>,
  notify: FileNotifier,
): Promise<OpenedFile<T> | null> {
  const [file] = files;
  if (!file) return null;
  if (files.length > 1) notify.info(`Opened ${file.name}. One file at a time.`);
  if (file.size > maxBytes) {
    notify.error(`${file.name} is over ${formatBytes(maxBytes)}.`);
    return null;
  }
  try {
    return { file, content: await read(file) };
  } catch {
    notify.error(`Could not read ${file.name}.`);
    return null;
  }
}
