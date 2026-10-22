import "server-only";
import { db, logEvent } from "./db";
import { resolveRange } from "./dates";
import { fmtMoney, fmtNum, round2 } from "./money";
import { setDailyBudget, setObjectStatus, type Level } from "./meta";
import { getContext, type Context } from "./report";
import { buildAdRows, metric, METRIC_LABEL, type AdRow, type MetricKey } from "./ads";
import { pushAll } from "./push";

// =====================================================================
// Regras automáticas: "se CPA > 80 hoje, pausar", "se ROAS > 2, +20% de orçamento"...
// Rodam pelo cron (/api/cron/rules) ou pelo botão na tela de Regras.
// =====================================================================

export type Op = "gt" | "gte" | "lt" | "lte";
export interface Condition { metric: MetricKey; op: Op; value: number }

export type RuleAction = "pause" | "activate" | "budget_up" | "budget_down" | "budget_set";

export interface Rule {
  id: string;
  name: string;
  active: boolean;
  level: Level;
  account_id: string | null;
  name_contains: string | null;
  period: string;
  conditions: Condition[];
  action: RuleAction;
  action_value: number | null;
  only_active: boolean;
  cooldown_hours: number;
  notify: boolean;
  applied: Record<string, string>;
  last_run_at: string | null;
  last_result: string | null;
  created_at: string;
}

export const OP_LABEL: Record<Op, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤" };
export const ACTION_LABEL: Record<RuleAction, string> = {
  pause: "Pausar",
  activate: "Ativar",
  budget_up: "Aumentar orçamento (%)",
  budget_down: "Diminuir orçamento (%)",
  budget_set: "Definir orçamento diário",
};
export const PERIOD_LABEL: Record<string, string> = {
  today: "Hoje", yesterday: "Ontem", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias", month: "Este mês",
};
export const LEVEL_LABEL: Record<Level, string> = { campaign: "Campanhas", adset: "Conjuntos", ad: "Anúncios" };

export async function listRules(): Promise<Rule[]> {
  const { data, error } = await db().from("automation_rules").select("*").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ ...r, action_value: r.action_value === null ? null : Number(r.action_value) })) as Rule[];
}

export function describeRule(r: Pick<Rule, "conditions" | "action" | "action_value" | "level" | "period">, cur = "BRL"): string {
  const cond = r.conditions
    .map((c) => `${METRIC_LABEL[c.metric] ?? c.metric} ${OP_LABEL[c.op]} ${fmtNum(c.value, 2)}`)
    .join(" e ");
  const act =
    r.action === "budget_up" ? `aumentar orçamento em ${fmtNum(r.action_value ?? 0)}%`
    : r.action === "budget_down" ? `diminuir orçamento em ${fmtNum(r.action_value ?? 0)}%`
    : r.action === "budget_set" ? `orçamento diário = ${fmtMoney(r.action_value ?? 0, cur)}`
    : r.action === "pause" ? "pausar" : "ativar";
  return `${LEVEL_LABEL[r.level]} · ${PERIOD_LABEL[r.period] ?? r.period}: se ${cond || "(sem condição)"} → ${act}`;
}

function check(row: AdRow, c: Condition): boolean {
  const v = metric(row, c.metric);
  if (v === null) return false;
  switch (c.op) {
    case "gt": return v > c.value;
    case "gte": return v >= c.value;
    case "lt": return v < c.value;
    case "lte": return v <= c.value;
  }
}

export interface RuleOutcome {
  rule: string;
  matched: { id: string; name: string; did: string; error?: string }[];
  message: string;
}

/** Roda as regras ativas (ou uma específica). dryRun = só mostra o que faria. */
export async function runRules(opts: { ruleId?: string; dryRun?: boolean } = {}): Promise<RuleOutcome[]> {
  let rules = await listRules();
  rules = opts.ruleId ? rules.filter((r) => r.id === opts.ruleId) : rules.filter((r) => r.active);
  if (!rules.length) return [];
  const ctx = await getContext();
  const cache = new Map<string, Promise<AdRow[]>>();
  const out: RuleOutcome[] = [];
  for (const rule of rules) out.push(await runOne(rule, ctx, cache, !!opts.dryRun));
  return out;
}

