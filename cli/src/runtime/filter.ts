import { BillCategories } from "@/ledger/category";
import {
    type CompiledAST,
    compileFilterQuery,
    type FilterQueryContext,
    matchFilterQuery,
    parseFilterQuery,
} from "@/ledger/filter-query";
import type { Bill, BillCategory, BillTag } from "@/ledger/type";
import { t } from "@/locale";

export type MetaLike = {
    categories?: BillCategory[];
    tags?: BillTag[];
    users?: { id: string | number; name: string }[];
    baseCurrency?: string;
};

// Filter-query's resolveIds is two-way (id | name). Inject a *double-expanded*
// category/tag list: each default entry appears twice in the ctx, once with
// its raw i18n key (e.g. "Food") and once with the current-locale translation
// (e.g. "餐饮"), both pointing to the same id. User-defined entries
// (customName === true for categories; tags whose name doesn't translate)
// pass through as-is. Resulting CompiledAST's ids array may contain
// duplicates, which is harmless for `.some(id => bill.x === id)` eval.
const expandCategory = (c: BillCategory): BillCategory[] =>
    c.customName ? [c] : [{ ...c }, { ...c, name: t(c.name) }];

const expandTag = (tag: BillTag): BillTag[] => {
    const localized = t(tag.name);
    return localized === tag.name
        ? [tag]
        : [{ ...tag }, { ...tag, name: localized }];
};

export const buildFilterContext = (meta: MetaLike): FilterQueryContext => {
    const mergedCategories: BillCategory[] = [
        ...(meta?.categories ?? []),
        ...BillCategories,
    ];
    const mergedTags: BillTag[] = meta?.tags ?? [];
    return {
        categories: mergedCategories.flatMap(expandCategory),
        tags: mergedTags.flatMap(expandTag),
        users: meta?.users ?? [],
        baseCurrency: meta?.baseCurrency,
    };
};

export const applyFilter = async <T extends Bill>(
    items: T[],
    query: string | undefined,
    getMeta: () => Promise<MetaLike>,
): Promise<T[]> => {
    if (!query || query.trim() === "") return items;
    const ast = parseFilterQuery(query);
    if (!ast) return items;
    const meta = await getMeta();
    const ctx = buildFilterContext(meta);
    const compiled: CompiledAST | null = compileFilterQuery(ast, ctx);
    return items.filter((bill) => matchFilterQuery(compiled, bill));
};
