#!/usr/bin/env node

/**
 * ai-agnostic CLI — Seamlessly migrate AI workspaces between platforms.
 *
 * Usage:
 *   ai-agnostic convert --from claude --to openai ./my-project ./output
 *   ai-agnostic inspect ./my-project
 *   ai-agnostic platforms
 */

import { Command } from "commander";
import chalk from "chalk";
import { convert, exportToJSON, listAdapters, detectPlatform } from "../core/index.js";
import type { AdapterType } from "../types/index.js";

const program = new Command();

program
  .name("ai-agnostic")
  .description(
    "Seamlessly migrate AI workspaces between Claude, ChatGPT, and other platforms"
  )
  .version("0.1.0");

// ─── convert ───────────────────────────────────────────────────────

program
  .command("convert")
  .description("Convert a workspace from one platform to another")
  .argument("<source>", "Source workspace directory")
  .argument("<target>", "Target output directory")
  .requiredOption("--to <platform>", "Target platform (claude, openai)")
  .option("--from <platform>", "Source platform (auto-detected if omitted)")
  .option("--no-assets", "Skip binary assets")
  .option("--no-knowledge", "Skip knowledge files")
  .option("--overwrite", "Overwrite existing files", false)
  .option("--save-intermediate", "Save .aiworkspace.json intermediate format", false)
  .action(async (source: string, target: string, opts) => {
    try {
      console.log(chalk.blue("\n  AI Agnostic — Workspace Converter\n"));

      const result = await convert({
        sourcePath: source,
        targetPath: target,
        from: opts.from as AdapterType | undefined,
        to: opts.to as AdapterType,
        includeAssets: opts.assets !== false,
        includeKnowledge: opts.knowledge !== false,
        overwrite: opts.overwrite,
        saveIntermediate: opts.saveIntermediate,
      });

      // Summary
      const { workspace, exportResult, detectedPlatform } = result;

      if (detectedPlatform) {
        console.log(
          chalk.dim(`  Auto-detected source platform: ${detectedPlatform}`)
        );
      }

      console.log(chalk.green(`  ✓ Converted "${workspace.name}"\n`));

      console.log(chalk.white("  Summary:"));
      console.log(`    Skills:      ${workspace.skills.length}`);
      console.log(`    Tools:       ${workspace.tools.length}`);
      console.log(`    MCP Servers: ${workspace.mcpServers.length}`);
      console.log(`    Knowledge:   ${workspace.knowledge.length} file(s)`);
      console.log(
        `    Files written: ${exportResult.filesWritten.length}`
      );

      if (exportResult.warnings.length > 0) {
        console.log(chalk.yellow("\n  Warnings:"));
        for (const w of exportResult.warnings) {
          console.log(chalk.yellow(`    ⚠ ${w}`));
        }
      }

      if (exportResult.unsupported.length > 0) {
        console.log(chalk.red("\n  Needs manual attention:"));
        for (const u of exportResult.unsupported) {
          console.log(chalk.red(`    ✗ [${u.type}] ${u.name}: ${u.reason}`));
          if (u.suggestion) {
            console.log(chalk.dim(`      → ${u.suggestion}`));
          }
        }
      }

      console.log(
        chalk.green(`\n  ✓ Output written to: ${target}`)
      );
      console.log(
        chalk.dim(`    See MIGRATION_GUIDE.md for next steps.\n`)
      );
    } catch (err) {
      console.error(
        chalk.red(`\n  Error: ${(err as Error).message}\n`)
      );
      process.exit(1);
    }
  });

// ─── inspect ───────────────────────────────────────────────────────

program
  .command("inspect")
  .description("Inspect a workspace and show its contents in universal format")
  .argument("<source>", "Workspace directory to inspect")
  .option("--from <platform>", "Source platform (auto-detected if omitted)")
  .option("--json", "Output raw JSON", false)
  .action(async (source: string, opts) => {
    try {
      const workspace = await exportToJSON(
        source,
        opts.from as AdapterType | undefined
      );

      if (opts.json) {
        console.log(JSON.stringify(workspace, null, 2));
        return;
      }

      console.log(chalk.blue("\n  AI Agnostic — Workspace Inspector\n"));
      console.log(chalk.white(`  Workspace: ${workspace.name}`));
      console.log(chalk.dim(`  Source: ${workspace.sourceAdapter}`));
      console.log(
        chalk.dim(`  Exported: ${workspace.exportedAt}`)
      );

      if (workspace.instructions.system) {
        const preview = workspace.instructions.system.slice(0, 200);
        console.log(chalk.white("\n  System Instructions:"));
        console.log(chalk.dim(`    ${preview}${preview.length >= 200 ? "..." : ""}`));
      }

      if (workspace.skills.length > 0) {
        console.log(chalk.white(`\n  Skills (${workspace.skills.length}):`));
        for (const skill of workspace.skills) {
          console.log(
            `    ${chalk.green("●")} ${skill.name} — ${skill.description || "(no description)"}`
          );
          const parts: string[] = [];
          if (skill.references.length) parts.push(`${skill.references.length} refs`);
          if (skill.scripts.length) parts.push(`${skill.scripts.length} scripts`);
          if (skill.templates.length) parts.push(`${skill.templates.length} templates`);
          if (skill.assets.length) parts.push(`${skill.assets.length} assets`);
          if (parts.length) {
            console.log(chalk.dim(`      ${parts.join(", ")}`));
          }
        }
      }

      if (workspace.mcpServers.length > 0) {
        console.log(
          chalk.white(`\n  MCP Servers (${workspace.mcpServers.length}):`)
        );
        for (const server of workspace.mcpServers) {
          console.log(
            `    ${chalk.cyan("●")} ${server.name} (${server.transport.type})`
          );
        }
      }

      if (workspace.instructions.scopedRules.length > 0) {
        console.log(
          chalk.white(
            `\n  Scoped Rules (${workspace.instructions.scopedRules.length}):`
          )
        );
        for (const rule of workspace.instructions.scopedRules) {
          console.log(chalk.dim(`    ${rule.pathPattern}`));
        }
      }

      console.log();
    } catch (err) {
      console.error(
        chalk.red(`\n  Error: ${(err as Error).message}\n`)
      );
      process.exit(1);
    }
  });

// ─── platforms ─────────────────────────────────────────────────────

program
  .command("platforms")
  .description("List supported platforms")
  .action(() => {
    console.log(chalk.blue("\n  AI Agnostic — Supported Platforms\n"));
    for (const adapter of listAdapters()) {
      console.log(
        `    ${chalk.green("●")} ${adapter.displayName} (${adapter.platform})`
      );
    }
    console.log();
  });

// ─── detect ────────────────────────────────────────────────────────

program
  .command("detect")
  .description("Auto-detect the platform of a workspace directory")
  .argument("<path>", "Directory to check")
  .action(async (path: string) => {
    const platform = await detectPlatform(path);
    if (platform) {
      console.log(chalk.green(`\n  Detected: ${platform}\n`));
    } else {
      console.log(
        chalk.yellow(
          `\n  Could not detect platform. Directory may not be an AI workspace.\n`
        )
      );
    }
  });

program.parse();
