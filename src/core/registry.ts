/**
 * Adapter Registry — discovers and manages platform adapters.
 */

import type { PlatformAdapter, AdapterType } from "../types/index.js";
import { ClaudeAdapter } from "../adapters/claude/index.js";
import { OpenAIAdapter } from "../adapters/openai/index.js";

const adapters: Map<AdapterType, PlatformAdapter> = new Map();

// Register built-in adapters
adapters.set("claude", new ClaudeAdapter());
adapters.set("openai", new OpenAIAdapter());

export function getAdapter(platform: AdapterType): PlatformAdapter {
  const adapter = adapters.get(platform);
  if (!adapter) {
    throw new Error(
      `No adapter found for platform "${platform}". Available: ${[...adapters.keys()].join(", ")}`
    );
  }
  return adapter;
}

export function listAdapters(): PlatformAdapter[] {
  return [...adapters.values()];
}

export async function detectPlatform(
  path: string
): Promise<AdapterType | null> {
  for (const [type, adapter] of adapters) {
    if (await adapter.detect(path)) {
      return type;
    }
  }
  return null;
}

export function registerAdapter(adapter: PlatformAdapter): void {
  adapters.set(adapter.platform, adapter);
}
