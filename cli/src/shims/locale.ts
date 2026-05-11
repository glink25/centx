// Real i18n shim for `@/locale` (was a no-op stub in phase 1).
//
// Background: default categories/tags in `src/ledger/category.ts` use English
// i18n KEYS as their `name` field (e.g. `name: "Food"`); the human-readable
// "餐饮" is produced by Web's react-intl via `t("Food")`. The CLI is invoked
// by humans/AI who see the localized UI elsewhere and naturally type "餐饮"
// — so the CLI must do the same key→translation lookup.
//
// We bake BOTH zh and en tables into the bundle (each ~30KB); the active
// table is picked at startup from `process.env.LANG`. Override with
// `CENT_CLI_LANG` if needed (takes precedence).

// Relative paths because the `@/locale` alias is bound to *this file*,
// which would shadow `@/locale/lang/*.json` resolution.
import en from "../../../src/locale/lang/en.json";
import zh from "../../../src/locale/lang/zh.json";

export type LocaleName = "zh" | "en";

const tables: Record<LocaleName, Record<string, string>> = {
    zh: zh as Record<string, string>,
    en: en as Record<string, string>,
};

const pickLocale = (): LocaleName => {
    const override = process.env.CENT_CLI_LANG?.toLowerCase();
    if (override === "zh" || override === "en") return override;
    const sys = (process.env.LANG ?? process.env.LC_ALL ?? "").toLowerCase();
    // Mirror src/locale/utils.ts matcher: any string containing "zh" → zh.
    if (sys.includes("zh")) return "zh";
    return "en";
};

export const currentLocale: LocaleName = pickLocale();
const table = tables[currentLocale];

// Web's `@/locale` exports `intl` (a react-intl `IntlShape`) used for
// `intl.locale === "zh"` checks in @/utils/time.ts. CLI just needs the
// `.locale` field, so we expose a minimal shape — anything else accessed
// would surface as `undefined` and is unlikely on CLI paths.
export const intl = { locale: currentLocale } as { locale: LocaleName };

// react-intl-flavored `t`: key + optional params. Supports simple `{var}`
// substitution for analyze descriptions etc; values that aren't string|number
// are stringified via String() (objects → "[object Object]"). No plural/select
// — Web uses react-intl for those, but CLI keys we render are plain `{var}`.
export const t = (key: string, params?: Record<string, any>): string => {
    const raw = table[key] ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
        const v = params[name];
        return v == null ? "" : String(v);
    });
};
