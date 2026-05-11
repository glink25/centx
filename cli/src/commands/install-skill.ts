// Install the bundled Claude skill into ~/.claude/skills/cent-cli/SKILL.md.
//
// The skill markdown is embedded into the CLI bundle (see src/skill/content.ts),
// so this works on a freshly `npx`-downloaded copy with no extra files to ship.
// Default install root is `~/.claude/skills/`; override with $CLAUDE_HOME (sets
// `<CLAUDE_HOME>/skills/`) when the user has a non-default Claude home.
//
// Conscious choices:
// - Refuses to overwrite an existing SKILL.md unless --force is passed; we treat
//   an existing skill file as user-modified content and don't clobber by default.
// - --print writes the embedded markdown to stdout instead of touching disk —
//   useful for inspecting the skill content or piping to a custom location.
// - No "uninstall" subcommand: removing a skill is `rm -rf <dir>` and we don't
//   want a destructive CLI verb that could nuke unrelated files if the dir was
//   reused.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SKILL_FILE, SKILL_MD, SKILL_NAME } from "../skill/content.ts";
import { printJson } from "../runtime/output.ts";

export type InstallSkillOptions = {
    force?: boolean;
    print?: boolean;
    dir?: string;
    json?: boolean;
};

const resolveSkillDir = (override?: string): string => {
    if (override) return override;
    const claudeHome = process.env.CLAUDE_HOME;
    const root = claudeHome
        ? join(claudeHome, "skills")
        : join(homedir(), ".claude", "skills");
    return join(root, SKILL_NAME);
};

export const installSkill = async (opts: InstallSkillOptions) => {
    if (opts.print) {
        process.stdout.write(SKILL_MD);
        if (!SKILL_MD.endsWith("\n")) process.stdout.write("\n");
        return;
    }

    const dir = resolveSkillDir(opts.dir);
    const target = join(dir, SKILL_FILE);

    if (existsSync(target) && !opts.force) {
        throw new Error(
            `${target} already exists — pass --force to overwrite (will replace any local edits)`,
        );
    }

    mkdirSync(dir, { recursive: true });
    writeFileSync(target, SKILL_MD, "utf8");

    if (opts.json) {
        printJson({ ok: true, skill: SKILL_NAME, path: target });
    } else {
        process.stdout.write(`installed ${SKILL_NAME} → ${target}\n`);
        process.stdout.write(
            "restart Claude Code to pick up the new skill\n",
        );
    }
};
