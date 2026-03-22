/**
 * Integration tests for the core converter and adapter registry.
 *
 * These tests exercise the full pipeline end-to-end:
 * real workspace directories → detect → import → export → output files.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectPlatform, listAdapters, getAdapter } from "../core/registry.js";
import { convert } from "../core/index.js";

let tmp: string;

beforeEach(async () => {
  tmp = join(tmpdir(), `ai-agnostic-integration-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

// ─── Helpers ──────────────────────────────────────────────────────

async function createClaudeWorkspace(root: string, options: {
  claudeMd?: string;
  skills?: Array<{ id: string; name: string; description: string; prompt: string }>;
  mcpServers?: Record<string, { command: string; args: string[] }>;
} = {}) {
  const { claudeMd = "You are a helpful assistant.", skills = [], mcpServers } = options;

  await writeFile(join(root, "CLAUDE.md"), claudeMd, "utf-8");

  for (const skill of skills) {
    const skillDir = join(root, ".skills", "skills", skill.id);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.prompt}`,
      "utf-8"
    );
  }

  if (mcpServers) {
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({ mcpServers }),
      "utf-8"
    );
  }
}

// ─── Registry ─────────────────────────────────────────────────────

describe("Adapter Registry", () => {
  it("lists both built-in adapters", () => {
    const adapters = listAdapters();
    const platforms = adapters.map((a) => a.platform);
    expect(platforms).toContain("claude");
    expect(platforms).toContain("openai");
  });

  it("returns the Claude adapter by name", () => {
    const adapter = getAdapter("claude");
    expect(adapter.platform).toBe("claude");
    expect(adapter.displayName).toBeTruthy();
  });

  it("returns the OpenAI adapter by name", () => {
    const adapter = getAdapter("openai");
    expect(adapter.platform).toBe("openai");
  });

  it("throws for an unknown platform", () => {
    expect(() => getAdapter("gemini" as never)).toThrow();
  });
});

// ─── detectPlatform() ─────────────────────────────────────────────

describe("detectPlatform()", () => {
  it("returns null for an empty directory", async () => {
    const result = await detectPlatform(tmp);
    expect(result).toBeNull();
  });

  it("detects a Claude workspace", async () => {
    await writeFile(join(tmp, "CLAUDE.md"), "# Workspace", "utf-8");
    const result = await detectPlatform(tmp);
    expect(result).toBe("claude");
  });

  it("detects a Claude workspace via .skills directory", async () => {
    await mkdir(join(tmp, ".skills"), { recursive: true });
    const result = await detectPlatform(tmp);
    expect(result).toBe("claude");
  });

  it("detects an OpenAI workspace via gpts/ directory", async () => {
    await mkdir(join(tmp, "gpts"), { recursive: true });
    const result = await detectPlatform(tmp);
    expect(result).toBe("openai");
  });

  it("detects an OpenAI workspace via assistants/ directory", async () => {
    await mkdir(join(tmp, "assistants"), { recursive: true });
    const result = await detectPlatform(tmp);
    expect(result).toBe("openai");
  });

  it("returns null for an unrelated directory", async () => {
    await writeFile(join(tmp, "random.txt"), "hello", "utf-8");
    const result = await detectPlatform(tmp);
    expect(result).toBeNull();
  });
});

// ─── Full Conversion Pipeline ─────────────────────────────────────

describe("Claude → OpenAI conversion", () => {
  it("converts a minimal Claude workspace to OpenAI format", async () => {
    const source = join(tmp, "claude-workspace");
    const target = join(tmp, "openai-output");
    await mkdir(source, { recursive: true });
    await createClaudeWorkspace(source);

    await convert({ sourcePath: source, targetPath: target, to: "openai" });

    const { stat } = await import("node:fs/promises");
    await expect(stat(target)).resolves.toBeDefined();
  });

  it("produces GPT and Assistant configs for each skill", async () => {
    const source = join(tmp, "claude-workspace");
    const target = join(tmp, "openai-output");
    await mkdir(source, { recursive: true });
    await createClaudeWorkspace(source, {
      skills: [
        { id: "reviewer", name: "Code Reviewer", description: "Reviews code", prompt: "Review code carefully." },
        { id: "writer", name: "Doc Writer", description: "Writes docs", prompt: "Write clear documentation." },
      ],
    });

    await convert({ sourcePath: source, targetPath: target, to: "openai" });

    const gptFiles = await readdir(join(target, "gpts"));
    const assistantFiles = await readdir(join(target, "assistants"));
    expect(gptFiles).toHaveLength(2);
    expect(assistantFiles).toHaveLength(2);
  });

  it("generates a MIGRATION_GUIDE.md in the output", async () => {
    const source = join(tmp, "claude-workspace");
    const target = join(tmp, "openai-output");
    await mkdir(source, { recursive: true });
    await createClaudeWorkspace(source);

    await convert({ sourcePath: source, targetPath: target, to: "openai" });

    const guide = await readFile(join(target, "MIGRATION_GUIDE.md"), "utf-8");
    expect(guide).toContain("Migration Guide");
    expect(guide).toContain("Next Steps");
  });

  it("preserves skill name and description through conversion", async () => {
    const source = join(tmp, "claude-workspace");
    const target = join(tmp, "openai-output");
    await mkdir(source, { recursive: true });
    await createClaudeWorkspace(source, {
      skills: [{ id: "my-skill", name: "My Skill", description: "Does things", prompt: "You are helpful." }],
    });

    await convert({ sourcePath: source, targetPath: target, to: "openai" });

    const gptFiles = await readdir(join(target, "gpts"));
    const gpt = JSON.parse(await readFile(join(target, "gpts", gptFiles[0]), "utf-8"));
    expect(gpt.name).toBe("My Skill");
    expect(gpt.description).toBe("Does things");
  });

  it("preserves system instructions in converted skill prompts", async () => {
    const source = join(tmp, "claude-workspace");
    const target = join(tmp, "openai-output");
    await mkdir(source, { recursive: true });
    await createClaudeWorkspace(source, {
      claudeMd: "Always be concise.",
      skills: [{ id: "skill-a", name: "Skill A", description: "A skill", prompt: "Do the thing." }],
    });

    await convert({ sourcePath: source, targetPath: target, to: "openai" });

    const gptFiles = await readdir(join(target, "gpts"));
    const gpt = JSON.parse(await readFile(join(target, "gpts", gptFiles[0]), "utf-8"));
    expect(gpt.instructions).toContain("Always be concise.");
    expect(gpt.instructions).toContain("Do the thing.");
  });

  it("auto-detects Claude as source platform when not specified", async () => {
    const source = join(tmp, "claude-workspace");
    const target = join(tmp, "openai-output");
    await mkdir(source, { recursive: true });
    await createClaudeWorkspace(source);

    // No sourcePlatform specified — should auto-detect
    const result = await convert({ sourcePath: source, targetPath: target, to: "openai" });
    expect(result.detectedPlatform).toBe("claude");
  });

  it("throws when source platform cannot be detected", async () => {
    const source = join(tmp, "unknown-workspace");
    const target = join(tmp, "output");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "random.txt"), "nothing special", "utf-8");

    await expect(
      convert({ sourcePath: source, targetPath: target, to: "openai" })
    ).rejects.toThrow();
  });

  it("documents MCP servers in migration guide even if flagged as unsupported", async () => {
    const source = join(tmp, "claude-workspace");
    const target = join(tmp, "openai-output");
    await mkdir(source, { recursive: true });
    await createClaudeWorkspace(source, {
      mcpServers: { github: { command: "npx", args: ["-y", "@mcp/github"] } },
    });

    await convert({ sourcePath: source, targetPath: target, to: "openai" });

    const guide = await readFile(join(target, "MIGRATION_GUIDE.md"), "utf-8");
    expect(guide).toContain("github");
    expect(guide).toContain("MCP");
  });
});

// ─── Roundtrip (Claude → OpenAI → Claude) ─────────────────────────

describe("Roundtrip conversion", () => {
  it("preserves skill count through Claude → OpenAI → Claude roundtrip", async () => {
    const source = join(tmp, "source");
    const openaiOut = join(tmp, "openai");
    const claudeOut = join(tmp, "claude-back");
    await mkdir(source, { recursive: true });

    await createClaudeWorkspace(source, {
      skills: [
        { id: "skill-a", name: "Skill A", description: "First skill", prompt: "Do A." },
        { id: "skill-b", name: "Skill B", description: "Second skill", prompt: "Do B." },
      ],
    });

    // Claude → OpenAI
    await convert({ sourcePath: source, targetPath: openaiOut, to: "openai" });

    // OpenAI → Claude
    await convert({ sourcePath: openaiOut, targetPath: claudeOut, to: "claude" });

    // Should have same number of skills (assistants are preferred over gpts, no duplicates)
    const skillDirs = await readdir(join(claudeOut, ".skills", "skills"));
    expect(skillDirs).toHaveLength(2);
  });
});
