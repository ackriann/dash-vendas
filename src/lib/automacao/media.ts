import "server-only";
import { db, rawDb, currentWorkspaceId } from "../db";
import { MetaError, type MetaAuth } from "../meta";
import { uploadImageBytes, uploadVideoFromUrl, videoStatus } from "./meta-ads";
import { coverBase } from "./types";

// =====================================================================
// Biblioteca de mídias: arquivo no Supabase Storage (bucket público "automacao")
// e, por conta de anúncio, o hash da imagem / id do vídeo na Meta (reaproveitado).
// =====================================================================

export const BUCKET = "automacao";
export const MAX_IMAGE_MB = 30;
export const MAX_VIDEO_MB = 500;

export interface MediaAsset {
  id: string;
  kind: "image" | "video";
  name: string;
  storage_path: string;
  public_url: string;
  mime: string | null;
  size_bytes: number | null;
  status: "uploading" | "ready";
  meta_ids: Record<string, { hash?: string; url?: string; video_id?: string; thumbnail_url?: string }>;
  created_at: string;
}

let bucketChecked = false;

async function ensureBucket() {
  if (bucketChecked) return;
  const s = rawDb().storage;
  const { data } = await s.getBucket(BUCKET);
  if (!data) {
    const { error } = await s.createBucket(BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message)) throw new Error(`Não deu para criar o bucket de mídias: ${error.message}`);
  }
  bucketChecked = true;
}

/** Cria o registro e devolve a URL assinada para o navegador enviar o arquivo direto ao Storage. */
export async function startUpload(name: string, mime: string, size: number) {
  const kind = mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : null;
  if (!kind) throw new Error("Envie uma imagem (JPG/PNG) ou um vídeo (MP4/MOV).");
  if (kind === "image" && !/^image\/(jpeg|png|gif|webp)$/.test(mime)) throw new Error("Imagem precisa ser JPG, PNG, GIF ou WEBP.");
  const limit = (kind === "image" ? MAX_IMAGE_MB : MAX_VIDEO_MB) * 1024 * 1024;
  if (size > limit) throw new Error(`Arquivo grande demais (máx. ${kind === "image" ? MAX_IMAGE_MB : MAX_VIDEO_MB} MB).`);

  await ensureBucket();
  const ws = await currentWorkspaceId();
  const safe = name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80) || "arquivo";
  const path = `${ws}/${crypto.randomUUID()}-${safe}`;
  const { data: signed, error } = await rawDb().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !signed) throw new Error(error?.message ?? "Falha ao preparar o envio.");
  const publicUrl = rawDb().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  const { data: row, error: e2 } = await db()
    .from("media_assets")
    .insert({ kind, name: name.slice(0, 200), storage_path: path, public_url: publicUrl, mime, size_bytes: size, status: "uploading" })
    .select("*")
    .single();
  if (e2) throw new Error(e2.message);
  return { asset: row as MediaAsset, uploadUrl: signed.signedUrl };
}

export async function confirmUpload(id: string): Promise<MediaAsset> {
  const asset = await getMedia(id);
  if (!asset) throw new Error("Mídia não encontrada.");
  // Confere se o arquivo chegou mesmo no Storage
  const folder = asset.storage_path.slice(0, asset.storage_path.lastIndexOf("/"));
  const file = asset.storage_path.slice(folder.length + 1);
  const { data } = await rawDb().storage.from(BUCKET).list(folder, { search: file, limit: 1 });
  if (!data?.length) throw new Error("O arquivo não chegou ao armazenamento. Envie de novo.");
  const { data: row, error } = await db().from("media_assets").update({ status: "ready" }).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return row as MediaAsset;
}

export async function listMedia(onlyReady = true): Promise<MediaAsset[]> {
  let q = db().from("media_assets").select("*").order("created_at", { ascending: false }).limit(300);
  if (onlyReady) q = q.eq("status", "ready");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as MediaAsset[];
}

export async function getMedia(id: string): Promise<MediaAsset | null> {
  const { data } = await db().from("media_assets").select("*").eq("id", id).maybeSingle();
  return (data as MediaAsset) ?? null;
}

