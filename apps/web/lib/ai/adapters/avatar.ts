import "server-only";
import type { Cred, AvatarParams, AvatarResult } from "../capabilities";
import { fetchWithTimeout } from "../../http-util";

/**
 * Avatar / talking-head: genera un video de una persona diciendo un texto.
 * HeyGen y D-ID son async (crear → poll). Replicate/fal como fallback.
 *
 * Todos los fetch tienen timeout y los loops de polling un deadline de pared
 * (10 min) además del máximo de intentos, para no colgarse contra un provider.
 */
const GEN_TIMEOUT_MS = 120_000;
const POLL_TIMEOUT_MS = 15_000;
const POLL_DEADLINE_MS = 10 * 60_000;

export async function generateAvatarWith(providerId: string, family: string, p: AvatarParams, cred: Cred): Promise<AvatarResult> {
  if (providerId === "heygen") return heygen(p, cred);
  if (providerId === "did") return did(p, cred);
  if (providerId === "replicate" || family === "replicate") return replicateAvatar(p, cred);
  throw new Error(`Avatar con ${providerId} todavía no está implementado. Probá HeyGen, D-ID o vía Replicate.`);
}

async function poll<T>(fn: () => Promise<{ done: boolean; failed?: string; value?: T }>, tries = 120, ms = 2500): Promise<T> {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  for (let i = 0; i < tries; i++) {
    if (Date.now() > deadline) throw new Error("El avatar tardó demasiado en generarse (timeout).");
    const s = await fn();
    if (s.failed) throw new Error(s.failed);
    if (s.done && s.value !== undefined) return s.value;
    await new Promise((r) => setTimeout(r, ms));
  }
  throw new Error("El avatar tardó demasiado en generarse.");
}

async function heygen(p: AvatarParams, cred: Cred): Promise<AvatarResult> {
  if (!p.avatarId) throw new Error("HeyGen necesita un 'avatar id'. Cargalo en el paso.");
  const r = await fetchWithTimeout("https://api.heygen.com/v2/video/generate", {
    method: "POST",
    headers: { "x-api-key": cred.apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: p.avatarId },
          voice: { type: "text", input_text: p.text, ...(p.voiceId ? { voice_id: p.voiceId } : {}) },
        },
      ],
    }),
  }, GEN_TIMEOUT_MS);
  if (!r.ok) throw new Error(`HeyGen ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const videoId = j.data?.video_id;
  if (!videoId) throw new Error("HeyGen: respuesta inesperada.");
  const url = await poll<string>(async () => {
    const pr = await fetchWithTimeout(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, { headers: { "x-api-key": cred.apiKey } }, POLL_TIMEOUT_MS);
    const pj = await pr.json();
    const st = pj.data?.status;
    if (st === "completed") return { done: true, value: pj.data?.video_url as string };
    if (st === "failed") return { done: false, failed: `HeyGen: ${pj.data?.error?.message ?? "falló"}` };
    return { done: false };
  });
  return { url, model: p.model };
}

async function did(p: AvatarParams, cred: Cred): Promise<AvatarResult> {
  if (!p.imageUrl) throw new Error("D-ID necesita la URL de una imagen de la persona.");
  const auth = `Basic ${Buffer.from(cred.apiKey).toString("base64")}`;
  const r = await fetchWithTimeout("https://api.d-id.com/talks", {
    method: "POST",
    headers: { Authorization: auth, "content-type": "application/json" },
    body: JSON.stringify({ source_url: p.imageUrl, script: { type: "text", input: p.text } }),
  }, GEN_TIMEOUT_MS);
  if (!r.ok) throw new Error(`D-ID ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const id = j.id;
  const url = await poll<string>(async () => {
    const pr = await fetchWithTimeout(`https://api.d-id.com/talks/${id}`, { headers: { Authorization: auth } }, POLL_TIMEOUT_MS);
    const pj = await pr.json();
    if (pj.status === "done") return { done: true, value: pj.result_url as string };
    if (pj.status === "error" || pj.status === "rejected") return { done: false, failed: `D-ID: ${pj.error?.description ?? pj.status}` };
    return { done: false };
  });
  return { url, model: p.model };
}

async function replicateAvatar(p: AvatarParams, cred: Cred): Promise<AvatarResult> {
  const r = await fetchWithTimeout(`https://api.replicate.com/v1/models/${p.model}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.apiKey}`, "content-type": "application/json", Prefer: "wait" },
    body: JSON.stringify({ input: { text: p.text, ...(p.imageUrl ? { image: p.imageUrl } : {}) } }),
  }, GEN_TIMEOUT_MS);
  if (!r.ok) throw new Error(`Replicate ${r.status}: ${await r.text()}`);
  let pred = await r.json();
  const deadline = Date.now() + POLL_DEADLINE_MS;
  for (let i = 0; i < 200 && (pred.status === "starting" || pred.status === "processing"); i++) {
    if (Date.now() > deadline) throw new Error("Replicate: el avatar tardó demasiado (timeout).");
    await new Promise((res) => setTimeout(res, 2500));
    const pr = await fetchWithTimeout(pred.urls?.get ?? `https://api.replicate.com/v1/predictions/${pred.id}`, { headers: { Authorization: `Bearer ${cred.apiKey}` } }, POLL_TIMEOUT_MS);
    pred = await pr.json();
  }
  if (pred.status !== "succeeded") throw new Error(`Replicate: ${pred.error ?? pred.status}`);
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  return { url: typeof out === "string" ? out : "", model: p.model };
}
