# Development Guide

This guide helps contributors build, test, and extend AI Agnostic locally.

## Prerequisites

- **Node.js** 18+ (check: `node --version`)
- **npm** 9+ (check: `npm --version`)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/connorbrewer/ai-agnostic.git
cd ai-agnostic

# Install dependencies
npm install

# Build (TypeScript → JavaScript)
npm run build

# Run in watch mode (rebuilds on file changes)
npm run dev

# Run the CLI
node dist/cli/index.js --help
```

## Project Structure

```
ai-agnostic/
├── src/
│   ├── types/
│   │   ├── workspace.ts      # Universal schema definitions
│   │   ├── adapter.ts        # Adapter interface contract
│   │   └── index.ts          # Exports
│   │
│   ├── core/
│   │   ├── converter.ts      # Main conversion logic
│   │   ├── registry.ts       # Adapter registry
│   │   └── index.ts          # Public API
│   │
│   ├── adapters/
│   │   ├── claude/
│   │   │   ├── index.ts      # Claude adapter
│   │   │   └── parser.ts     # Claude workspace parser
│   │   │
│   │   └── openai/
│   │       └── index.ts      # OpenAI adapter
│   │
│   ├── cli/
│   │   └── index.ts          # Commander CLI commands
│   │
│   └── index.ts              # Package entry point
│
├── dist/                      # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
├── README.md
├── CONTRIBUTING.md
└── DEVELOPMENT.md             # This file
```

## Key Concepts

### Universal Schema (`src/types/workspace.ts`)

The heart of AI Agnostic is the `AgnosticWorkspace` interface. It's a superset of all platform features:

```typescript
interface AgnosticWorkspace {
  name: string
  instructions: WorkspaceInstructions      // System prompt + scoped rules
  skills: AgnosticSkill[]                  // Custom assistants
  tools: AgnosticTool[]                    // Function calls / tools
  knowledge: AgnosticKnowledgeFile[]       // Reference docs
  mcpServers: AgnosticMCPServer[]          // Model context protocol servers
  extensions: Record<string, unknown>      // Platform-specific extras
}
```

### Adapter Pattern

Each platform has an **adapter** that implements two methods:

```typescript
interface Adapter {
  // Read platform's native format → AgnosticWorkspace
  read(sourcePath: string): Promise<AgnosticWorkspace>

  // AgnosticWorkspace → Write platform's native format
  write(workspace: AgnosticWorkspace, targetPath: string): Promise<ExportResult>
}
```

**Claude Adapter** (`src/adapters/claude/`)
- Reads: CLAUDE.md, .claude/, skills/, knowledge/
- Writes: Same structure for Claude import

**OpenAI Adapter** (`src/adapters/openai/`)
- Reads: assistants.json, custom_gpts/ structure
- Writes: OpenAI-compatible format

### Conversion Flow

```
User Input (source dir, --to platform)
        ↓
   Detect Platform (claude vs openai)
        ↓
   Load Source Adapter
        ↓
   read(sourcePath) → AgnosticWorkspace
        ↓
   Load Target Adapter
        ↓
   write(workspace, targetPath) → ExportResult
        ↓
   Report (successes, warnings, unsupported)
```

## Common Tasks

### Building

```bash
npm run build
```

Compiles `src/` to `dist/`. TypeScript strict mode enabled.

### Running the CLI

```bash
node dist/cli/index.js convert ./source ./target --to openai
node dist/cli/index.js inspect ./my-workspace
node dist/cli/index.js platforms
```

### Testing a Real Conversion

```bash
# Copy a real Claude workspace
cp -r ~/Documents/Claude/ai-agnostic ./test-workspaces/original

# Convert it
node dist/cli/index.js convert ./test-workspaces/original ./test-workspaces/converted --to openai

# Inspect the result
node dist/cli/index.js inspect ./test-workspaces/converted --json | jq '.skills | length'
```

### Type Checking

```bash
npm run lint
```

Runs `tsc --noEmit` to check for TypeScript errors without emitting files.

### Watch Mode

```bash
npm run dev
```

Automatically rebuilds when you save files in `src/`.

## Adding Features

### New Adapter

To support a new platform (e.g., Gemini):

1. **Create the adapter file:**
   ```bash
   touch src/adapters/gemini/index.ts
   ```

2. **Implement the Adapter interface:**
   ```typescript
   import { Adapter } from "../../types/index.js"
   import { AgnosticWorkspace } from "../../types/index.js"

   export class GeminiAdapter implements Adapter {
     async read(sourcePath: string): Promise<AgnosticWorkspace> {
       // Parse Gemini format from sourcePath
       // Return AgnosticWorkspace
     }

     async write(workspace: AgnosticWorkspace, targetPath: string) {
       // Write workspace to Gemini format
       // Return ExportResult
     }
   }
   ```

3. **Register in the registry** (`src/core/registry.ts`):
   ```typescript
   import { GeminiAdapter } from "../adapters/gemini/index.js"

   adapters.set("gemini", {
     adapter: new GeminiAdapter(),
     displayName: "Google Gemini",
     platform: "gemini"
   })
   ```

4. **Update README** with usage examples

5. **Test** with real Gemini workspaces

### Schema Changes

If you need to extend the universal schema:

1. Edit `src/types/workspace.ts`
2. Update adapters if they need to handle the new field
3. Bump `schemaVersion` if it's a breaking change
4. Document in README

### CLI Commands

New commands go in `src/cli/index.ts`. They use Commander.js:

```typescript
program
  .command("mycommand")
  .description("What this does")
  .argument("<input>", "Description")
  .option("--flag", "Description", false)
  .action(async (input, opts) => {
    // Do something
    console.log(chalk.green("Done!"))
  })
```

## Debugging

### Enable verbose output

Add `console.log()` statements (they'll appear during CLI execution).

### Inspect intermediate format

Save the intermediate AgnosticWorkspace:

```bash
node dist/cli/index.js convert ./source ./target --to openai --save-intermediate
```

This creates `.aiworkspace.json` for inspection.

### Type errors

If TypeScript is complaining, check:

1. **Imports** — Relative paths correct?
2. **Type definitions** — Does the type exist in `src/types/`?
3. **Async/await** — Are you awaiting promises?

Run `npm run lint` for full type check.

## Performance Notes

- Adapters load entire workspaces into memory. For very large workspaces (1000s of files), consider streaming.
- Binary assets are base64-encoded, which increases size ~33%. Consider compression for Phase 3.
- Currently no caching; each conversion re-parses from disk.

## Next Steps

- Phase 2: MCP server wrapper
- Phase 3: Web UI with progress visualization
- Phase 4: Community adapter registry

---

**Stuck?** Check the README, open an issue, or start a discussion!
