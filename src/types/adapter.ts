/**
 * Adapter interface — every platform adapter implements this contract.
 *
 * The pattern:
 *   Platform-native format → (import) → AgnosticWorkspace → (export) → Platform-native format
 */

import type { AgnosticWorkspace, AdapterType } from "./workspace.js";

export interface ImportOptions {
  /** Root directory of the workspace to import */
  sourcePath: string;

  /** Whether to include binary assets (can be large) */
  includeAssets?: boolean;

  /** Whether to include knowledge files */
  includeKnowledge?: boolean;
}

export interface ExportOptions {
  /** Target directory to write the exported workspace */
  targetPath: string;

  /** Whether to overwrite existing files */
  overwrite?: boolean;

  /** Whether to create the directory if it doesn't exist */
  createDir?: boolean;
}

export interface ImportResult {
  workspace: AgnosticWorkspace;
  warnings: string[];
  /** Items that couldn't be imported */
  skipped: SkippedItem[];
}

export interface ExportResult {
  /** Files that were written */
  filesWritten: string[];
  warnings: string[];
  /** Items from the workspace that couldn't be exported to this platform */
  unsupported: UnsupportedItem[];
}

export interface SkippedItem {
  type: "skill" | "tool" | "knowledge" | "config";
  name: string;
  reason: string;
}

export interface UnsupportedItem {
  type: "skill" | "tool" | "knowledge" | "config" | "capability";
  name: string;
  reason: string;
  /** Suggestion for manual workaround */
  suggestion?: string;
}

export interface PlatformAdapter {
  /** Which platform this adapter handles */
  readonly platform: AdapterType;

  /** Human-readable adapter name */
  readonly displayName: string;

  /** Read a platform-native workspace and convert to universal format */
  import(options: ImportOptions): Promise<ImportResult>;

  /** Write a universal workspace to platform-native format */
  export(workspace: AgnosticWorkspace, options: ExportOptions): Promise<ExportResult>;

  /** Check if a directory looks like this platform's workspace */
  detect(path: string): Promise<boolean>;
}
