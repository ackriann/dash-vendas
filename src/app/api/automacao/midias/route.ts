import { confirmUpload, startUpload } from "@/lib/automacao/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prepara o envio: o navegador manda o arquivo direto ao Storage pela URL assinada. */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const r = await startUpload(String(b.name ?? ""), String(b.mime ?? ""), Number(b.size ?? 0));
    return Response.json(r);
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Falha ao preparar o envio." }, { status: 400 });
  }
}

/** Confirma que o arquivo chegou e libera a mídia para uso. */
export async function PUT(req: Request) {
  try {
    const b = await req.json();
    return Response.json({ asset: await confirmUpload(String(b.id ?? "")) });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Falha ao confirmar o envio." }, { status: 400 });
  }
}