export async function getMediaMany(ids: string[]): Promise<MediaAsset[]> {
  if (!ids.length) return [];
  const { data } = await db().from("media_assets").select("*").in("id", ids);
  const list = (data ?? []) as MediaAsset[];
  return ids.map((id) => list.find((m) => m.id === id)).filter(Boolean) as MediaAsset[];
}

export async function deleteMedia(id: string) {
  const asset = await getMedia(id);
  if (!asset) return;
  await rawDb().storage.from(BUCKET).remove([asset.storage_path]);
  await db().from("media_assets").delete().eq("id", id);
}

async function saveMetaId(asset: MediaAsset, act: string, value: MediaAsset["meta_ids"][string]) {
  const fresh = (await getMedia(asset.id)) ?? asset;
  const meta_ids = { ...fresh.meta_ids, [act]: { ...(fresh.meta_ids[act] ?? {}), ...value } };
  await db().from("media_assets").update({ meta_ids }).eq("id", asset.id);
  asset.meta_ids = meta_ids;
}

export type EnsureResult =
  | { state: "ready"; hash?: string; video_id?: string; thumbnail_url?: string }
  | { state: "processing"; video_id: string; progress?: number };

/**
 * Garante a mídia na conta de anúncio. Imagem: envia os bytes e guarda o hash.
 * Vídeo: manda a URL pública para a Meta baixar e acompanha o processamento.
 * Já enviada antes para a mesma conta = reaproveita (sem novo upload).
 */
export async function ensureOnAccount(auth: MetaAuth, act: string, asset: MediaAsset): Promise<EnsureResult> {
  const known = asset.meta_ids[act] ?? {};
  if (asset.kind === "image") {
    if (known.hash) return { state: "ready", hash: known.hash };
    const res = await fetch(asset.public_url, { cache: "no-store" });
    if (!res.ok) throw new MetaError(`Não deu para ler a imagem no armazenamento (HTTP ${res.status}).`);
    const bytes = Buffer.from(await res.arrayBuffer()).toString("base64");
    const img = await uploadImageBytes(auth, act, bytes, asset.name);
    await saveMetaId(asset, act, { hash: img.hash, url: img.url });
    return { state: "ready", hash: img.hash };
  }

  let videoId = known.video_id;
  if (!videoId) {
    videoId = (await uploadVideoFromUrl(auth, act, asset.public_url, asset.name)).id;
    await saveMetaId(asset, act, { video_id: videoId });
  }
  if (known.thumbnail_url) return { state: "ready", video_id: videoId, thumbnail_url: known.thumbnail_url };
  const st = await videoStatus(auth, videoId);
  const vs = st.status?.video_status;
  if (vs === "error") throw new MetaError("A Meta não conseguiu processar o vídeo. Confira o formato (MP4/MOV) e envie de novo.");
  if (vs === "ready" && st.picture) {
    await saveMetaId(asset, act, { thumbnail_url: st.picture });
    return { state: "ready", video_id: videoId, thumbnail_url: st.picture };
  }
  return { state: "processing", video_id: videoId, progress: st.status?.processing_progress };
}


/**
 * Capa de cada vídeo: a escolhida no rascunho, senão uma imagem da biblioteca
 * com o mesmo nome do vídeo (a capa gerada do frame é salva assim e reaproveitada).
 */
export async function resolveCovers(videos: MediaAsset[], chosen: Record<string, string>): Promise<Record<string, MediaAsset>> {
  if (!videos.length) return {};
  const explicit = await getMediaMany(videos.map((v) => chosen[v.id]).filter(Boolean));
  const { data } = await db().from("media_assets").select("*").eq("kind", "image").eq("status", "ready").order("created_at", { ascending: false }).limit(500);
  const images = (data ?? []) as MediaAsset[];
  const out: Record<string, MediaAsset> = {};
  for (const v of videos) {
    const pick = explicit.find((m) => m.id === chosen[v.id] && m.kind === "image") ?? images.find((m) => coverBase(m.name) === coverBase(v.name));
    if (pick) out[v.id] = pick;
  }
  return out;
}
