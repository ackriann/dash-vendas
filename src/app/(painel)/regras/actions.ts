"use server";
import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { db, setSetting } from "@/lib/db";
import { parseMoneyInput } from "@/lib/money";
import { METRICS } from "@/lib/ads";
import { ACTION_LABEL, PERIOD_LABEL, runRules, type Condition, type Op } from "@/lib/rules";

function go(key: "ok" | "erro", msg: string, formData?: FormData): never {
  const back = formData?.get("surface") === "campanhas" ? "/campanhas?painel=regras&" : "/regras?";
  redirect(`${back}${key}=${encodeURIComponent(msg)}`);
}

const OPS: Op[] = ["gt", "gte", "lt", "lte"];

export async function createRule(formData: FormData) {
  const goRule = (key: "ok" | "erro", msg: string): never => go(key, msg, formData);
  await requireAuth();
  const f = (k: string) => String(formData.get(k) ?? "").trim();
  const conditions: Condition[] = [];
  for (let i = 0; i < 3; i++) {
    const metric = f(`metric${i}`);
    const op = f(`op${i}`) as Op;
    const raw = f(`value${i}`);
    if (!metric || raw === "") continue;
    if (!METRICS.some((m) => m.key === metric) || !OPS.includes(op)) goRule("erro", "Condição inválida.");
    conditions.push({ metric: metric as Condition["metric"], op, value: parseMoneyInput(raw) });
  }
  const action = f("action");
  const level = f("level");
  const period = f("period");
  if (!f("name")) goRule("erro", "Dê um nome à regra.");
  if (!conditions.length) goRule("erro", "Adicione pelo menos uma condição.");
  if (!(action in ACTION_LABEL) || !["campaign", "adset", "ad"].includes(level) || !(period in PERIOD_LABEL)) goRule("erro", "Preencha nível, período e ação.");
  const actionValue = action.startsWith("budget") ? parseMoneyInput(formData.get("action_value")) : null;
  if (actionValue !== null && !(actionValue > 0)) goRule("erro", "Informe o valor da mudança de orçamento.");

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
  if (error) goRule("erro", error.message);
  goRule("ok", "Regra criada. Use “Simular” para ver o que ela faria agora.");
}

export async function toggleRule(formData: FormData) {
  const goRule = (key: "ok" | "erro", msg: string): never => go(key, msg, formData);
  await requireAuth();
  await db().from("automation_rules").update({ active: String(formData.get("active")) === "true" }).eq("id", String(formData.get("id")));
  goRule("ok", String(formData.get("active")) === "true" ? "Regra ligada." : "Regra desligada.");
}

export async function deleteRule(formData: FormData) {
  const goRule = (key: "ok" | "erro", msg: string): never => go(key, msg, formData);
  await requireAuth();
  await db().from("automation_rules").delete().eq("id", String(formData.get("id")));
  goRule("ok", "Regra removida.");
}

export async function runRuleNow(formData: FormData) {
  const goRule = (key: "ok" | "erro", msg: string): never => go(key, msg, formData);
  await requireAuth();
  const dryRun = String(formData.get("dry")) === "1";
  let msg = "";
  try {
    const [r] = await runRules({ ruleId: String(formData.get("id")), dryRun });
    msg = r ? `${dryRun ? "Simulação" : "Executada"} — ${r.message}` : "Regra não encontrada.";
  } catch (e: any) {
    goRule("erro", e?.message ?? "Erro ao rodar a regra.");
  }
  goRule("ok", msg);
}

export async function newCronKey(formData: FormData) {
  const goRule = (key: "ok" | "erro", msg: string): never => go(key, msg, formData);
  await requireAuth();
  await setSetting("cron_key", randomBytes(24).toString("hex"));
  goRule("ok", "Chave do agendador gerada. Atualize a URL no serviço de cron.");
}
