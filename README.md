# AI Agnostic

> Seamlessly migrate AI workspaces between Claude, ChatGPT, and other platforms.

AI Agnostic is a TypeScript/Node.js CLI tool that solves the **vendor lock-in problem** for AI workspaces. Convert your Claude workspace (skills, knowledge, instructions) to OpenAI format—and vice versa—through a universal intermediate schema.

## The Problem

You've invested time building AI workspaces, custom skills, and knowledge bases in Claude. But what if you want to migrate to OpenAI? Or maintain workspaces across multiple platforms? Without a conversion tool, you're stuck manually rebuilding everything.

**AI Agnostic changes that.** It provides a platform-agnostic format that lets you:

- Export your workspace from any supported platform
- Inspect the structure (skills, tools, knowledge, MCP servers)
- Convert to any other platform
- Preserve as much as possible during translation

## Quick Start

### Installation

```bash
npm install -g ai-agnostic
```

Or use locally from the project:

```bash
npm install
npm run build
node dist/cli/index.js --help
```

### Basic Usage

#### Convert a Claude workspace to OpenAI format

```bash
ai-agnostic convert ./my-claude-workspace ./output --to openai
```

The tool auto-detects your source platform. If needed, specify it explicitly:

```bash
ai-agnostic convert ./workspace ./output --from claude --to openai
```

#### Inspect a workspace

See what's in your workspace before converting:

```bash
ai-agnostic inspect ./my-claude-workspace
```

Output:
```
  Workspace: My Project
  Source: claude
  Exported: 2025-03-22T10:30:00Z

  System Instructions:
    You are a helpful assistant specialized in...

  Skills (3):
    ● code-analyzer — Analyze and explain code
    ● documentation-writer — Generate API docs
    ● research-assistant — Conduct web research

  MCP Servers (2):
    ● postgres (stdio)
    ● weather-api (http)
```

#### List supported platforms

```bash
ai-agnostic platforms
```

Output:
```
  AI Agnostic — Supported Platforms

    ● Claude (claude)
    ● OpenAI (openai)
```

#### Auto-detect platform

```bash
ai-agnostic detect ./my-workspace
```

## CLI Commands

### `convert <source> <target> [options]`

Convert a workspace from one platform to another.

**Arguments:**
- `<source>` — Source workspace directory
- `<target>` — Target output directory

**Options:**
- `--from <platform>` — Source platform (`claude`, `openai`). Auto-detected if omitted.
- `--to <platform>` — **Required.** Target platform.
- `--no-assets` — Skip binary assets (images, files)
- `--no-knowledge` — Skip knowledge files
- `--overwrite` — Overwrite existing files in target
- `--save-intermediate` — Save the `.aiworkspace.json` intermediate format

**Example:**
```bash
ai-agnostic convert /Users/name/Claude --to openai ./openai-workspace --overwrite
```

### `inspect <source> [options]`

Display the contents of a workspace in human-readable format (or raw JSON).

**Arguments:**
- `<source>` — Workspace directory

**Options:**
- `--from <platform>` — Source platform (auto-detected if omitted)
- `--json` — Output raw JSON instead of formatted text

**Example:**
```bash
ai-agnostic inspect ./my-workspace --json | jq '.skills[] | .name'
```

### `platforms`

List all supported platforms and adapters.

### `detect <path>`

Auto-detect the platform of a workspace directory.

**Example:**
```bash
ai-agnostic detect ./my-workspace
# Outputs: Detected: claude
```

## The Universal Schema

The core of AI Agnostic is a **universal workspace schema** that sits between all platforms. Every adapter (Claude, OpenAI, etc.) reads FROM platform-native format INTO this schema, and writes FROM the schema INTO platform-native format.

### Workspace Structure

```typescript
interface AgnosticWorkspace {
  schemaVersion: "0.1.0"
  name: string                    // Workspace name
  exportedAt: string              // ISO timestamp
  sourceAdapter: AdapterType      // "claude" | "openai" | etc.

  instructions: {
    system: string                // Global system instructions
    scopedRules: ScopedRule[]      // Path-specific rules
    starters: string[]             // Example conversation starters
  }

  skills: AgnosticSkill[]          // Custom skills/assistants
  tools: AgnosticTool[]            // Tool definitions
  knowledge: AgnosticKnowledgeFile[] // Reference documents
  mcpServers: AgnosticMCPServer[]  // MCP server configs
  extensions: object               // Platform-specific metadata
}
```

