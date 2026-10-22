"use server";
import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { db, setSetting } from "@/lib/db";
import { parseMoneyInput } from "@/lib/money";
import { METRICS } from "@/lib/ads";
import { ACTION_LABEL, PERIOD_LABEL, runRules, type Condition, type Op } from "@/lib/rules";

function go(key: "ok" | "erro", msg: string): never {
  redirect(`/regras?${key}=${encodeURIComponent(msg)}`);
}

const OPS: Op[] = ["gt", "gte", "lt", "lte"];

export async function createRule(formData: FormData) {
  await requireAuth();
  const f = (k: string) => String(formData.get(k) ?? "").trim();
  const conditions: Condition[] = [];
  for (let i = 0; i < 3; i++) {
    const metric = f(`metric${i}`);
    const op = f(`op${i}`) as Op;
    const raw = f(`value${i}`);
    if (!metric || raw === "") continue;
    if (!METRICS.some((m) => m.key === metric) || !OPS.includes(op)) go("erro", "Condição inválida.");
    conditions.push({ metric: metric as Condition["metric"], op, value: parseMoneyInput(raw) });
  }
  const action = f("action");
  const level = f("level");
  const period = f("period");
  if (!f("name")) go("erro", "Dê um nome à regra.");
  if (!conditions.length) go("erro", "Adicione pelo menos uma condição.");
  if (!(action in ACTION_LABEL) || !["campaign", "adset", "ad"].includes(level) || !(period in PERIOD_LABEL)) go("erro", "Preencha nível, período e ação.");
  const actionValue = action.startsWith("budget") ? parseMoneyInput(formData.get("action_value")) : null;
  if (actionValue !== null && !(actionValue > 0)) go("erro", "Informe o valor da mudança de orçamento.");

  const { error } = await db().from("automation_rules").insert({
    name: f("name"),
    level,
    period,
    account_id: f("account_id") || null,
    name_contains: f("name_contains") || null,
    conditions,
    action,
    action_value: actionValue,
    only_active: formData.get("only_active") === "on",
    cooldown_hours: Math.max(1, Math.round(Number(f("cooldown_hours")) || 24)),
    notify: formData.get("notify") === "on",
  });
  if (error) go("erro", error.message);
  go("ok", "Regra criada. Use “Simular” para ver o que ela faria agora.");
}

export async function toggleRule(formData: FormData) {
  await requireAuth();
  await db().from("automation_rules").update({ active: String(formData.get("active")) === "true" }).eq("id", String(formData.get("id")));
  go("ok", String(formData.get("active")) === "true" ? "Regra ligada." : "Regra desligada.");
}

export async function deleteRule(formData: FormData) {
  await requireAuth();
  await db().from("automation_rules").delete().eq("id", String(formData.get("id")));
  go("ok", "Regra removida.");
}

export async function runRuleNow(formData: FormData) {
  await requireAuth();
  const dryRun = String(formData.get("dry")) === "1";
  let msg = "";
  try {
    const [r] = await runRules({ ruleId: String(formData.get("id")), dryRun });
    msg = r ? `${dryRun ? "Simulação" : "Executada"} — ${r.message}` : "Regra não encontrada.";
  } catch (e: any) {
    go("erro", e?.message ?? "Erro ao rodar a regra.");
  }
  go("ok", msg);
}

export async function newCronKey() {
  await requireAuth();
  await setSetting("cron_key", randomBytes(24).toString("hex"));
  go("ok", "Chave do agendador gerada. Atualize a URL no serviço de cron.");
}
