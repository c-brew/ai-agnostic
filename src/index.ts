/**
 * AI Agnostic — Public API
 *
 * Use this module programmatically (not just via CLI):
 *
 *   import { convert, getAdapter, listAdapters } from "ai-agnostic";
 */

export { convert, exportToJSON, getAdapter, listAdapters, detectPlatform, registerAdapter } from "./core/index.js";
export type * from "./types/index.js";
