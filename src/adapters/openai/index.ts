/**
 * OpenAI Adapter — imports from and exports to OpenAI's formats.
 *
 * Export produces:
 *   - Custom GPT config JSON (one per skill)
 *   - Assistants API config JSON (one per skill)
 *   - Knowledge files in a flat directory
 *   - A migration guide noting what needs manual attention
 *
 * Import reads:
 *   - GPT config exports (if OpenAI ever supports this)
 *   - Assistants API JSON configs
 */

import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import type {
  PlatformAdapter,
  ImportOptions,
  ExportOptions,
  ImportResult,
  ExportResult,
} from "../../types/adapter.js";
import type {
  AgnosticWorkspace,
  AgnosticSkill,
  AgnosticTool,
  SkillCapability,
} from "../../types/workspace.js";

// ─── OpenAI-specific types ─────────────────────────────────────────

interface GPTConfig {
  name: string;
  description: string;
  instructions: string;
  conversation_starters: string[];
  capabilities: {
    web_browsing: boolean;
    code_interpreter: boolean;
    image_generation: boolean;
    file_search: boolean;
  };
  knowledge_files: string[];
  model: string;
}

interface AssistantConfig {
  name: string;
  description: string;
  model: string;
  instructions: string;
  tools: AssistantTool[];
  file_ids: string[];
  metadata: Record<string, string>;
  temperature: number;
  top_p: number;
}

type AssistantTool =
  | { type: "code_interpreter" }
  | { type: "file_search" }
  | { type: "function"; function: FunctionDefinition };

interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ─── Capability mapping ────────────────────────────────────────────

function mapCapabilitiesToGPT(
  capabilities: SkillCapability[]
): GPTConfig["capabilities"] {
  return {
    web_browsing: capabilities.includes("web_search"),
    code_interpreter:
      capabilities.includes("code_execution") ||
      capabilities.includes("data_analysis"),
    image_generation: capabilities.includes("image_generation"),
    file_search: capabilities.includes("file_search"),
  };
}

function mapCapabilitiesToAssistantTools(
  capabilities: SkillCapability[]
): AssistantTool[] {
  const tools: AssistantTool[] = [];

  if (
    capabilities.includes("code_execution") ||
    capabilities.includes("data_analysis")
  ) {
    tools.push({ type: "code_interpreter" });
  }

  if (capabilities.includes("file_search")) {
    tools.push({ type: "file_search" });
  }

  return tools;
}

// ─── Skill → GPT converter ────────────────────────────────────────

