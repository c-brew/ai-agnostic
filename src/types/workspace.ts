/**
 * AI Agnostic — Universal Workspace Schema
 *
 * This is the intermediate representation that sits between all platforms.
 * Every adapter reads FROM a platform-native format INTO this schema,
 * and writes FROM this schema INTO a platform-native format.
 *
 * Design principles:
 * - Capture intent, not implementation details
 * - Superset of what all platforms support (with optional fields)
 * - Platform-specific metadata preserved in `extensions`
 * - JSON-serializable for easy storage and transport
 */

// ─── Top-level Workspace ───────────────────────────────────────────

export interface AgnosticWorkspace {
  /** Schema version for forward compatibility */
  schemaVersion: "0.1.0";

  /** Human-readable workspace name */
  name: string;

  /** When this export was created */
  exportedAt: string;

  /** Which platform this was exported from */
  sourceAdapter: AdapterType;

  /** Global system instructions (CLAUDE.md / GPT instructions) */
  instructions: WorkspaceInstructions;

  /** Skills / Custom GPTs / Assistants */
  skills: AgnosticSkill[];

  /** Tool definitions (MCP tools / function calling) */
  tools: AgnosticTool[];

  /** Knowledge files and documents */
  knowledge: AgnosticKnowledgeFile[];

  /** MCP server configurations */
  mcpServers: AgnosticMCPServer[];

  /** Platform-specific data that doesn't map cleanly */
  extensions: Record<string, unknown>;
}

// ─── Adapter Types ─────────────────────────────────────────────────

export type AdapterType = "claude" | "openai" | "gemini" | "generic";

// ─── Instructions ──────────────────────────────────────────────────

export interface WorkspaceInstructions {
  /** The main system prompt / project instructions */
  system: string;

  /** Scoped rules (e.g., .claude/rules/ or per-folder instructions) */
  scopedRules: ScopedRule[];

  /** Conversation starters / example prompts */
  starters: string[];
}

export interface ScopedRule {
  /** Glob pattern for which files/paths this rule applies to */
  pathPattern: string;

  /** The rule content */
  content: string;
}

// ─── Skills (the big one) ──────────────────────────────────────────

export interface AgnosticSkill {
  /** Unique identifier (kebab-case) */
  id: string;

  /** Display name */
  name: string;

  /** Short description — used for triggering / discovery */
  description: string;

  /** The full prompt / instructions for this skill */
  prompt: string;

  /** Reference documents loaded on-demand */
  references: AgnosticReference[];

  /** Templates for file generation */
  templates: AgnosticTemplate[];

  /** Executable scripts bundled with the skill */
  scripts: AgnosticScript[];

  /** Static assets */
  assets: AgnosticAsset[];

  /** Which capabilities this skill needs */
  capabilities: SkillCapability[];

  /** Platform-specific metadata */
  extensions: Record<string, unknown>;
}

export type SkillCapability =
  | "code_execution"
  | "web_search"
  | "file_search"
  | "image_generation"
  | "data_analysis";

export interface AgnosticReference {
  /** Filename */
  name: string;
  /** Content (markdown) */
  content: string;
}

export interface AgnosticTemplate {
  name: string;
  content: string;
}

export interface AgnosticScript {
  name: string;
  language: "python" | "bash" | "javascript" | "typescript";
  content: string;
}

export interface AgnosticAsset {
  name: string;
  /** Base64-encoded content for binary files, raw string for text */
  content: string;
  mimeType: string;
  encoding: "base64" | "utf-8";
}

// ─── Tools ─────────────────────────────────────────────────────────

export interface AgnosticTool {
  /** Tool name */
  name: string;

  /** What this tool does */
  description: string;

  /** JSON Schema for input parameters */
  inputSchema: Record<string, unknown>;

  /** JSON Schema for output (if known) */
  outputSchema?: Record<string, unknown>;

  /** How this tool is invoked */
  invocation: ToolInvocation;
}

export type ToolInvocation =
  | { type: "mcp"; serverName: string }
  | { type: "http"; endpoint: string; method: string }
  | { type: "function"; runtime: string };

// ─── Knowledge Files ───────────────────────────────────────────────

export interface AgnosticKnowledgeFile {
  /** Original filename */
  name: string;

  /** MIME type */
  mimeType: string;

  /** File content — base64 for binary, utf-8 for text */
  content: string;

  encoding: "base64" | "utf-8";

  /** File size in bytes */
  sizeBytes: number;
}

// ─── MCP Servers ───────────────────────────────────────────────────

export interface AgnosticMCPServer {
  /** Server name / identifier */
  name: string;

  /** Human-readable description */
  description?: string;

  /** How to connect */
  transport: MCPTransport;

  /** Tools this server provides (if known at export time) */
  tools: string[];

  /** Environment variables needed */
  env: Record<string, string>;
}

export type MCPTransport =
  | { type: "stdio"; command: string; args: string[] }
  | { type: "sse"; url: string }
  | { type: "http"; url: string };
