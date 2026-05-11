// `cent-cli analyze` — produce structured stat-page-equivalent data plus
// human-readable descriptions. Reuses two pure cores from Cent Web:
//   - processBillDataForCharts (src/utils/charts.ts): totals + structures
//   - analysis (src/api/storage/analysis.ts): day/week/month/year averages,
//     previous/last-year comparisons.
//
// Time range is *required* — pass either --from/--to or --unit [--ref];
// passing neither is a hard error (per project decision: AI clarity > magic).

import dayjs from "dayjs";
import { BillCategories } from "@/ledger/category";
import { amountToNumber } from "@/ledger/bill";
import {
    type AnalysisResult,
    type AnalysisType,
    type AnalysisUnit,
    analysis as runAnalysis,
} from "@/api/storage/analysis";
import type { Bill, BillCategory } from "@/ledger/type";
import { t } from "@/locale";
import { processBillDataForCharts } from "@/utils/charts";
import { resolveBook } from "../runtime/book.ts";
import { createGithubEndpoint } from "../runtime/context.ts";
import { applyFilter } from "../runtime/filter.ts";
import { printJson } from "../runtime/output.ts";

export type AnalyzeOptions = {
    book?: string;
    from?: string;
    to?: string;
    unit?: string;
    ref?: string;
    query?: string;
    type?: string;
    top?: string | number;
    json?: boolean;
};

const ANALYSIS_UNITS: AnalysisUnit[] = ["year", "month", "week", "day"];
const ANALYSIS_TYPES: AnalysisType[] = ["expense", "income", "balance"];

