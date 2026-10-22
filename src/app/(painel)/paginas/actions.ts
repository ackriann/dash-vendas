"use server";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import {
  createPage, deleteObject, hideComment, publishPost, replyComment, setPageCover, setPagePicture, updatePage,
} from "@/lib/meta";
import { pageAuth, profileAuth } from "@/lib/profiles";
import { env } from "@/lib/env";
import { startOfDayUtc } from "@/lib/dates";

function go(path: string, key: "ok" | "erro", msg: string): never {
  const u = new URL(path.startsWith("/") ? path : "/paginas", "http://x");
  u.searchParams.delete("ok");
  u.searchParams.delete("erro");
  u.searchParams.set(key, msg);
  redirect(`${u.pathname}?${u.searchParams}`);
}

async function run(back: string, ok: string, fn: () => Promise<unknown>): Promise<never> {
  try {
    await fn();
  } catch (e: any) {
    go(back, "erro", e?.message ?? "Erro na API da Meta");
  }
  go(back, "ok", ok);
}

export async function createPageAction(formData: FormData) {
  await requireAuth();
  const name = String(formData.get("name") ?? "").trim();
  const category_enum = String(formData.get("category") ?? "BRAND");
  const about = String(formData.get("about") ?? "").trim() || undefined;
  if (!name) go("/paginas", "erro", "Dê um nome para a página.");
  let id = "";
  try {
    id = (await createPage(await profileAuth(String(formData.get("profile") ?? "")), { name, category_enum, about })).id;
  } catch (e: any) {
    redirect(`/paginas?criar=manual&erro=${encodeURIComponent(`A Meta não liberou a criação pela API: ${e?.message ?? "sem permissão"}`)}`);
  }
  go(`/paginas/${id}`, "ok", "Página criada.");
}

export async function updatePageInfo(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("page"));
  const fields: Record<string, string> = {};
  for (const k of ["about", "description", "website", "phone"]) {
    const v = formData.get(k);
    if (v !== null) fields[k] = String(v).trim();
  }
  await run(`/paginas/${id}`, "Informações salvas.", async () => updatePage(await pageAuth(id), id, fields));
}

export async function updatePageImages(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("page"));
  const picture = String(formData.get("picture") ?? "").trim();
  const cover = String(formData.get("cover") ?? "").trim();
  if (!picture && !cover) go(`/paginas/${id}`, "erro", "Informe o link de uma imagem.");
  await run(`/paginas/${id}`, "Imagem atualizada. Pode levar alguns minutos para aparecer.", async () => {
    const auth = await pageAuth(id);
    if (picture) await setPagePicture(auth, id, picture);
    if (cover) await setPageCover(auth, id, cover);
  });
}

export async function publishPostAction(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("page"));
  const message = String(formData.get("message") ?? "").trim() || undefined;
  const link = String(formData.get("link") ?? "").trim() || undefined;
  const imageUrl = String(formData.get("image") ?? "").trim() || undefined;
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "") || "09:00";
  if (!message && !link && !imageUrl) go(`/paginas/${id}`, "erro", "Escreva um texto ou informe um link/imagem.");

  let scheduleAt: number | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [h, m] = time.split(":").map(Number);
    scheduleAt = Math.floor((startOfDayUtc(date, env.timezone).getTime() + ((h || 0) * 60 + (m || 0)) * 60000) / 1000);
    const diff = scheduleAt - Date.now() / 1000;
    if (diff < 600 || diff > 30 * 86400) go(`/paginas/${id}`, "erro", "O agendamento precisa ser entre 10 minutos e 30 dias a partir de agora.");
  }
  await run(`/paginas/${id}${scheduleAt ? "?tab=agendados" : ""}`, scheduleAt ? "Post agendado." : "Post publicado.", async () =>
    publishPost(await pageAuth(id), id, { message, link, imageUrl, scheduleAt }),
  );
}

export async function deletePostAction(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("page"));
  const back = String(formData.get("back") ?? `/paginas/${id}`);
  await run(back, "Post excluído.", async () => deleteObject(await pageAuth(id), String(formData.get("post"))));
}

export async function hideCommentAction(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("page"));
  const hidden = String(formData.get("hidden")) === "true";
  const back = String(formData.get("back"));
  await run(back, hidden ? "Comentário ocultado." : "Comentário visível de novo.", async () => hideComment(await pageAuth(id), String(formData.get("comment")), hidden));
}

export async function deleteCommentAction(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("page"));
  const back = String(formData.get("back"));
  await run(back, "Comentário excluído.", async () => deleteObject(await pageAuth(id), String(formData.get("comment"))));
}

export async function replyCommentAction(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("page"));
  const back = String(formData.get("back"));
  const message = String(formData.get("message") ?? "").trim();
  if (!message) go(back, "erro", "Escreva a resposta.");
  await run(back, "Resposta publicada.", async () => replyComment(await pageAuth(id), String(formData.get("comment")), message));
}