function skillToGPTConfig(
  skill: AgnosticSkill,
  globalInstructions: string
): GPTConfig {
  // Combine global workspace instructions with skill-specific prompt
  const fullInstructions = [
    globalInstructions ? `## Workspace Context\n${globalInstructions}` : "",
    `## Skill: ${skill.name}\n${skill.prompt}`,
    // Inline references as additional context (GPTs don't have a reference system)
    ...skill.references.map(
      (ref) => `## Reference: ${ref.name}\n${ref.content}`
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  // GPT instructions have an 8000 char limit — warn if over
  const truncated =
    fullInstructions.length > 8000
      ? fullInstructions.slice(0, 7900) +
        "\n\n[... truncated — full instructions exceed GPT's 8,000 character limit]"
      : fullInstructions;

  return {
    name: skill.name,
    description: skill.description,
    instructions: truncated,
    conversation_starters: [],
    capabilities: mapCapabilitiesToGPT(skill.capabilities),
    knowledge_files: [],
    model: "gpt-4o",
  };
}

// ─── Skill → Assistant converter ───────────────────────────────────

function skillToAssistantConfig(
  skill: AgnosticSkill,
  globalInstructions: string
): AssistantConfig {
  const fullInstructions = [
    globalInstructions ? `## Workspace Context\n${globalInstructions}` : "",
    `## Skill: ${skill.name}\n${skill.prompt}`,
    ...skill.references.map(
      (ref) => `## Reference: ${ref.name}\n${ref.content}`
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  // Convert scripts to function tool definitions
  const functionTools: AssistantTool[] = skill.scripts.map((script) => ({
    type: "function" as const,
    function: {
      name: script.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_"),
      description: `Execute ${script.name} (${script.language} script from Claude skill "${skill.name}")`,
      parameters: {
        type: "object",
        properties: {
          input: {
            type: "string",
            description: "Input to pass to the script",
          },
        },
        required: [],
      },
    },
  }));

  const builtinTools = mapCapabilitiesToAssistantTools(skill.capabilities);

  return {
    name: skill.name,
    description: skill.description,
    model: "gpt-4o",
    instructions: fullInstructions,
    tools: [...builtinTools, ...functionTools],
    file_ids: [], // Would need actual file upload via API
    metadata: {
      source: "ai-agnostic",
      originalPlatform: "claude",
      skillId: skill.id,
    },
    temperature: 0.7,
    top_p: 1.0,
  };
}

// ─── Tool → Function Definition ────────────────────────────────────

function toolToFunctionDefinition(tool: AgnosticTool): FunctionDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  };
}

// ─── Migration Guide Generator ─────────────────────────────────────

function generateMigrationGuide(
  workspace: AgnosticWorkspace,
  unsupported: ExportResult["unsupported"]
): string {
  const lines: string[] = [
    `# AI Agnostic Migration Guide`,
    ``,
    `**Source:** ${workspace.sourceAdapter}`,
    `**Target:** OpenAI (ChatGPT / Assistants API)`,
    `**Exported:** ${workspace.exportedAt}`,
    ``,
    `## What was converted`,
    ``,
    `- **Skills → Custom GPTs:** ${workspace.skills.length} skill(s) converted`,
    `- **Skills → Assistants:** ${workspace.skills.length} assistant config(s) generated`,
    `- **MCP Servers:** ${workspace.mcpServers.length} server(s) documented`,
    `- **Tools:** ${workspace.tools.length} tool definition(s) converted to functions`,
    ``,
  ];

  if (unsupported.length > 0) {
    lines.push(`## Items needing manual attention`, ``);
    for (const item of unsupported) {
      lines.push(`### ${item.type}: ${item.name}`);
      lines.push(`**Issue:** ${item.reason}`);
      if (item.suggestion) {
        lines.push(`**Suggestion:** ${item.suggestion}`);
      }
      lines.push(``);
    }
  }

  if (workspace.mcpServers.length > 0) {
    lines.push(`## MCP Server Migration`, ``);
    lines.push(
      `OpenAI now supports remote MCP servers. Your MCP configs have been`
    );
    lines.push(
      `preserved in the export. To connect them in ChatGPT:`
    );
    lines.push(``);
    for (const server of workspace.mcpServers) {
      lines.push(`- **${server.name}:** ${server.transport.type} transport`);
      if (server.transport.type === "sse" || server.transport.type === "http") {
        lines.push(`  URL: ${server.transport.url}`);
      } else {
        lines.push(
          `  Command: ${server.transport.command} ${server.transport.args.join(" ")}`
        );
        lines.push(
          `  Note: STDIO servers need to be wrapped as remote MCP for ChatGPT.`
        );
      }
    }
    lines.push(``);
  }

  lines.push(
    `## Next Steps`,
    ``,
    `1. Review the generated GPT configs in \`gpts/\``,
    `2. Create Custom GPTs in ChatGPT using these configs`,
    `3. Upload knowledge files from \`knowledge/\` to each GPT`,
    `4. For Assistants API: use the configs in \`assistants/\` with the OpenAI SDK`,
    `5. Review scripts in each skill — these may need to be reimplemented as API endpoints`,
    ``
  );

  return lines.join("\n");
}

// ─── Adapter Implementation ────────────────────────────────────────

export class OpenAIAdapter implements PlatformAdapter {
  readonly platform = "openai" as const;
  readonly displayName = "OpenAI (ChatGPT / Assistants)";

  async detect(path: string): Promise<boolean> {
    // Look for OpenAI-specific markers
    try {
      const files = await readdir(path);
      return files.some(
        (f) =>
          f === "openai-config.json" ||
          f === "assistants" ||
          f === "gpts"
      );
    } catch {
      return false;
    }
  }

  async import(options: ImportOptions): Promise<ImportResult> {
    const { sourcePath } = options;
    const warnings: string[] = [];
    const skipped: ImportResult["skipped"] = [];

    // Try to read assistant configs
    const skills: AgnosticSkill[] = [];
    const assistantsDir = join(sourcePath, "assistants");

    try {
      const files = await readdir(assistantsDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const content = await readFile(join(assistantsDir, file), "utf-8");
        const config = JSON.parse(content) as AssistantConfig;

        skills.push({
          id: config.name.toLowerCase().replace(/\s+/g, "-"),
          name: config.name,
          description: config.description,
          prompt: config.instructions,
          references: [],
          templates: [],
          scripts: [],
          assets: [],
          capabilities: this.inferCapabilities(config.tools),
          extensions: { openai: { model: config.model, temperature: config.temperature } },
        });
      }
    } catch {
      warnings.push("No assistants/ directory found.");
    }

    // Try to read GPT configs
    const gptsDir = join(sourcePath, "gpts");
    try {
      const files = await readdir(gptsDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const content = await readFile(join(gptsDir, file), "utf-8");
        const config = JSON.parse(content) as GPTConfig;

        // Avoid duplicates if already imported from assistants
        const existingIds = new Set(skills.map((s) => s.id));
        const id = config.name.toLowerCase().replace(/\s+/g, "-");
        if (existingIds.has(id)) continue;

        skills.push({
          id,
          name: config.name,
          description: config.description,
          prompt: config.instructions,
          references: [],
          templates: [],
          scripts: [],
          assets: [],
          capabilities: this.inferCapabilitiesFromGPT(config.capabilities),
          extensions: { openai: { model: config.model, type: "gpt" } },
        });
      }
    } catch {
      warnings.push("No gpts/ directory found.");
    }

    const workspace: AgnosticWorkspace = {
      schemaVersion: "0.1.0",
      name: basename(sourcePath),
      exportedAt: new Date().toISOString(),
      sourceAdapter: "openai",
      instructions: {
        system: "", // Would need to come from a separate config
        scopedRules: [],
        starters: [],
      },
      skills,
      tools: [],
      knowledge: [],
      mcpServers: [],
      extensions: { openai: { sourcePath } },
    };

    return { workspace, warnings, skipped };
  }

  async export(
    workspace: AgnosticWorkspace,
    options: ExportOptions
  ): Promise<ExportResult> {
    const { targetPath, createDir = true } = options;
    const filesWritten: string[] = [];
    const warnings: string[] = [];
    const unsupported: ExportResult["unsupported"] = [];

    if (createDir) {
      await mkdir(targetPath, { recursive: true });
    }

    const gptsDir = join(targetPath, "gpts");
    const assistantsDir = join(targetPath, "assistants");
    const knowledgeDir = join(targetPath, "knowledge");
    await mkdir(gptsDir, { recursive: true });
    await mkdir(assistantsDir, { recursive: true });

    const globalInstructions = workspace.instructions.system;

    // Convert each skill to both GPT and Assistant format
    for (const skill of workspace.skills) {
      // GPT config
      const gptConfig = skillToGPTConfig(skill, globalInstructions);
      const gptPath = join(gptsDir, `${skill.id}.json`);
      await writeFile(gptPath, JSON.stringify(gptConfig, null, 2), "utf-8");
      filesWritten.push(gptPath);

      // Assistant config
      const assistantConfig = skillToAssistantConfig(skill, globalInstructions);
      const assistantPath = join(assistantsDir, `${skill.id}.json`);
      await writeFile(
        assistantPath,
        JSON.stringify(assistantConfig, null, 2),
        "utf-8"
      );
      filesWritten.push(assistantPath);

      // Track truncation warnings
      const combinedLength =
        globalInstructions.length + skill.prompt.length;
      if (combinedLength > 8000) {
        warnings.push(
          `Skill "${skill.name}" instructions (${combinedLength} chars) exceed GPT's 8,000 char limit — truncated in GPT config. Assistant config retains full text.`
        );
      }

      // Scripts can't be directly converted
      if (skill.scripts.length > 0) {
        unsupported.push({
          type: "skill",
          name: `${skill.name} scripts`,
          reason: `${skill.scripts.length} script(s) cannot be executed directly in ChatGPT`,
          suggestion:
            "Deploy scripts as API endpoints and add them as GPT Actions, or use Code Interpreter for Python scripts",
        });
      }

      // Templates don't have a GPT equivalent
      if (skill.templates.length > 0) {
        unsupported.push({
          type: "skill",
          name: `${skill.name} templates`,
          reason: "GPTs don't support file templates natively",
          suggestion:
            "Include template content in the GPT instructions or upload as knowledge files",
        });
      }

      // Write knowledge files for this skill
      if (skill.references.length > 0) {
        const skillKnowledge = join(knowledgeDir, skill.id);
        await mkdir(skillKnowledge, { recursive: true });
        for (const ref of skill.references) {
          const refPath = join(skillKnowledge, ref.name);
          await writeFile(refPath, ref.content, "utf-8");
          filesWritten.push(refPath);
        }
      }
    }

    // Convert standalone tools to function definitions
    if (workspace.tools.length > 0) {
      const functionsPath = join(targetPath, "functions.json");
      const functions = workspace.tools.map(toolToFunctionDefinition);
      await writeFile(
        functionsPath,
        JSON.stringify(functions, null, 2),
        "utf-8"
      );
      filesWritten.push(functionsPath);
    }

    // Write global knowledge files
    if (workspace.knowledge.length > 0) {
      await mkdir(knowledgeDir, { recursive: true });
      for (const file of workspace.knowledge) {
        const filePath = join(knowledgeDir, file.name);
        if (file.encoding === "base64") {
          await writeFile(filePath, Buffer.from(file.content, "base64"));
        } else {
          await writeFile(filePath, file.content, "utf-8");
        }
        filesWritten.push(filePath);
      }
    }

    // MCP servers — document but flag STDIO ones
    for (const server of workspace.mcpServers) {
      if (server.transport.type === "stdio") {
        unsupported.push({
          type: "config",
          name: `MCP: ${server.name}`,
          reason:
            "STDIO MCP servers run locally and can't be used directly with ChatGPT",
          suggestion:
            "Wrap this server with an HTTP/SSE transport layer (e.g., mcp-proxy) for ChatGPT compatibility",
        });
      }
    }

    // Scoped rules don't exist in OpenAI
    if (workspace.instructions.scopedRules.length > 0) {
      unsupported.push({
        type: "config",
        name: "scoped_rules",
        reason: "OpenAI has no equivalent of path-scoped rules",
        suggestion:
          "Merge relevant rules into GPT instructions or use separate GPTs for different contexts",
      });
    }

    // Generate migration guide
    const guidePath = join(targetPath, "MIGRATION_GUIDE.md");
    const guide = generateMigrationGuide(workspace, unsupported);
    await writeFile(guidePath, guide, "utf-8");
    filesWritten.push(guidePath);

    return { filesWritten, warnings, unsupported };
  }

  private inferCapabilities(tools: AssistantTool[]): SkillCapability[] {
    const caps: SkillCapability[] = [];
    for (const tool of tools) {
      if (tool.type === "code_interpreter") caps.push("code_execution");
      if (tool.type === "file_search") caps.push("file_search");
    }
    return caps;
  }

  private inferCapabilitiesFromGPT(
    capabilities: GPTConfig["capabilities"]
  ): SkillCapability[] {
    const caps: SkillCapability[] = [];
    if (capabilities.code_interpreter) caps.push("code_execution");
    if (capabilities.web_browsing) caps.push("web_search");
    if (capabilities.image_generation) caps.push("image_generation");
    if (capabilities.file_search) caps.push("file_search");
    return caps;
  }
}