async function runOne(rule: Rule, ctx: Context, cache: Map<string, Promise<AdRow[]>>, dryRun: boolean): Promise<RuleOutcome> {
  const accounts = rule.account_id ? ctx.accounts.filter((a) => a.id === rule.account_id) : ctx.accounts;
  const res: RuleOutcome = { rule: rule.name, matched: [], message: "" };
  if (!accounts.length) {
    res.message = "Nenhuma conta de anúncio ativa para esta regra.";
    if (!dryRun) await saveRun(rule, res.message, rule.applied);
    return res;
  }

  const key = `${rule.level}|${rule.period}|${rule.account_id ?? "*"}`;
  if (!cache.has(key)) {
    const range = resolveRange({ range: rule.period }, ctx.tz);
    cache.set(key, buildAdRows(ctx, accounts, rule.level, range).then((r) => {
      if (r.errors.length) void logEvent("regra", "meta", false, r.errors.join(" · "));
      return r.rows;
    }));
  }
  const rows = await cache.get(key)!;

  const needle = rule.name_contains?.toLowerCase();
  const now = Date.now();
  const applied = { ...(rule.applied ?? {}) };
  const authOf = new Map(accounts.map((a) => [a.id, a.auth]));

  const candidates = rows.filter((r) => {
    if (!r.status) return false;
    if (needle && !r.name.toLowerCase().includes(needle)) return false;
    if (rule.action === "activate" ? r.status === "ACTIVE" : rule.only_active && r.effective !== "ACTIVE") return false;
    if (rule.action.startsWith("budget") && !r.hasBudget) return false;
    const last = applied[r.id];
    if (last && now - new Date(last).getTime() < rule.cooldown_hours * 3600000) return false;
    return rule.conditions.length > 0 && rule.conditions.every((c) => check(r, c));
  });

  for (const r of candidates) {
    let did = "";
    let nextBudget: number | null = null;
    if (rule.action === "pause") did = "pausado";
    else if (rule.action === "activate") did = "ativado";
    else {
      const curB = r.dailyBudget ?? 0;
      const v = rule.action_value ?? 0;
      nextBudget = round2(rule.action === "budget_up" ? curB * (1 + v / 100) : rule.action === "budget_down" ? curB * (1 - v / 100) : v);
      if (!(nextBudget > 0)) continue;
      did = `orçamento ${fmtNum(curB, 2)} → ${fmtNum(nextBudget, 2)} ${r.accountCurrency}`;
    }
    const item: RuleOutcome["matched"][number] = { id: r.id, name: r.name, did };
    if (!dryRun) {
      try {
        const auth = authOf.get(r.accountId)!;
        if (rule.action === "pause") await setObjectStatus(auth, r.id, "PAUSED");
        else if (rule.action === "activate") await setObjectStatus(auth, r.id, "ACTIVE");
        else await setDailyBudget(auth, r.id, nextBudget!);
        applied[r.id] = new Date().toISOString();
      } catch (e: any) {
        item.error = e?.message ?? "erro";
      }
    }
    res.matched.push(item);
  }

  const ok = res.matched.filter((m) => !m.error);
  res.message = res.matched.length
    ? `${dryRun ? "Faria" : "Aplicou"} em ${ok.length}: ${ok.map((m) => `${m.name} (${m.did})`).join("; ")}` +
      (res.matched.length > ok.length ? ` · ${res.matched.length - ok.length} com erro: ${res.matched.filter((m) => m.error).map((m) => `${m.name}: ${m.error}`).join("; ")}` : "")
    : "Nenhum item atendeu às condições.";

  if (!dryRun) {
    // Limpa marcas antigas para o JSON não crescer para sempre
    for (const [id, iso] of Object.entries(applied)) if (now - new Date(iso).getTime() > 30 * 86400000) delete applied[id];
    await saveRun(rule, res.message, applied);
    if (ok.length) {
      await logEvent("regra", rule.action, res.matched.length === ok.length, `${rule.name}: ${res.message}`.slice(0, 900));
      if (rule.notify) {
        await pushAll({
          title: `Regra: ${rule.name}`,
          body: ok.length === 1 ? `${ok[0].name} — ${ok[0].did}` : `${ok.length} itens: ${ok.map((m) => m.name).join(", ")}`.slice(0, 180),
          url: "/regras",
          tag: `rule-${rule.id}`,
        }).catch(() => undefined);
      }
    }
  }
  return res;
}

async function saveRun(rule: Rule, message: string, applied: Record<string, string>) {
  await db()
    .from("automation_rules")
    .update({ last_run_at: new Date().toISOString(), last_result: message.slice(0, 1000), applied })
    .eq("id", rule.id);
}
