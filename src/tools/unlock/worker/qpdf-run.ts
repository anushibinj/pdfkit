/**
 * qpdf output helpers. They now live in `@/lib/qpdf` because several tools
 * run qpdf; re-exported here so existing imports keep working.
 */
export {
  EXIT_ERROR,
  EXIT_OK,
  EXIT_WARNINGS,
  friendlyQpdfMessage,
  isInvalidPassword,
} from "@/lib/qpdf/qpdf-output";

// Shared with other tools; re-exported so existing imports keep working.
export { isOutOfMemory } from "@/lib/errors";