export const analyze = async (opts: AnalyzeOptions) => {
    if (!opts.book) throw new Error("--book <name|id> is required");

    const { period, unit, ref } = resolvePeriod(opts);
    const focusType = resolveFocusType(opts.type);
    const topN = resolveTop(opts.top);

    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, opts.book);

    await endpoint.initBook(book.id);
    await syncOnce(endpoint);

    const all = (await endpoint.getAllItems(book.id)) as Bill[];
    const meta = await endpoint.getMeta(book.id);
    const filteredAll = await applyFilter(all, opts.query, async () => meta);

    const fetchBills = async (range: [number, number]) => {
        const [s, e] = range;
        return filteredAll.filter((b) => b.time >= s && b.time < e);
    };

    const periodBills = await fetchBills(period);

    const collaborators = await safeGetCollaborators(endpoint, book.id);
    const userMap = new Map<string, string>(
        collaborators.map((u: any) => [String(u.id), String(u.name ?? u.id)]),
    );
    const categoryMap = new Map<string, BillCategory>(
        [...(meta?.categories ?? []), ...BillCategories].map((c) => [c.id, c]),
    );

    const charts = processBillDataForCharts(
        {
            bills: periodBills,
            getCategory: (id) => {
                const c = categoryMap.get(id);
                if (!c) {
                    return { id, name: id, parent: { id, name: id } };
                }
                const localized = c.customName ? c.name : t(c.name);
                if (!c.parent) {
                    return {
                        id: c.id,
                        name: localized,
                        parent: { id: c.id, name: localized },
                    };
                }
                const parent = categoryMap.get(c.parent);
                const parentName = parent
                    ? parent.customName
                        ? parent.name
                        : t(parent.name)
                    : c.parent;
                return {
                    id: c.id,
                    name: localized,
                    parent: { id: c.parent, name: parentName },
                };
            },
            getUserInfo: (id) => ({
                id,
                name: userMap.get(String(id)) ?? `user-${id}`,
            }),
            // Auto-pick gap exactly like the Web stat page (charts.ts default).
        },
        t,
    );

    const ana = await runAnalysis(period, focusType, unit, fetchBills);
    const anaOut = mainUnitAnalysis(ana);
    const growthVsPrevious = pctChange(
        anaOut.current.total,
        anaOut.previous.total,
    );
    const growthVsLastYear = pctChange(
        anaOut.current.total,
        anaOut.lastYear.total,
    );

    const baseCurrency: string = meta?.baseCurrency ?? "";
    const fmt = (n: number) => formatMoney(n, baseCurrency);

    const expenseStruct = limit(charts.expenseStructure, topN);
    const incomeStruct = limit(charts.incomeStructure, topN);
    const tags = (meta?.tags ?? []) as { id: string; name: string }[];
    const tagStruct = Array.from(charts.tagStructure.entries())
        .map(([id, v]) => {
            const tag = tags.find((x) => x.id === id);
            return {
                id,
                name: tag?.name ?? id,
                income: v.income,
                expense: v.expense,
            };
        })
        .sort((a, b) => b.expense + b.income - (a.expense + a.income))
        .slice(0, topN);

    const userStruct = {
        expense: limit(charts.userExpenseStructure, topN),
        income: limit(charts.userIncomeStructure, topN),
        balance: limit(charts.userBalanceStructure, topN),
    };

    const subCategoryStructure: Record<
        string,
        { id: string; name: string; value: number }[]
    > = Object.fromEntries(
        Object.entries(charts.subCategoryStructure).map(([k, arr]) => [
            k,
            limit(arr, topN),
        ]),
    );

    const summary =
        unit !== undefined
            ? t(`analysis.summary.${focusType}.${unit}`, {
                  dayAvg: fmt(anaOut.current.dayAvg),
                  weekAvg: fmt(anaOut.current.weekAvg),
                  monthAvg: fmt(anaOut.current.monthAvg),
                  yearAvg: fmt(anaOut.current.yearAvg),
                  projectedTotal: fmt(anaOut.projected.total),
              })
            : undefined;

    const growthText = (v: number) =>
        t(
            v >= 0
                ? "analysis.growth.positive"
                : "analysis.growth.negative",
            { p: (Math.abs(v) * 100).toFixed(2) },
        );
    const comparison =
        unit !== undefined && unit !== "day"
            ? t("analysis.comparison.full", {
                  lastPeriod: t(`period.${unit}`),
                  changeSinceLastPeriod: growthText(growthVsPrevious),
                  changeSinceLastYear: growthText(growthVsLastYear),
              })
            : undefined;

    const totalDesc = describeTotal(charts.total, periodBills.length, fmt);
    const structureDesc = describeStructure(
        focusType === "income" ? incomeStruct : expenseStruct,
        focusType,
    );
    const topExpenseDesc = charts.highestExpenseBill
        ? describeTopBill(charts.highestExpenseBill, "expense", fmt)
        : undefined;
    const topIncomeDesc = charts.highestIncomeBill
        ? describeTopBill(charts.highestIncomeBill, "income", fmt)
        : undefined;

    const result = {
        range: {
            from: period[0],
            to: period[1],
            fromIso: new Date(period[0]).toISOString(),
            toIso: new Date(period[1]).toISOString(),
            unit,
            ref: ref?.toISOString(),
            focusType,
            count: periodBills.length,
            baseCurrency,
        },
        total: charts.total,
        structure: {
            expense: expenseStruct,
            income: incomeStruct,
            subCategory: subCategoryStructure,
            tag: tagStruct,
            user: userStruct,
        },
        trend: {
            gap:
                periodBills.length === 0
                    ? "date"
                    : periodBills[0].time - periodBills.at(-1)!.time >
                        90 * 24 * 60 * 60 * 1000
                      ? "month"
                      : "date",
            source: charts.overallTrend.source,
        },
        top: {
            expense: charts.highestExpenseBill ?? undefined,
            income: charts.highestIncomeBill ?? undefined,
        },
        analysis: {
            ...anaOut,
            growthVsPrevious,
            growthVsLastYear,
        },
        descriptions: {
            summary,
            comparison,
            total: totalDesc,
            structure: structureDesc,
            topExpense: topExpenseDesc,
            topIncome: topIncomeDesc,
        },
    };

    if (opts.json) {
        printJson(result);
        return;
    }
    renderText(result, fmt);
};

