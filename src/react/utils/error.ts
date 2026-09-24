/**
 * Re-export shared error utilities for React components.
 *
 * Core implementations live in ../../utils/error.ts (toErrorMessage).
 * React-specific friendlyErrorMessage lives in ./locale.ts.
 */

export { toErrorMessage } from "../../utils/error";
export { friendlyErrorMessage } from "./locale";
