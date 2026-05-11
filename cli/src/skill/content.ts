// SKILL.md is shipped inside the bundle as a string via tsup's text loader
// (see `cli/tsup.config.ts`). We load it relative to this file so renames of
// the markdown don't require updating the loader config.
//
// @ts-expect-error — `.md` is loaded as text by esbuild; no .d.ts available.
import skillMarkdown from "../../skill/cent-cli/SKILL.md";

export const SKILL_MD: string = skillMarkdown as unknown as string;
export const SKILL_NAME = "cent-cli";
export const SKILL_FILE = "SKILL.md";