const resolvePeriod = (
    opts: AnalyzeOptions,
): { period: [number, number]; unit: AnalysisUnit | undefined; ref?: Date } => {
    const hasRange = Boolean(opts.from || opts.to);
    const hasUnit = Boolean(opts.unit);
    if (hasRange && hasUnit) {
        throw new Error(
            "pass either --from/--to OR --unit, not both",
        );
    }
    if (!hasRange && !hasUnit) {
        throw new Error(
            "time range is required: pass --from <iso> --to <iso> or --unit year|month|week|day",
        );
    }
    if (hasRange) {
        if (!opts.from || !opts.to) {
            throw new Error("--from and --to must both be provided");
        }
        const from = parseIso(opts.from, "--from");
        const to = parseIso(opts.to, "--to");
        if (from >= to) {
            throw new Error("--from must be earlier than --to");
        }
        return { period: [from, to], unit: undefined };
    }
    const unit = opts.unit as AnalysisUnit;
    if (!ANALYSIS_UNITS.includes(unit)) {
        throw new Error(
            `--unit must be one of ${ANALYSIS_UNITS.join("|")} (got "${opts.unit}")`,
        );
    }
    const ref = opts.ref ? new Date(parseIso(opts.ref, "--ref")) : new Date();
    const start = dayjs(ref).startOf(unit).valueOf();
    const end = dayjs(start).add(1, unit).valueOf();
    return { period: [start, end], unit, ref };
};

const resolveFocusType = (input: string | undefined): AnalysisType => {
    const v = (input ?? "expense") as AnalysisType;
    if (!ANALYSIS_TYPES.includes(v)) {
        throw new Error(
            `--type must be one of ${ANALYSIS_TYPES.join("|")} (got "${input}")`,
        );
    }
    return v;
};

