import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  describeSkippedResources,
  type SkippedResources,
} from "./core/skipped-resources";

/**
 * Tells the user, next to the finished PDF, what the engine left out of it
 * (images, linked stylesheets, scripts) and what to do instead. Renders
 * nothing when the document was self-contained.
 *
 * It is a `note` rather than an `alert`: the PDF was made successfully, and
 * the live region has already announced that.
 *
 * @param props The counts from `scanHtmlForSkippedResources`.
 * @returns The notice, or `null`.
 */
export function SkippedResourcesNotice({
  skipped,
}: {
  skipped: SkippedResources;
}) {
  const lines = describeSkippedResources(skipped);
  if (lines.length === 0) return null;
  return (
    <Alert role="note">
      <Info aria-hidden="true" />
      <AlertTitle>Some content is not in the PDF</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-1 pl-4">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
