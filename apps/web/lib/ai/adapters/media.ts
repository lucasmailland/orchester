import "server-only";
import type { Cred, VideoParams, VideoResult, TtsParams, SttParams, TranscriptResult, MusicParams, MusicResult } from "../capabilities";

/**
 * Adaptadores de video, voz (TTS) y transcripción (STT). Video se hace por los
 * agregadores (Replicate/fal) con polling; TTS/STT por los directos comunes.
 */

// ── Video (Replicate / fal por polling) ──────────────────────────────────────
export async function generateVideoWith(providerId: string, family: string, p: VideoParams, cred: Cred): Promise<VideoResult> {
  if (providerId === "replicate" || family === "replicate") return replicateVideo(p, cred);
  if (providerId === "fal" || family === "fal") return falVideo(p, cred);
  throw new Error(
    `La generación de video con ${providerId} todavía no está implementada. Probá el mismo modelo vía Replicate o fal.`
  );
}

async function replicateVideo(p: VideoParams, cred: Cred): Promise<VideoResult> {
  const r = await fetch(`https://api.replicate.com/v1/models/${p.model}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.apiKey}`, "content-type": "application/json", Prefer: "wait" },
    body: JSON.stringify({ input: { prompt: p.prompt } }),
  });
  if (!r.ok) throw new Error(`Replicate ${r.status}: ${await r.text()}`);
  let pred = await r.json();
  for (let i = 0; i < 200 && (pred.status === "starting" || pred.status === "processing"); i++) {
    await new Promise((res) => setTimeout(res, 2000));
    const pr = await fetch(pred.urls?.get ?? `https://api.replicate.com/v1/predictions/${pred.id}`, {
      headers: { Authorization: `Bearer ${cred.apiKey}` },
    });
    pred = await pr.json();
  }
  if (pred.status !== "succeeded") throw new Error(`Replicate: ${pred.error ?? pred.status}`);
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  return { url: typeof out === "string" ? out : "", model: p.model };
}

async function falVideo(p: VideoParams, cred: Cred): Promise<VideoResult> {
  const r = await fetch(`https://fal.run/${p.model}`, {
    method: "POST",
    headers: { Authorization: `Key ${cred.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt: p.prompt }),
  });
  if (!r.ok) throw new Error(`fal ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return { url: j.video?.url ?? j.url ?? "", model: p.model };
}

// ── Música (Replicate / fal por polling) ─────────────────────────────────────
export async function generateMusicWith(providerId: string, family: string, p: MusicParams, cred: Cred): Promise<MusicResult> {
  if (providerId === "replicate" || family === "replicate") {
    const v = await replicateVideo({ model: p.model, prompt: p.prompt }, cred); // mismo polling, output = audio url
    return { url: v.url, model: p.model };
  }
  if (providerId === "fal" || family === "fal") {
    const r = await fetch(`https://fal.run/${p.model}`, {
      method: "POST",
      headers: { Authorization: `Key ${cred.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: p.prompt }),
    });
    if (!r.ok) throw new Error(`fal ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return { url: j.audio?.url ?? j.audio_file?.url ?? j.url ?? "", model: p.model };
  }
  throw new Error(`Música con ${providerId} todavía no está implementada. Probá un modelo vía Replicate o fal.`);
}

// ── TTS ──────────────────────────────────────────────────────────────────────
const DEFAULT_ELEVEN_VOICE = "21m00Tcm4TlvDq8ikWAM"; // "Rachel" (voz pública)

export async function speakWith(providerId: string, p: TtsParams, cred: Cred): Promise<{ bytes: Buffer; mime: string }> {
  if (providerId === "openai") return openaiTts(p, cred);
  if (providerId === "elevenlabs") return elevenTts(p, cred);
  throw new Error(`TTS con ${providerId} todavía no está implementado.`);
}

async function openaiTts(p: TtsParams, cred: Cred): Promise<{ bytes: Buffer; mime: string }> {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: p.model, input: p.text, voice: p.voice || "alloy" }),
  });
  if (!r.ok) throw new Error(`OpenAI TTS ${r.status}: ${await r.text()}`);
  return { bytes: Buffer.from(await r.arrayBuffer()), mime: "audio/mpeg" };
}

async function elevenTts(p: TtsParams, cred: Cred): Promise<{ bytes: Buffer; mime: string }> {
  const voice = p.voice || DEFAULT_ELEVEN_VOICE;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: "POST",
    headers: { "xi-api-key": cred.apiKey, "content-type": "application/json" },
    body: JSON.stringify({ text: p.text, model_id: p.model }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);
  return { bytes: Buffer.from(await r.arrayBuffer()), mime: "audio/mpeg" };
}

// ── STT ──────────────────────────────────────────────────────────────────────
export async function transcribeWith(providerId: string, p: SttParams, cred: Cred): Promise<TranscriptResult> {
  const audio = await fetch(p.audioUrl);
  if (!audio.ok) throw new Error(`No se pudo descargar el audio (${audio.status}).`);
  const bytes = Buffer.from(await audio.arrayBuffer());
  const mime = audio.headers.get("content-type") ?? "audio/mpeg";

  if (providerId === "deepgram") {
    const r = await fetch(`https://api.deepgram.com/v1/listen?model=${encodeURIComponent(p.model)}&smart_format=true`, {
      method: "POST",
      headers: { Authorization: `Token ${cred.apiKey}`, "content-type": mime },
      body: bytes as unknown as BodyInit,
    });
    if (!r.ok) throw new Error(`Deepgram ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return { text: j.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "", model: p.model };
  }
  // OpenAI Whisper (multipart)
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), "audio");
  form.append("model", p.model);
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.apiKey}` },
    body: form,
  });
  if (!r.ok) throw new Error(`OpenAI STT ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return { text: j.text ?? "", model: p.model };
}
