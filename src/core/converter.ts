/**
 * Core conversion engine — orchestrates import → transform → export pipeline.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgnosticWorkspace, AdapterType } from "../types/workspace.js";
import type { ImportOptions, ExportOptions, ExportResult } from "../types/adapter.js";
import { getAdapter, detectPlatform } from "./registry.js";

export interface ConvertOptions {
  /** Source workspace directory */
  sourcePath: string;

  /** Target output directory */
  targetPath: string;

  /** Source platform (auto-detected if omitted) */
  from?: AdapterType;

  /** Target platform */
  to: AdapterType;

  /** Include binary assets */
  includeAssets?: boolean;

  /** Include knowledge files */
  includeKnowledge?: boolean;

  /** Overwrite existing files */
  overwrite?: boolean;

  /** Also save the intermediate .aiworkspace.json */
  saveIntermediate?: boolean;
}

export interface ConvertResult {
  /** The intermediate representation */
  workspace: AgnosticWorkspace;

  /** Export result from the target adapter */
  exportResult: ExportResult;

  /** Auto-detected source platform (if not specified) */
  detectedPlatform?: AdapterType;
}

export async function convert(options: ConvertOptions): Promise<ConvertResult> {
  const {
    sourcePath,
    targetPath,
    to,
    includeAssets = true,
    includeKnowledge = true,
    overwrite = false,
    saveIntermediate = false,
  } = options;

  // 1. Determine source platform
  let from = options.from;
  let detectedPlatform: AdapterType | undefined;

  if (!from) {
    const detected = await detectPlatform(sourcePath);
    if (!detected) {
      throw new Error(
        `Could not auto-detect platform for "${sourcePath}". ` +
          `Use --from to specify the source platform.`
      );
    }
    from = detected;
    detectedPlatform = detected;
  }

  if (from === to) {
    throw new Error(
      `Source and target platform are the same ("${from}"). Nothing to convert.`
    );
  }

  // 2. Import from source platform
  const sourceAdapter = getAdapter(from);
  const importResult = await sourceAdapter.import({
    sourcePath,
    includeAssets,
    includeKnowledge,
  });

  // 3. Optionally save the intermediate format
  if (saveIntermediate) {
    await mkdir(targetPath, { recursive: true });
    const intermediatePath = join(targetPath, ".aiworkspace.json");
    await writeFile(
      intermediatePath,
      JSON.stringify(importResult.workspace, null, 2),
      "utf-8"
    );
  }

  // 4. Export to target platform
  const targetAdapter = getAdapter(to);
  const exportResult = await targetAdapter.export(importResult.workspace, {
    targetPath,
    overwrite,
    createDir: true,
  });

  return {
    workspace: importResult.workspace,
    exportResult,
    detectedPlatform,
  };
}

/**
 * Export a workspace to the intermediate JSON format (for inspection or piping).
 */
export async function exportToJSON(
  sourcePath: string,
  from?: AdapterType
): Promise<AgnosticWorkspace> {
  if (!from) {
    const detected = await detectPlatform(sourcePath);
    if (!detected) {
      throw new Error(`Could not auto-detect platform for "${sourcePath}".`);
    }
    from = detected;
  }

  const adapter = getAdapter(from);
  const result = await adapter.import({ sourcePath });
  return result.workspace;
}
