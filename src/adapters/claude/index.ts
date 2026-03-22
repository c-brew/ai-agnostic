/**
 * Claude Adapter — imports from and exports to Claude's native workspace format.
 *
 * Import reads: CLAUDE.md, .claude/rules/, .mcp.json, skills/SKILL.md
 * Export writes: The same structure back out.
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import type {
  PlatformAdapter,
  ImportOptions,
  ExportOptions,
  ImportResult,
  ExportResult,
} from "../../types/adapter.js";
import type { AgnosticWorkspace, AgnosticSkill } from "../../types/workspace.js";
import {
  parseClaudeMd,
  parseScopedRules,
  parseMCPConfig,
  findSkillDirectories,
  parseSkillDirectory,
} from "./parser.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class ClaudeAdapter implements PlatformAdapter {
  readonly platform = "claude" as const;
  readonly displayName = "Claude (Anthropic)";

  async detect(path: string): Promise<boolean> {
    // A Claude workspace has at least one of these markers
    const markers = [
      join(path, "CLAUDE.md"),
      join(path, ".claude"),
      join(path, ".mcp.json"),
      join(path, ".skills"),
    ];

    for (const marker of markers) {
      if (await fileExists(marker)) return true;
    }
    return false;
  }

  async import(options: ImportOptions): Promise<ImportResult> {
    const { sourcePath, includeAssets = true, includeKnowledge = true } = options;
    const warnings: string[] = [];
    const skipped: ImportResult["skipped"] = [];

    // 1. Parse system instructions from CLAUDE.md
    const systemInstructions = await parseClaudeMd(sourcePath);
    if (!systemInstructions) {
      warnings.push("No CLAUDE.md found — workspace will have empty instructions.");
    }

    // 2. Parse scoped rules
    const scopedRules = await parseScopedRules(sourcePath);

    // 3. Parse MCP server configs
    const mcpServers = await parseMCPConfig(sourcePath);

    // 4. Discover and parse skills
    const skillDirs = await findSkillDirectories(sourcePath);
    const skills: AgnosticSkill[] = [];

    for (const dir of skillDirs) {
      const skill = await parseSkillDirectory(dir);
      if (skill) {
        if (!includeAssets) {
          skill.assets = [];
        }
        skills.push(skill);
      } else {
        skipped.push({
          type: "skill",
          name: dir,
          reason: "Could not parse SKILL.md",
        });
      }
    }

    const workspace: AgnosticWorkspace = {
      schemaVersion: "0.1.0",
      name: sourcePath.split("/").pop() ?? "claude-workspace",
      exportedAt: new Date().toISOString(),
      sourceAdapter: "claude",
      instructions: {
        system: systemInstructions,
        scopedRules,
        starters: [], // Claude doesn't have conversation starters
      },
      skills,
      tools: [], // MCP tools are discovered at runtime, not in static config
      knowledge: [], // TODO: Parse project document library
      mcpServers,
      extensions: {
        claude: {
          sourcePath,
          hasClaudeDir: await fileExists(join(sourcePath, ".claude")),
        },
      },
    };

    return { workspace, warnings, skipped };
  }

  async export(
    workspace: AgnosticWorkspace,
    options: ExportOptions
  ): Promise<ExportResult> {
    const { targetPath, overwrite = false, createDir = true } = options;
    const filesWritten: string[] = [];
    const warnings: string[] = [];
    const unsupported: ExportResult["unsupported"] = [];

    if (createDir) {
      await mkdir(targetPath, { recursive: true });
    }

    // 1. Write CLAUDE.md
    if (workspace.instructions.system) {
      const claudeMdPath = join(targetPath, "CLAUDE.md");
      await writeFile(claudeMdPath, workspace.instructions.system, "utf-8");
      filesWritten.push(claudeMdPath);
    }

    // 2. Write scoped rules
    if (workspace.instructions.scopedRules.length > 0) {
      const rulesDir = join(targetPath, ".claude", "rules");
      await mkdir(rulesDir, { recursive: true });

      for (const rule of workspace.instructions.scopedRules) {
        const filename = rule.pathPattern.replace(/\//g, "-").replace(/\*/g, "") + ".md";
        const rulePath = join(rulesDir, filename);
        await writeFile(rulePath, rule.content, "utf-8");
        filesWritten.push(rulePath);
      }
    }

    // 3. Write MCP config
    if (workspace.mcpServers.length > 0) {
      const mcpConfig: Record<string, unknown> = { mcpServers: {} };
      const servers = mcpConfig.mcpServers as Record<string, unknown>;

      for (const server of workspace.mcpServers) {
        if (server.transport.type === "stdio") {
          servers[server.name] = {
            command: server.transport.command,
            args: server.transport.args,
            env: server.env,
          };
        } else if (server.transport.type === "sse" || server.transport.type === "http") {
          servers[server.name] = {
            url: server.transport.url,
            env: server.env,
          };
        }
      }

      const mcpPath = join(targetPath, ".mcp.json");
      await writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2), "utf-8");
      filesWritten.push(mcpPath);
    }

    // 4. Write skills
    if (workspace.skills.length > 0) {
      const skillsDir = join(targetPath, ".skills", "skills");
      await mkdir(skillsDir, { recursive: true });

      for (const skill of workspace.skills) {
        const skillDir = join(skillsDir, skill.id);
        const written = await this.writeSkill(skill, skillDir);
        filesWritten.push(...written);
      }
    }

    // 5. Note unsupported features
    if (workspace.instructions.starters.length > 0) {
      unsupported.push({
        type: "config",
        name: "conversation_starters",
        reason: "Claude does not support predefined conversation starters",
        suggestion: "Add example prompts to your CLAUDE.md instructions instead",
      });
    }

    return { filesWritten, warnings, unsupported };
  }

  private async writeSkill(
    skill: AgnosticSkill,
    skillDir: string
  ): Promise<string[]> {
    const written: string[] = [];
    await mkdir(skillDir, { recursive: true });

    // Build SKILL.md with frontmatter
    const frontmatter: Record<string, string> = {
      name: skill.name,
      description: skill.description,
    };
    const skillMd = `---\n${yaml.dump(frontmatter).trim()}\n---\n\n${skill.prompt}`;
    const skillMdPath = join(skillDir, "SKILL.md");
    await writeFile(skillMdPath, skillMd, "utf-8");
    written.push(skillMdPath);

    // Write references
    if (skill.references.length > 0) {
      const refDir = join(skillDir, "references");
      await mkdir(refDir, { recursive: true });
      for (const ref of skill.references) {
        const refPath = join(refDir, ref.name);
        await writeFile(refPath, ref.content, "utf-8");
        written.push(refPath);
      }
    }

    // Write templates
    if (skill.templates.length > 0) {
      const tplDir = join(skillDir, "templates");
      await mkdir(tplDir, { recursive: true });
      for (const tpl of skill.templates) {
        const tplPath = join(tplDir, tpl.name);
        await writeFile(tplPath, tpl.content, "utf-8");
        written.push(tplPath);
      }
    }

    // Write scripts
    if (skill.scripts.length > 0) {
      const scriptDir = join(skillDir, "scripts");
      await mkdir(scriptDir, { recursive: true });
      for (const script of skill.scripts) {
        const scriptPath = join(scriptDir, script.name);
        await writeFile(scriptPath, script.content, "utf-8");
        written.push(scriptPath);
      }
    }

    // Write assets
    if (skill.assets.length > 0) {
      const assetDir = join(skillDir, "assets");
      await mkdir(assetDir, { recursive: true });
      for (const asset of skill.assets) {
        const assetPath = join(assetDir, asset.name);
        if (asset.encoding === "base64") {
          await writeFile(assetPath, Buffer.from(asset.content, "base64"));
        } else {
          await writeFile(assetPath, asset.content, "utf-8");
        }
        written.push(assetPath);
      }
    }

    return written;
  }
}
