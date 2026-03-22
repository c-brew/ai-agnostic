# Contributing to AI Agnostic

Thanks for your interest in AI Agnostic! We're in early stages and actively welcoming contributions.

## How to Contribute

### Reporting Issues

Found a bug or have a suggestion? Open an issue with:

- **Title** — Clear, concise description
- **Environment** — Node.js version, OS, reproduction steps
- **Expected vs. Actual** — What should happen vs. what happens
- **Minimal Example** — If applicable, a minimal workspace that reproduces the issue

### Submitting Pull Requests

1. **Fork the repo** and create a branch from `main`
2. **Make your changes** — Keep commits focused and well-described
3. **Build and test:**
   ```bash
   npm run build
   npm run lint
   ```
4. **Write or update tests** if you're adding features
5. **Submit the PR** with a clear description of what changed and why

We'll review and provide feedback. We aim to be responsive and collaborative.

## Development Setup

```bash
git clone https://github.com/connorbrewer/ai-agnostic.git
cd ai-agnostic
npm install
npm run dev  # Watch mode
```

## Architecture

The codebase is organized as:

- **`src/types/`** — Universal workspace schema (TypeScript interfaces)
- **`src/core/`** — Converter engine and adapter registry
- **`src/adapters/`** — Platform-specific adapters (Claude, OpenAI)
- **`src/cli/`** — Commander CLI interface

### Adding a New Adapter

To add support for a new platform (e.g., Gemini):

1. Create `src/adapters/gemini/index.ts`
2. Implement `GeminiAdapter` with methods:
   - `async read(sourcePath: string): Promise<AgnosticWorkspace>`
   - `async write(workspace: AgnosticWorkspace, targetPath: string): Promise<ExportResult>`
3. Register it in `src/core/registry.ts`
4. Add tests in `src/adapters/gemini/__tests__/`
5. Update README with example usage

## Code Style

- **TypeScript** — Strict mode enabled
- **Formatting** — Use your editor's formatter (we recommend Prettier)
- **Comments** — Use JSDoc for public APIs
- **Naming** — camelCase for functions/variables, PascalCase for types/classes

## Roadmap Priorities

We're currently focused on:

1. **Phase 1 (Current)** — Robust Claude ↔ OpenAI conversion
2. **Phase 2** — MCP server wrapper for in-conversation usage
3. **Phase 3** — Web UI for non-technical users
4. **Phase 4** — Open standard and community adapters

Issues labeled `good-first-issue` are great entry points for new contributors.

## Questions?

Open an issue or start a discussion. We're here to help!

---

Happy coding!