### Key Components

**Skills** represent custom assistants or behaviors:
- Name, description, and full prompt
- Reference documents (markdown files)
- Templates (for file generation)
- Scripts (executable code)
- Assets (images, files)
- Required capabilities (code execution, web search, etc.)

**Tools** are function-like capabilities:
- Name and description
- JSON Schema for inputs/outputs
- Invocation method (MCP, HTTP, function call)

**Knowledge** stores reference documents and files:
- Base64-encoded for binary, UTF-8 for text
- Full file metadata (MIME type, size)

**MCP Servers** define model context protocol connections:
- Transport method (stdio, SSE, HTTP)
- Available tools and environment variables

## Roadmap

### Phase 1: CLI ✓
- [x] Universal schema design
- [x] Claude adapter (read/write)
- [x] OpenAI adapter (read/write)
- [x] CLI with convert, inspect, detect, platforms commands
- [x] Real-world conversion testing (7 skills from Claude → OpenAI)

### Phase 2: MCP Server
- [ ] Expose universal schema as MCP server
- [ ] Allow Claude / OpenAI to call converters from within conversations
- [ ] Enable live workspace inspection and migration workflows

### Phase 3: Web Application
- [ ] Drag-and-drop workspace upload
- [ ] Interactive conversion preview
- [ ] Download converted workspaces
- [ ] Multi-user workspace management

### Phase 4: Open Standard
- [ ] Propose AI Agnostic as an open standard for workspace portability
- [ ] Build ecosystem: adapters for Gemini, Llama, custom LLMs
- [ ] Create community-driven adapter registry

## How It Works

1. **Detect** — AI Agnostic analyzes the source directory to identify the platform
2. **Parse** — The source adapter reads the platform's native format into the universal schema
3. **Map** — The target adapter translates the universal schema into platform-native format
4. **Export** — Files are written to the target directory with warnings for unsupported features

### Example: Claude → OpenAI

```
Claude Workspace
├── CLAUDE.md           ┐
├── .claude/           ├─→  Parse  ───→  AgnosticWorkspace  ───→  Map  ───→  OpenAI Format
├── skills/           │                                              ├─→ custom_gpts/
└── knowledge/        ┘                                              ├─→ assistants.json
                                                                     └─→ knowledge/
```

## Adapters

Adapters are bidirectional translators between a platform's native format and the universal schema.

### Claude Adapter
- **Reads:** Claude workspace structure (CLAUDE.md, .claude/, skills/, knowledge/)
- **Writes:** Claude-compatible directory structure
- **Supports:** Skills, MCP servers, knowledge files, scoped rules, system instructions

### OpenAI Adapter
- **Reads:** OpenAI workspace format (custom_gpts/, assistants.json)
- **Writes:** OpenAI-compatible format
- **Supports:** Assistants, tools, custom GPTs, knowledge files

## Contributing

AI Agnostic is in early stages. We welcome:

- **Bug reports** — Found an issue? Open an issue with reproduction steps.
- **Feature requests** — Want support for another platform? Let us know.
- **Pull requests** — Want to build an adapter for Gemini, Llama, etc.? We'd love to review your PR.
- **Feedback** — Suggestions on the schema, CLI, or anything else.

### Local Development

```bash
# Clone and install
git clone https://github.com/connorbrewer/ai-agnostic.git
cd ai-agnostic
npm install

# Build
npm run build

# Run CLI
node dist/cli/index.js --help

# Watch mode for development
npm run dev
```

## License

MIT — See [LICENSE](./LICENSE) for details.

## Acknowledgments

Built to solve the AI workspace portability problem. Inspired by:
- Docker for containerization standardization
- Kubernetes for orchestration portability
- Open standards like OpenAPI and AsyncAPI

---

**Questions?** Open an issue or discussion on GitHub. Happy converting!
