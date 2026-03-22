/**
 * Claude workspace parser — reads Claude-native files into structured data.
 *
 * Handles:
 * - SKILL.md files with YAML frontmatter
 * - CLAUDE.md project instructions
 * - .claude/rules/ scoped rules
 * - .mcp.json MCP server configs
 * - .claude/commands/ custom slash commands
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, basename, relative } from "node:path";
import yaml from "js-yaml";
import type {
  AgnosticSkill,
  AgnosticReference,
  AgnosticTemplate,
  AgnosticScript,
  AgnosticAsset,
  AgnosticMCPServer,
  ScopedRule,
  SkillCapability,
  MCPTransport,
} from "../../types/workspace.js";

// ─── SKILL.md Parser ───────────────────────────────────────────────

interface SkillFrontmatter {
  name?: string;
  description?: string;
  [key: string]: unknown;
}

function parseFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  try {
    const frontmatter = yaml.load(match[1]) as SkillFrontmatter;
    return { frontmatter: frontmatter ?? {}, body: match[2] };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

function inferScriptLanguage(
  filename: string
): "python" | "bash" | "javascript" | "typescript" {
  const ext = extname(filename);
  switch (ext) {
    case ".py":
      return "python";
    case ".sh":
    case ".bash":
      return "bash";
    case ".ts":
      return "typescript";
    default:
      return "javascript";
  }
}

function inferMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".yml": "text/yaml",
    ".yaml": "text/yaml",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
  };
  return mimeMap[ext] ?? "application/octet-stream";
}

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yml",
  ".yaml",
  ".csv",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".ts",
  ".py",
  ".sh",
  ".bash",
  ".toml",
  ".cfg",
  ".ini",
  ".env",
  ".svg",
]);

// ─── Skill Directory Parser ────────────────────────────────────────

export async function parseSkillDirectory(
  skillPath: string
): Promise<AgnosticSkill | null> {
  const skillMdPath = join(skillPath, "SKILL.md");
  const skillContent = await readTextFile(skillMdPath);

  if (!skillContent) return null;

  const { frontmatter, body } = parseFrontmatter(skillContent);
  const dirName = basename(skillPath);

  // Parse references/
  const references: AgnosticReference[] = [];
  const refFiles = await listDir(join(skillPath, "references"));
  for (const file of refFiles) {
    const content = await readTextFile(join(skillPath, "references", file));
    if (content) {
      references.push({ name: file, content });
    }
  }

  // Parse templates/
  const templates: AgnosticTemplate[] = [];
  const tplFiles = await listDir(join(skillPath, "templates"));
  for (const file of tplFiles) {
    const content = await readTextFile(join(skillPath, "templates", file));
    if (content) {
      templates.push({ name: file, content });
    }
  }

  // Parse scripts/
  const scripts: AgnosticScript[] = [];
  const scriptFiles = await listDir(join(skillPath, "scripts"));
  for (const file of scriptFiles) {
    const content = await readTextFile(join(skillPath, "scripts", file));
    if (content) {
      scripts.push({
        name: file,
        language: inferScriptLanguage(file),
        content,
      });
    }
  }

  // Parse assets/
  const assets: AgnosticAsset[] = [];
  const assetFiles = await listDir(join(skillPath, "assets"));
  for (const file of assetFiles) {
    const filePath = join(skillPath, "assets", file);
    const ext = extname(file).toLowerCase();
    const isText = TEXT_EXTENSIONS.has(ext);

    if (isText) {
      const content = await readTextFile(filePath);
      if (content) {
        assets.push({
          name: file,
          content,
          mimeType: inferMimeType(file),
          encoding: "utf-8",
        });
      }
    } else {
      const buffer = await readFile(filePath);
      assets.push({
        name: file,
        content: buffer.toString("base64"),
        mimeType: inferMimeType(file),
        encoding: "base64",
      });
    }
  }

  // Infer capabilities from skill content
  const capabilities: SkillCapability[] = [];
  const lowerBody = body.toLowerCase();
  if (lowerBody.includes("code") || lowerBody.includes("script"))
    capabilities.push("code_execution");
  if (lowerBody.includes("search") || lowerBody.includes("web"))
    capabilities.push("web_search");
  if (lowerBody.includes("image") || lowerBody.includes("generate"))
    capabilities.push("image_generation");
  if (lowerBody.includes("data") || lowerBody.includes("analys"))
    capabilities.push("data_analysis");

  // Preserve Claude-specific frontmatter in extensions
  const { name: _n, description: _d, ...extraFrontmatter } = frontmatter;

  return {
    id: (frontmatter.name as string) ?? dirName,
    name: (frontmatter.name as string) ?? dirName,
    description: (frontmatter.description as string) ?? "",
    prompt: body.trim(),
    references,
    templates,
    scripts,
    assets,
    capabilities,
    extensions: {
      claude: {
        originalPath: skillPath,
        frontmatter: extraFrontmatter,
      },
    },
  };
}

// ─── CLAUDE.md Parser ──────────────────────────────────────────────

export async function parseClaudeMd(
  rootPath: string
): Promise<string> {
  // Check multiple possible locations
  const candidates = [
    join(rootPath, "CLAUDE.md"),
    join(rootPath, ".claude", "CLAUDE.md"),
  ];

  const parts: string[] = [];
  for (const candidate of candidates) {
    const content = await readTextFile(candidate);
    if (content) {
      parts.push(content.trim());
    }
  }

  return parts.join("\n\n---\n\n");
}

// ─── Scoped Rules Parser ──────────────────────────────────────────

export async function parseScopedRules(
  rootPath: string
): Promise<ScopedRule[]> {
  const rulesDir = join(rootPath, ".claude", "rules");
  const rules: ScopedRule[] = [];
  const files = await listDir(rulesDir);

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const content = await readTextFile(join(rulesDir, file));
    if (content) {
      // Rule filename often indicates scope (e.g., "src-components.md")
      const pathPattern = basename(file, ".md").replace(/-/g, "/") + "/**";
      rules.push({ pathPattern, content: content.trim() });
    }
  }

  return rules;
}

// ─── MCP Config Parser ────────────────────────────────────────────

interface ClaudeMCPConfig {
  mcpServers?: Record<
    string,
    {
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
    }
  >;
}

export async function parseMCPConfig(
  rootPath: string
): Promise<AgnosticMCPServer[]> {
  const configPath = join(rootPath, ".mcp.json");
  const content = await readTextFile(configPath);

  if (!content) return [];

  try {
    const config = JSON.parse(content) as ClaudeMCPConfig;
    const servers: AgnosticMCPServer[] = [];

    for (const [name, serverDef] of Object.entries(
      config.mcpServers ?? {}
    )) {
      let transport: MCPTransport;

      if (serverDef.command) {
        transport = {
          type: "stdio",
          command: serverDef.command,
          args: serverDef.args ?? [],
        };
      } else if (serverDef.url) {
        transport = { type: "sse", url: serverDef.url };
      } else {
        continue; // Skip unrecognized transport
      }

      servers.push({
        name,
        transport,
        tools: [], // Tools discovered at runtime, not in static config
        env: serverDef.env ?? {},
      });
    }

    return servers;
  } catch {
    return [];
  }
}

// ─── Skills Directory Scanner ──────────────────────────────────────

export async function findSkillDirectories(
  rootPath: string
): Promise<string[]> {
  const skillPaths: string[] = [];

  // Common skill locations
  const candidates = [
    join(rootPath, ".skills", "skills"),
    join(rootPath, "skills"),
    join(rootPath, ".claude", "skills"),
  ];

  for (const dir of candidates) {
    if (!(await fileExists(dir))) continue;

    const entries = await listDir(dir);
    for (const entry of entries) {
      const entryPath = join(dir, entry);
      const skillMd = join(entryPath, "SKILL.md");
      if (await fileExists(skillMd)) {
        skillPaths.push(entryPath);
      }
    }
  }

  return skillPaths;
}
