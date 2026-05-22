import "server-only";
import type { Cred, OcrParams, OcrResult } from "../capabilities";

/**
 * OCR / parseo de documentos. Mistral OCR devuelve markdown por página a partir
 * de una URL de documento (PDF/imagen).
 */
export async function ocrWith(providerId: string, p: OcrParams, cred: Cred): Promise<OcrResult> {
  if (providerId === "mistral") return mistralOcr(p, cred);
  throw new Error(`OCR con ${providerId} todavía no está implementado.`);
}

async function mistralOcr(p: OcrParams, cred: Cred): Promise<OcrResult> {
  const r = await fetch("https://api.mistral.ai/v1/ocr", {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: p.model, document: { type: "document_url", document_url: p.documentUrl } }),
  });
  if (!r.ok) throw new Error(`Mistral OCR ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const text = (j.pages ?? []).map((pg: { markdown?: string }) => pg.markdown ?? "").join("\n\n");
  return { text, model: p.model };
}
