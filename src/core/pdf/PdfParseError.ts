/**
 * PdfParseError — Explicit error type for the OpenDataLoader-only PDF pipeline.
 *
 * OpenDataLoader is the single PDF parsing backend in Leadero. There is no
 * silent fallback: when parsing fails, a PdfParseError propagates to the
 * caller with an actionable reason so the UI can surface it to the user.
 */

export type PdfParseErrorReason =
  | "disabled" // PDF parsing switch is off
  | "no-attachment" // item has no PDF attachment
  | "java-missing" // java executable not found on this machine
  | "jar-missing" // opendataloader-pdf-cli.jar missing
  | "timeout" // JVM process timed out
  | "parse-failed" // ODL ran but produced no/invalid output
  | "no-text"; // parsed fine but the PDF has no extractable text

export class PdfParseError extends Error {
  readonly reason: PdfParseErrorReason;

  constructor(reason: PdfParseErrorReason, detail?: string) {
    super(userHint(reason, detail));
    this.name = "PdfParseError";
    this.reason = reason;
  }
}

function userHint(reason: PdfParseErrorReason, detail?: string): string {
  const suffix = detail ? ` (${detail})` : "";
  switch (reason) {
    case "disabled":
      return "PDF parsing is disabled. Enable it in Leadero preferences.";
    case "no-attachment":
      return "No PDF attachment found for this item.";
    case "java-missing":
      return "Java runtime not found. OpenDataLoader requires Java 11+. Install Java, make sure `java` is on PATH, then retry.";
    case "jar-missing":
      return "OpenDataLoader JAR is missing. Reinstall Leadero to restore opendataloader-pdf-cli.jar.";
    case "timeout":
      return `OpenDataLoader parsing timed out${suffix}.`;
    case "parse-failed":
      return `OpenDataLoader parsing failed${suffix ? `: ${detail}` : "."}`;
    case "no-text":
      return "PDF parsed but no extractable text was found (scanned PDF? OpenDataLoader does not OCR).";
  }
}

/**
 * Map a raw OpenDataLoader error string to a structured reason.
 * The strings originate from OpenDataLoaderPdfClient / opendataloader-pdf-parser.
 */
export function classifyOdlError(error: string): PdfParseErrorReason {
  const e = error.toLowerCase();
  if (e.includes("not enabled")) return "disabled";
  if (
    e.includes("no pdf attachment") ||
    e.includes("file path not available")
  ) {
    return "no-attachment";
  }
  if (e.includes("java executable not found") || e.includes("no java")) {
    return "java-missing";
  }
  if (e.includes("jar")) return "jar-missing";
  if (e.includes("timed out") || e.includes("timeout")) return "timeout";
  return "parse-failed";
}