const resolveTop = (input: string | number | undefined): number => {
    if (input === undefined) return 10;
    const n = Number(input);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--top must be a positive number (got "${input}")`);
    }
    return Math.floor(n);
};

const parseIso = (input: string, label: string): number => {
    const t = Date.parse(input);
    if (Number.isNaN(t)) {
        throw new Error(`${label} must be ISO-8601 parseable (got "${input}")`);
    }
    return t;
};

const safeGetCollaborators = async (
    endpoint: any,
    bookId: string,
): Promise<{ id: string | number; name?: string }[]> => {
    try {
        return (await endpoint.getCollaborators?.(bookId)) ?? [];
    } catch {
        return [];
    }
};

const limit = <T>(arr: T[], n: number): T[] => arr.slice(0, n);

const pctChange = (cur: number, prev: number): number =>
    prev === 0 ? 0 : (cur - prev) / prev;

const formatMoney = (n: number, currency: string): string => {
    const fixed = (Math.round(n * 100) / 100).toFixed(2);
    return currency ? `${currency} ${fixed}` : fixed;
};

// Convert AnalysisResult fields from internal 10000:1 integer to main unit.
const mainUnitDetail = (d: AnalysisResult["current"]) => ({
    total: amountToNumber(d.total),
    days: d.days,
    dayAvg: amountToNumber(d.dayAvg),
    weekAvg: amountToNumber(d.weekAvg),
    monthAvg: amountToNumber(d.monthAvg),
    yearAvg: amountToNumber(d.yearAvg),
});
const mainUnitAnalysis = (a: AnalysisResult) => ({
    current: mainUnitDetail(a.current),
    projected: mainUnitDetail(a.projected),
    previous: mainUnitDetail(a.previous),
    lastYear: mainUnitDetail(a.lastYear),
});

const describeTotal = (
    total: { income: number; expense: number; balance: number },
    count: number,
    fmt: (n: number) => string,
): string =>
    `${count} bills in range; income ${fmt(total.income)}, expense ${fmt(total.expense)}, balance ${fmt(total.balance)}`;

const describeStructure = (
    items: { name: string; value: number }[],
    type: AnalysisType,
): string => {
    if (items.length === 0) return `no ${type} categories in range`;
    const totalSum = items.reduce((s, x) => s + x.value, 0) || 1;
    const top3 = items
        .slice()
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
        .map((x) => `${x.name} ${((x.value / totalSum) * 100).toFixed(1)}%`)
        .join(", ");
    return `${type === "income" ? "income" : "expense"} concentrated in: ${top3}`;
};

const describeTopBill = (
    bill: Bill,
    kind: "expense" | "income",
    fmt: (n: number) => string,
): string => {
    const when = new Date(bill.time).toISOString().slice(0, 10);
    const note = bill.comment ? ` "${bill.comment}"` : "";
    return `largest ${kind}: ${fmt(amountToNumber(bill.amount))} on ${when}${note}`;
};

const renderText = (
    result: any,
    fmt: (n: number) => string,
) => {
    const w = (s: string) => process.stdout.write(`${s}\n`);
    const r = result;
    w("");
    w(
        `# range  ${r.range.fromIso} → ${r.range.toIso}  (${r.range.unit ?? "custom"}, focus=${r.range.focusType}, ${r.range.count} bills)`,
    );
    w(`  ${r.descriptions.total}`);

    w("");
    w(`# total`);
    w(
        `  income=${fmt(r.total.income)}  expense=${fmt(r.total.expense)}  balance=${fmt(r.total.balance)}`,
    );

    w("");
    w(`# expense structure`);
    if (r.structure.expense.length === 0) w("  (none)");
    else {
        for (const it of r.structure.expense) {
            w(`  ${it.name.padEnd(18)} ${fmt(it.value)}`);
        }
    }
    w(`  ${r.descriptions.structure}`);

    w("");
    w(`# income structure`);
    if (r.structure.income.length === 0) w("  (none)");
    else {
        for (const it of r.structure.income) {
            w(`  ${it.name.padEnd(18)} ${fmt(it.value)}`);
        }
    }

    if (r.structure.tag.length > 0) {
        w("");
        w(`# tags`);
        for (const it of r.structure.tag) {
            w(
                `  ${it.name.padEnd(18)} expense=${fmt(it.expense)} income=${fmt(it.income)}`,
            );
        }
    }

    w("");
    w(`# analysis (${r.range.focusType})`);
    const a = r.analysis;
    w(
        `  current  total=${fmt(a.current.total)} dayAvg=${fmt(a.current.dayAvg)} weekAvg=${fmt(a.current.weekAvg)} monthAvg=${fmt(a.current.monthAvg)}`,
    );
    w(
        `  projected total=${fmt(a.projected.total)} dayAvg=${fmt(a.projected.dayAvg)}`,
    );
    w(
        `  previous total=${fmt(a.previous.total)}  lastYear total=${fmt(a.lastYear.total)}`,
    );
    w(
        `  growthVsPrevious=${(a.growthVsPrevious * 100).toFixed(2)}%  growthVsLastYear=${(a.growthVsLastYear * 100).toFixed(2)}%`,
    );
    if (r.descriptions.summary) w(`  ${r.descriptions.summary}`);
    if (r.descriptions.comparison) w(`  ${r.descriptions.comparison}`);

    if (r.descriptions.topExpense || r.descriptions.topIncome) {
        w("");
        w(`# extremes`);
        if (r.descriptions.topExpense) w(`  ${r.descriptions.topExpense}`);
        if (r.descriptions.topIncome) w(`  ${r.descriptions.topIncome}`);
    }
};

const syncOnce = (endpoint: {
    onSync: (cb: (p: Promise<void>) => void) => () => void;
    toSync: () => Promise<any>;
}) =>
    new Promise<void>((resolve, reject) => {
        const unsub = endpoint.onSync((running) => {
            running.then(
                () => {
                    unsub();
                    resolve();
                },
                (err) => {
                    unsub();
                    reject(err);
                },
            );
        });
        endpoint.toSync().catch(reject);
    });
