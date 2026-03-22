/**
 * Unit tests for the Claude platform adapter.
 *
 * Covers: detect(), import(), and export() against
 * real temporary directories.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeAdapter } from "../adapters/claude/index.js";
import type { AgnosticWorkspace } from "../types/workspace.js";

let tmp: string;
const adapter = new ClaudeAdapter();

beforeEach(async () => {
  tmp = join(tmpdir(), `ai-agnostic-claude-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function write(relPath: string, content: string) {
  const full = join(tmp, relPath);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content, "utf-8");
}

// ─── detect() ─────────────────────────────────────────────────────

describe("ClaudeAdapter.detect()", () => {
  it("returns false for an empty directory", async () => {
    expect(await adapter.detect(tmp)).toBe(false);
  });

  it("returns true when CLAUDE.md is present", async () => {
    await write("CLAUDE.md", "# Workspace");
    expect(await adapter.detect(tmp)).toBe(true);
  });

  it("returns true when .claude directory is present", async () => {
    await mkdir(join(tmp, ".claude"), { recursive: true });
    expect(await adapter.detect(tmp)).toBe(true);
  });

  it("returns true when .mcp.json is present", async () => {
    await write(".mcp.json", "{}");
    expect(await adapter.detect(tmp)).toBe(true);
  });

  it("returns true when .skills directory is present", async () => {
    await mkdir(join(tmp, ".skills"), { recursive: true });
    expect(await adapter.detect(tmp)).toBe(true);
  });

  it("returns false for a directory with unrelated files", async () => {
    await write("index.js", "console.log('hello')");
    await write("README.md", "# Not a workspace");
    expect(await adapter.detect(tmp)).toBe(false);
  });
});

// ─── import() ─────────────────────────────────────────────────────

describe("ClaudeAdapter.import()", () => {
  it("produces a valid AgnosticWorkspace structure", async () => {
    await write("CLAUDE.md", "You are a helpful assistant.");
    const { workspace } = await adapter.import({ sourcePath: tmp });
    expect(workspace.schemaVersion).toBe("0.1.0");
    expect(workspace.sourceAdapter).toBe("claude");
    expect(typeof workspace.exportedAt).toBe("string");
    expect(Array.isArray(workspace.skills)).toBe(true);
    expect(Array.isArray(workspace.mcpServers)).toBe(true);
  });

  it("reads system instructions from CLAUDE.md", async () => {
    await write("CLAUDE.md", "You are a code reviewer.");
    const { workspace } = await adapter.import({ sourcePath: tmp });
    expect(workspace.instructions.system).toContain("You are a code reviewer.");
  });

  it("adds a warning when CLAUDE.md is missing", async () => {
    // Just create a .skills dir so detection passes
    await mkdir(join(tmp, ".skills"), { recursive: true });
    const { warnings } = await adapter.import({ sourcePath: tmp });
    expect(warnings.some((w) => w.includes("CLAUDE.md"))).toBe(true);
  });

  it("parses skills from .skills/skills/", async () => {
    await write("CLAUDE.md", "Workspace");
    await write(".skills/skills/reviewer/SKILL.md",
      "---\nname: Reviewer\ndescription: Reviews code\n---\n\nReview code carefully.");
    const { workspace } = await adapter.import({ sourcePath: tmp });
    expect(workspace.skills).toHaveLength(1);
    expect(workspace.skills[0].name).toBe("Reviewer");
    expect(workspace.skills[0].description).toBe("Reviews code");
    expect(workspace.skills[0].prompt).toBe("Review code carefully.");
  });

  it("parses MCP servers from .mcp.json", async () => {
    await write("CLAUDE.md", "Workspace");
    await write(".mcp.json", JSON.stringify({
      mcpServers: {
        github: { command: "npx", args: ["-y", "@mcp/github"] },
      },
    }));
    const { workspace } = await adapter.import({ sourcePath: tmp });
    expect(workspace.mcpServers).toHaveLength(1);
    expect(workspace.mcpServers[0].name).toBe("github");
  });

  it("excludes skill assets when includeAssets is false", async () => {
    await write("CLAUDE.md", "Workspace");
    await write(".skills/skills/img-skill/SKILL.md",
      "---\nname: Image Skill\n---\nPrompt.");
    await write(".skills/skills/img-skill/assets/logo.png",
      Buffer.from("fake-png").toString("utf-8"));
    const { workspace } = await adapter.import({ sourcePath: tmp, includeAssets: false });
    expect(workspace.skills[0].assets).toHaveLength(0);
  });

  it("uses the directory name as the workspace name", async () => {
    await write("CLAUDE.md", "Workspace");
    const { workspace } = await adapter.import({ sourcePath: tmp });
    expect(workspace.name).toBe(tmp.split("/").pop());
  });
});

// ─── export() ─────────────────────────────────────────────────────

describe("ClaudeAdapter.export()", () => {
  const baseWorkspace: AgnosticWorkspace = {
    schemaVersion: "0.1.0",
    name: "test-workspace",
    exportedAt: new Date().toISOString(),
    sourceAdapter: "claude",
    instructions: {
      system: "You are a helpful assistant.",
      scopedRules: [],
      starters: [],
    },
    skills: [],
    tools: [],
    knowledge: [],
    mcpServers: [],
    extensions: {},
  };

  it("creates the target directory if it doesn't exist", async () => {
    const target = join(tmp, "output");
    await adapter.export(baseWorkspace, { targetPath: target });
    const { stat } = await import("node:fs/promises");
    await expect(stat(target)).resolves.toBeDefined();
  });

  it("writes CLAUDE.md with system instructions", async () => {
    const target = join(tmp, "output");
    await adapter.export(baseWorkspace, { targetPath: target });
    const content = await readFile(join(target, "CLAUDE.md"), "utf-8");
    expect(content).toContain("You are a helpful assistant.");
  });

  it("writes skills to .skills/skills/<id>/SKILL.md", async () => {
    const target = join(tmp, "output");
    const workspace: AgnosticWorkspace = {
      ...baseWorkspace,
      skills: [{
        id: "my-skill",
        name: "My Skill",
        description: "Does things",
        prompt: "You are skilled.",
        references: [],
        templates: [],
        scripts: [],
        assets: [],
        capabilities: [],
        extensions: {},
      }],
    };
    await adapter.export(workspace, { targetPath: target });
    const skillMd = await readFile(
      join(target, ".skills", "skills", "my-skill", "SKILL.md"),
      "utf-8"
    );
    expect(skillMd).toContain("My Skill");
    expect(skillMd).toContain("You are skilled.");
  });

  it("writes .mcp.json when MCP servers are present", async () => {
    const target = join(tmp, "output");
    const workspace: AgnosticWorkspace = {
      ...baseWorkspace,
      mcpServers: [{
        name: "github",
        transport: { type: "stdio", command: "npx", args: ["-y", "@mcp/github"] },
        tools: [],
        env: {},
      }],
    };
    await adapter.export(workspace, { targetPath: target });
    const mcpJson = JSON.parse(await readFile(join(target, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers).toHaveProperty("github");
  });

  it("writes scoped rules to .claude/rules/", async () => {
    const target = join(tmp, "output");
    const workspace: AgnosticWorkspace = {
      ...baseWorkspace,
      instructions: {
        ...baseWorkspace.instructions,
        scopedRules: [{ pathPattern: "src/ts/**", content: "Use strict types." }],
      },
    };
    await adapter.export(workspace, { targetPath: target });
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(target, ".claude", "rules"));
    expect(files.length).toBeGreaterThan(0);
  });

  it("returns list of files written", async () => {
    const target = join(tmp, "output");
    const { filesWritten } = await adapter.export(baseWorkspace, { targetPath: target });
    expect(filesWritten.length).toBeGreaterThan(0);
    expect(filesWritten.every((f) => f.startsWith(target))).toBe(true);
  });

  it("flags conversation starters as unsupported", async () => {
    const target = join(tmp, "output");
    const workspace: AgnosticWorkspace = {
      ...baseWorkspace,
      instructions: {
        ...baseWorkspace.instructions,
        starters: ["Tell me a joke", "Summarize this"],
      },
    };
    const { unsupported } = await adapter.export(workspace, { targetPath: target });
    expect(unsupported.some((u) => u.name === "conversation_starters")).toBe(true);
  });
});
