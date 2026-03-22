/**
 * Unit tests for the Claude workspace parser.
 *
 * Covers: frontmatter parsing, CLAUDE.md, scoped rules,
 * MCP config, skill directory scanning, and skill parsing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseClaudeMd,
  parseScopedRules,
  parseMCPConfig,
  findSkillDirectories,
  parseSkillDirectory,
} from "../adapters/claude/parser.js";

// ─── Helpers ──────────────────────────────────────────────────────

let tmp: string;

beforeEach(async () => {
  tmp = join(tmpdir(), `ai-agnostic-test-${Date.now()}`);
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

// ─── parseClaudeMd ────────────────────────────────────────────────

describe("parseClaudeMd", () => {
  it("returns empty string when no CLAUDE.md exists", async () => {
    const result = await parseClaudeMd(tmp);
    expect(result).toBe("");
  });

  it("reads CLAUDE.md from root", async () => {
    await write("CLAUDE.md", "You are a helpful assistant.");
    const result = await parseClaudeMd(tmp);
    expect(result).toContain("You are a helpful assistant.");
  });

  it("reads CLAUDE.md from .claude/ subdirectory", async () => {
    await write(".claude/CLAUDE.md", "Scoped instructions.");
    const result = await parseClaudeMd(tmp);
    expect(result).toContain("Scoped instructions.");
  });

  it("combines both CLAUDE.md files when both exist", async () => {
    await write("CLAUDE.md", "Root instructions.");
    await write(".claude/CLAUDE.md", "Scoped instructions.");
    const result = await parseClaudeMd(tmp);
    expect(result).toContain("Root instructions.");
    expect(result).toContain("Scoped instructions.");
  });

  it("trims whitespace from result", async () => {
    await write("CLAUDE.md", "   trimmed   ");
    const result = await parseClaudeMd(tmp);
    expect(result).toBe("trimmed");
  });
});

// ─── parseScopedRules ─────────────────────────────────────────────

describe("parseScopedRules", () => {
  it("returns empty array when no rules directory exists", async () => {
    const result = await parseScopedRules(tmp);
    expect(result).toEqual([]);
  });

  it("parses a single rule file", async () => {
    await write(".claude/rules/typescript.md", "Use strict types.");
    const result = await parseScopedRules(tmp);
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain("Use strict types.");
  });

  it("generates path pattern from filename", async () => {
    await write(".claude/rules/src-components.md", "Component rules.");
    const result = await parseScopedRules(tmp);
    expect(result[0].pathPattern).toContain("src/components");
  });

  it("skips non-.md files", async () => {
    await write(".claude/rules/notes.txt", "This should be ignored.");
    await write(".claude/rules/valid.md", "This should be read.");
    const result = await parseScopedRules(tmp);
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain("This should be read.");
  });

  it("parses multiple rule files", async () => {
    await write(".claude/rules/typescript.md", "TS rules.");
    await write(".claude/rules/python.md", "Python rules.");
    const result = await parseScopedRules(tmp);
    expect(result).toHaveLength(2);
  });
});

// ─── parseMCPConfig ───────────────────────────────────────────────

describe("parseMCPConfig", () => {
  it("returns empty array when no .mcp.json exists", async () => {
    const result = await parseMCPConfig(tmp);
    expect(result).toEqual([]);
  });

  it("parses a stdio server", async () => {
    await write(".mcp.json", JSON.stringify({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "token123" },
        },
      },
    }));
    const result = await parseMCPConfig(tmp);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("github");
    expect(result[0].transport.type).toBe("stdio");
    if (result[0].transport.type === "stdio") {
      expect(result[0].transport.command).toBe("npx");
      expect(result[0].transport.args).toContain("-y");
    }
    expect(result[0].env).toEqual({ GITHUB_TOKEN: "token123" });
  });

  it("parses an SSE server", async () => {
    await write(".mcp.json", JSON.stringify({
      mcpServers: {
        "remote-tool": { url: "https://example.com/mcp" },
      },
    }));
    const result = await parseMCPConfig(tmp);
    expect(result).toHaveLength(1);
    expect(result[0].transport.type).toBe("sse");
    if (result[0].transport.type === "sse") {
      expect(result[0].transport.url).toBe("https://example.com/mcp");
    }
  });

  it("parses multiple servers", async () => {
    await write(".mcp.json", JSON.stringify({
      mcpServers: {
        github: { command: "npx", args: [] },
        postgres: { command: "node", args: ["server.js"] },
      },
    }));
    const result = await parseMCPConfig(tmp);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name)).toContain("github");
    expect(result.map((s) => s.name)).toContain("postgres");
  });

  it("returns empty array on malformed JSON", async () => {
    await write(".mcp.json", "{ not valid json }");
    const result = await parseMCPConfig(tmp);
    expect(result).toEqual([]);
  });

  it("skips servers with no recognizable transport", async () => {
    await write(".mcp.json", JSON.stringify({
      mcpServers: {
        broken: { unknownField: true },
      },
    }));
    const result = await parseMCPConfig(tmp);
    expect(result).toHaveLength(0);
  });
});

// ─── findSkillDirectories ─────────────────────────────────────────

describe("findSkillDirectories", () => {
  it("returns empty array when no skills exist", async () => {
    const result = await findSkillDirectories(tmp);
    expect(result).toEqual([]);
  });

  it("finds skills in .skills/skills/", async () => {
    await write(".skills/skills/my-skill/SKILL.md", "---\nname: My Skill\n---\nContent.");
    const result = await findSkillDirectories(tmp);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("my-skill");
  });

  it("finds skills in skills/ (flat)", async () => {
    await write("skills/another-skill/SKILL.md", "---\nname: Another\n---\nContent.");
    const result = await findSkillDirectories(tmp);
    expect(result).toHaveLength(1);
  });

  it("skips directories without SKILL.md", async () => {
    await mkdir(join(tmp, ".skills/skills/no-skill-file"), { recursive: true });
    const result = await findSkillDirectories(tmp);
    expect(result).toHaveLength(0);
  });

  it("finds skills across multiple locations", async () => {
    await write(".skills/skills/skill-a/SKILL.md", "---\nname: A\n---\nContent.");
    await write("skills/skill-b/SKILL.md", "---\nname: B\n---\nContent.");
    const result = await findSkillDirectories(tmp);
    expect(result).toHaveLength(2);
  });
});

// ─── parseSkillDirectory ──────────────────────────────────────────

describe("parseSkillDirectory", () => {
  it("returns null when SKILL.md is missing", async () => {
    const dir = join(tmp, "empty-skill");
    await mkdir(dir, { recursive: true });
    const result = await parseSkillDirectory(dir);
    expect(result).toBeNull();
  });

  it("parses name and description from frontmatter", async () => {
    const dir = join(tmp, "my-skill");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nname: My Skill\ndescription: Does things\n---\n\nYou are a helpful skill.",
      "utf-8"
    );
    const result = await parseSkillDirectory(dir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("My Skill");
    expect(result!.description).toBe("Does things");
  });

  it("uses directory name as fallback when no frontmatter name", async () => {
    const dir = join(tmp, "fallback-skill");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "No frontmatter here.", "utf-8");
    const result = await parseSkillDirectory(dir);
    expect(result!.name).toBe("fallback-skill");
  });

  it("parses prompt body (content after frontmatter)", async () => {
    const dir = join(tmp, "skill-with-prompt");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nname: Prompter\n---\n\nThis is the prompt.",
      "utf-8"
    );
    const result = await parseSkillDirectory(dir);
    expect(result!.prompt).toBe("This is the prompt.");
  });

  it("reads references from references/ subdirectory", async () => {
    const dir = join(tmp, "skill-with-refs");
    await mkdir(join(dir, "references"), { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "---\nname: Ref Skill\n---\nPrompt.", "utf-8");
    await writeFile(join(dir, "references", "context.md"), "Context content.", "utf-8");
    const result = await parseSkillDirectory(dir);
    expect(result!.references).toHaveLength(1);
    expect(result!.references[0].name).toBe("context.md");
    expect(result!.references[0].content).toBe("Context content.");
  });

  it("reads templates from templates/ subdirectory", async () => {
    const dir = join(tmp, "skill-with-templates");
    await mkdir(join(dir, "templates"), { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "---\nname: Template Skill\n---\nPrompt.", "utf-8");
    await writeFile(join(dir, "templates", "report.md"), "# {{title}}", "utf-8");
    const result = await parseSkillDirectory(dir);
    expect(result!.templates).toHaveLength(1);
    expect(result!.templates[0].name).toBe("report.md");
  });

  it("reads scripts and infers language from extension", async () => {
    const dir = join(tmp, "skill-with-scripts");
    await mkdir(join(dir, "scripts"), { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "---\nname: Script Skill\n---\nPrompt.", "utf-8");
    await writeFile(join(dir, "scripts", "run.py"), "print('hello')", "utf-8");
    await writeFile(join(dir, "scripts", "build.sh"), "echo 'build'", "utf-8");
    const result = await parseSkillDirectory(dir);
    expect(result!.scripts).toHaveLength(2);
    const py = result!.scripts.find((s) => s.name === "run.py");
    const sh = result!.scripts.find((s) => s.name === "build.sh");
    expect(py!.language).toBe("python");
    expect(sh!.language).toBe("bash");
  });

  it("infers code_execution capability from prompt content", async () => {
    const dir = join(tmp, "code-skill");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nname: Coder\n---\n\nWrite and execute code for the user.",
      "utf-8"
    );
    const result = await parseSkillDirectory(dir);
    expect(result!.capabilities).toContain("code_execution");
  });

  it("infers web_search capability from prompt content", async () => {
    const dir = join(tmp, "search-skill");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nname: Searcher\n---\n\nSearch the web for answers.",
      "utf-8"
    );
    const result = await parseSkillDirectory(dir);
    expect(result!.capabilities).toContain("web_search");
  });
});
