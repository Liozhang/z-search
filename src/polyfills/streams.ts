/**
 * Patch Web Streams API globals (TransformStream/ReadableStream/WritableStream).
 *
 * Why this exists: ai@7's `eventsource-parser` (SSE parsing) declares
 * `class EventSourceParserStream extends TransformStream` at module top-level. The class
 * definition resolves `TransformStream` from the global scope at module-load time, and
 * Zotero's SpiderMonkey has no Web Streams API → ReferenceError → addon bootstrap fails.
 *
 * Why a dedicated module: the top-level assignment below runs during THIS module's init,
 * which (via ESM depth-first ordering) executes before the `./addon` → ai@7 dependency
 * chain imported from src/index.ts. Putting the assignment directly in index.ts would run
 * it only after all dependencies (including ai@7) have initialized — too late.
 *
 * Why ponyfill not /polyfill: the `/polyfill` side-effect entry uses `declare global { ... }`
 * in its .d.ts, which augments the DOM lib types and breaks type inference across the
 * codebase (46 TS18047/TS2339/TS2769 errors on Node/Event/addEventListener). The ponyfill
 * entry only does module exports — no global type pollution.
 */
import {
  TransformStream,
  ReadableStream,
  WritableStream,
} from "web-streams-polyfill";

if (typeof (globalThis as any).TransformStream === "undefined") {
  (globalThis as any).TransformStream = TransformStream;
}
if (typeof (globalThis as any).ReadableStream === "undefined") {
  (globalThis as any).ReadableStream = ReadableStream;
}
if (typeof (globalThis as any).WritableStream === "undefined") {
  (globalThis as any).WritableStream = WritableStream;
}
