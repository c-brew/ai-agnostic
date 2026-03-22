/**
 * Unit tests for the OpenAI platform adapter.
 *
 * Covers: detect(), export() (GPT + Assistant configs),
 * and import() from exported configs.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenAIAdapter } from "../adapters/openai/index.js";
import type { AgnosticWorkspace, AgnosticSkill } from "../types/workspace.js";

let tmp: string;
const adapter = new OpenAIAdapter();

beforeEach(async () => {
  tmp = join(tmpdir(), `ai-agnostic-openai-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

// ─── Shared fixtures ──────────────────────────────────────────────

const baseSkill: AgnosticSkill = {
  id: "code-reviewer",
  name: "Code Reviewer",
  description: "Reviews code for quality",
  prompt: "You are an expert code reviewer. Identify bugs and suggest improvements.",
  references: [],
  templates: [],
  scripts: [],
  assets: [],
  capabilities: [],
  extensions: {},
};

const baseWorkspace: AgnosticWorkspace = {
  schemaVersion: "0.1.0",
  name: "test-workspace",
  exportedAt: new Date().toISOString(),
  sourceAdapter: "claude",
  instructions: {
    system: "Global workspace instructions.",
    scopedRules: [],
    starters: [],
  },
  skills: [],
  tools: [],
  knowledge: [],
  mcpServers: [],
  extensions: {},
};

// ─── detect() ─────────────────────────────────────────────────────

describe("OpenAIAdapter.detect()", () => {
  it("returns false for an empty directory", async () => {
    expect(await adapter.detect(tmp)).toBe(false);
  });

  it("returns true when gpts/ directory exists", async () => {
    await mkdir(join(tmp, "gpts"), { recursive: true });
    expect(await adapter.detect(tmp)).toBe(true);
  });

  it("returns true when assistants/ directory exists", async () => {
    await mkdir(join(tmp, "assistants"), { recursive: true });
    expect(await adapter.detect(tmp)).toBe(true);
  });

  it("returns false for a Claude workspace (no OpenAI markers)", async () => {
    await writeFile(join(tmp, "CLAUDE.md"), "# Claude Workspace", "utf-8");
    expect(await adapter.detect(tmp)).toBe(false);
  });
});

// ─── export() ─────────────────────────────────────────────────────

describe("OpenAIAdapter.export()", () => {
  it("creates gpts/ and assistants/ directories", async () => {
    const target = join(tmp, "output");
    await adapter.export({ ...baseWorkspace, skills: [baseSkill] }, { targetPath: target });
    const { stat } = await import("node:fs/promises");
    await expect(stat(join(target, "gpts"))).resolves.toBeDefined();
    await expect(stat(join(target, "assistants"))).resolves.toBeDefined();
  });

  it("creates a GPT config JSON for each skill", async () => {
    const target = join(tmp, "output");
    await adapter.export({ ...baseWorkspace, skills: [baseSkill] }, { targetPath: target });
    const { readdir } = await import("node:fs/promises");
    const gptFiles = await readdir(join(target, "gpts"));
    expect(gptFiles).toHaveLength(1);
    expect(gptFiles[0]).toContain(".json");
  });

  it("creates an Assistant config JSON for each skill", async () => {
    const target = join(tmp, "output");
    await adapter.export({ ...baseWorkspace, skills: [baseSkill] }, { targetPath: target });
    const { readdir } = await import("node:fs/promises");
    const assistantFiles = await readdir(join(target, "assistants"));
    expect(assistantFiles).toHaveLength(1);
  });

  it("GPT config includes skill name, description, and instructions", async () => {
    const target = join(tmp, "output");
    await adapter.export({ ...baseWorkspace, skills: [baseSkill] }, { targetPath: target });
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(target, "gpts"));
    const gpt = JSON.parse(await readFile(join(target, "gpts", files[0]), "utf-8"));
    expect(gpt.name).toBe("Code Reviewer");
    expect(gpt.description).toBe("Reviews code for quality");
    expect(gpt.instructions).toContain("You are an expert code reviewer");
  });

  it("Assistant config includes model, tools array, and metadata", async () => {
    const target = join(tmp, "output");
    await adapter.export({ ...baseWorkspace, skills: [baseSkill] }, { targetPath: target });
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(target, "assistants"));
    const assistant = JSON.parse(await readFile(join(target, "assistants", files[0]), "utf-8"));
    expect(assistant.model).toBeDefined();
    expect(Array.isArray(assistant.tools)).toBe(true);
    expect(assistant.metadata.source).toBe("ai-agnostic");
  });

  it("injects global workspace instructions into skill instructions", async () => {
    const target = join(tmp, "output");
    await adapter.export({ ...baseWorkspace, skills: [baseSkill] }, { targetPath: target });
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(target, "gpts"));
    const gpt = JSON.parse(await readFile(join(target, "gpts", files[0]), "utf-8"));
    expect(gpt.instructions).toContain("Global workspace instructions.");
  });

  it("maps code_execution capability to code_interpreter tool", async () => {
    const target = join(tmp, "output");
    const skill: AgnosticSkill = { ...baseSkill, capabilities: ["code_execution"] };
    await adapter.export({ ...baseWorkspace, skills: [skill] }, { targetPath: target });
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(target, "assistants"));
    const assistant = JSON.parse(await readFile(join(target, "assistants", files[0]), "utf-8"));
    expect(assistant.tools.some((t: { type: string }) => t.type === "code_interpreter")).toBe(true);
  });

  it("maps web_search capability to web_browsing in GPT config", async () => {
    const target = join(tmp, "output");
    const skill: AgnosticSkill = { ...baseSkill, capabilities: ["web_search"] };
    await adapter.export({ ...baseWorkspace, skills: [skill] }, { targetPath: target });
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(target, "gpts"));
    const gpt = JSON.parse(await readFile(join(target, "gpts", files[0]), "utf-8"));
    expect(gpt.capabilities.web_browsing).toBe(true);
  });

  it("flags stdio MCP servers as unsupported", async () => {
    const target = join(tmp, "output");
    const workspace: AgnosticWorkspace = {
      ...baseWorkspace,
      mcpServers: [{
        name: "github",
        transport: { type: "stdio", command: "npx", args: [] },
        tools: [],
        env: {},
      }],
    };
    const { unsupported } = await adapter.export(workspace, { targetPath: target });
    expect(unsupported.some((u) => u.name.includes("github"))).toBe(true);
  });

  it("flags scoped rules as unsupported", async () => {
    const target = join(tmp, "output");
    const workspace: AgnosticWorkspace = {
      ...baseWorkspace,
      instructions: {
        ...baseWorkspace.instructions,
        scopedRules: [{ pathPattern: "src/**", content: "Rule." }],
      },
    };
    const { unsupported } = await adapter.export(workspace, { targetPath: target });
    expect(unsupported.some((u) => u.name === "scoped_rules")).toBe(true);
  });

  it("flags skill scripts as unsupported", async () => {
    const target = join(tmp, "output");
    const skill: AgnosticSkill = {
      ...baseSkill,
      scripts: [{ name: "run.py", language: "python", content: "print('hi')" }],
    };
    const { unsupported } = await adapter.export({ ...baseWorkspace, skills: [skill] }, { targetPath: target });
    expect(unsupported.some((u) => u.name.includes("scripts"))).toBe(true);
  });

  it("generates a MIGRATION_GUIDE.md", async () => {
    const target = join(tmp, "output");
    await adapter.export(baseWorkspace, { targetPath: target });
    const guide = await readFile(join(target, "MIGRATION_GUIDE.md"), "utf-8");
    expect(guide).toContain("AI Agnostic Migration Guide");
    expect(guide).toContain("Next Steps");
  });

  it("handles workspace with no skills gracefully", async () => {
    const target = join(tmp, "output");
    await expect(
      adapter.export(baseWorkspace, { targetPath: target })
    ).resolves.toBeDefined();
  });

  it("returns list of all files written", async () => {
    const target = join(tmp, "output");
    const { filesWritten } = await adapter.export(
      { ...baseWorkspace, skills: [baseSkill] },
      { targetPath: target }
    );
    expect(filesWritten.length).toBeGreaterThanOrEqual(3); // gpt.json, assistant.json, migration guide
    expect(filesWritten.every((f) => f.startsWith(target))).toBe(true);
  });
});

// ─── import() ─────────────────────────────────────────────────────

describe("OpenAIAdapter.import()", () => {
  it("adds a warning when no assistants/ directory exists", async () => {
    const { warnings } = await adapter.import({ sourcePath: tmp });
    expect(warnings.some((w) => w.includes("assistants"))).toBe(true);
  });

  it("reads skills from assistants/ directory", async () => {
    await mkdir(join(tmp, "assistants"), { recursive: true });
    const config = {
      name: "My Assistant",
      description: "A test assistant",
      model: "gpt-4o",
      instructions: "You are a helpful assistant.",
      tools: [],
      file_ids: [],
      metadata: {},
      temperature: 0.7,
      top_p: 1.0,
    };
    await writeFile(
      join(tmp, "assistants", "my-assistant.json"),
      JSON.stringify(config),
      "utf-8"
    );
    const { workspace } = await adapter.import({ sourcePath: tmp });
    expect(workspace.skills).toHaveLength(1);
    expect(workspace.skills[0].name).toBe("My Assistant");
    expect(workspace.skills[0].prompt).toBe("You are a helpful assistant.");
  });

  it("infers code_execution capability from code_interpreter tool", async () => {
    await mkdir(join(tmp, "assistants"), { recursive: true });
    const config = {
      name: "Coder",
      description: "Codes",
      model: "gpt-4o",
      instructions: "Write code.",
      tools: [{ type: "code_interpreter" }],
      file_ids: [],
      metadata: {},
      temperature: 0.7,
      top_p: 1.0,
    };
    await writeFile(
      join(tmp, "assistants", "coder.json"),
      JSON.stringify(config),
      "utf-8"
    );
    const { workspace } = await adapter.import({ sourcePath: tmp });
    expect(workspace.skills[0].capabilities).toContain("code_execution");
  });

  it("produces a valid workspace schema", async () => {
    const { workspace } = await adapter.import({ sourcePath: tmp });
    expect(workspace.schemaVersion).toBe("0.1.0");
    expect(workspace.sourceAdapter).toBe("openai");
    expect(Array.isArray(workspace.skills)).toBe(true);
  });
});
