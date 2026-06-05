import type { ModelDef, Capability } from "./types";

/**
 * Modelos del catálogo. Curado (modelos insignia por proveedor) para las
 * capacidades ejecutables (chat/image/embedding) y representativo para el resto.
 * Los agregadores (replicate/fal/openrouter) aceptan muchos más por id libre.
 */

type Tier = "fast" | "smart" | "powerful";
function m(
  provider: string,
  model: string,
  name: string,
  capability: Capability,
  opts: { tier?: Tier; ctx?: number; notes?: string; cin?: number; cout?: number } = {}
): ModelDef {
  const d: ModelDef = { id: `${provider}:${model}`, provider, name, capability };
  if (opts.tier) d.tier = opts.tier;
  if (opts.ctx) d.contextWindow = opts.ctx;
  // cin/cout = USD por 1k tokens (input/output) — pricing A4.
  if (opts.cin != null) d.costPer1kIn = opts.cin;
  if (opts.cout != null) d.costPer1kOut = opts.cout;
  if (opts.notes) d.notes = opts.notes;
  return d;
}

export const MODELS: ModelDef[] = [
  // ── Chat ─────────────────────────────────────────────────────────────────────
  m("openai", "gpt-4o", "GPT-4o", "chat", { tier: "smart", ctx: 128_000, cin: 0.0025, cout: 0.01 }),
  m("openai", "gpt-4o-mini", "GPT-4o mini", "chat", {
    tier: "fast",
    ctx: 128_000,
    cin: 0.00015,
    cout: 0.0006,
  }),
  m("openai", "gpt-4.1", "GPT-4.1", "chat", {
    tier: "smart",
    ctx: 1_000_000,
    cin: 0.002,
    cout: 0.008,
  }),
  m("openai", "o3", "o3", "chat", { tier: "powerful", ctx: 200_000, cin: 0.002, cout: 0.008 }),
  m("openai", "o4-mini", "o4-mini", "chat", {
    tier: "fast",
    ctx: 200_000,
    cin: 0.0011,
    cout: 0.0044,
  }),
  m("anthropic", "claude-opus-4-7", "Claude Opus 4.7", "chat", {
    tier: "powerful",
    ctx: 200_000,
    cin: 0.015,
    cout: 0.075,
  }),
  m("anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6", "chat", {
    tier: "smart",
    ctx: 200_000,
    cin: 0.003,
    cout: 0.015,
  }),
  m("anthropic", "claude-haiku-4-5", "Claude Haiku 4.5", "chat", {
    tier: "fast",
    ctx: 200_000,
    cin: 0.0008,
    cout: 0.004,
  }),
  m("google", "gemini-3-pro-preview", "Gemini 3 Pro", "chat", {
    tier: "powerful",
    ctx: 1_000_000,
    cin: 0.00125,
    cout: 0.005,
  }),
  m("google", "gemini-2.5-pro", "Gemini 2.5 Pro", "chat", {
    tier: "powerful",
    ctx: 1_000_000,
    cin: 0.00125,
    cout: 0.005,
  }),
  m("google", "gemini-2.5-flash", "Gemini 2.5 Flash", "chat", {
    tier: "smart",
    ctx: 1_000_000,
    cin: 0.0003,
    cout: 0.0012,
  }),
  m("google", "gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite", "chat", {
    tier: "fast",
    ctx: 1_000_000,
    cin: 0.0001,
    cout: 0.0004,
  }),
  m("google", "gemini-2.0-flash", "Gemini 2.0 Flash", "chat", {
    tier: "fast",
    ctx: 1_000_000,
    cin: 0.0001,
    cout: 0.0004,
  }),
  m("xai", "grok-4", "Grok 4", "chat", { tier: "powerful", ctx: 256_000, cin: 0.003, cout: 0.015 }),
  m("xai", "grok-3", "Grok 3", "chat", { tier: "smart", ctx: 131_072, cin: 0.003, cout: 0.015 }),
  m("deepseek", "deepseek-chat", "DeepSeek V3", "chat", {
    tier: "smart",
    ctx: 64_000,
    cin: 0.00027,
    cout: 0.0011,
  }),
  m("deepseek", "deepseek-reasoner", "DeepSeek R1", "chat", {
    tier: "powerful",
    ctx: 64_000,
    cin: 0.00055,
    cout: 0.00219,
  }),
  m("mistral", "mistral-large-latest", "Mistral Large", "chat", {
    tier: "smart",
    ctx: 131_072,
    cin: 0.002,
    cout: 0.006,
  }),
  m("mistral", "mistral-small-latest", "Mistral Small", "chat", {
    tier: "fast",
    ctx: 131_072,
    cin: 0.0002,
    cout: 0.0006,
  }),
  m("groq", "llama-3.3-70b-versatile", "Llama 3.3 70B (Groq)", "chat", {
    tier: "fast",
    ctx: 131_072,
  }),
  m("groq", "openai/gpt-oss-120b", "GPT-OSS 120B (Groq)", "chat", { tier: "smart", ctx: 131_072 }),
  m("cerebras", "llama-3.3-70b", "Llama 3.3 70B (Cerebras)", "chat", {
    tier: "fast",
    ctx: 131_072,
  }),
  m("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo", "Llama 3.3 70B (Together)", "chat", {
    tier: "smart",
    ctx: 131_072,
  }),
  m("together", "deepseek-ai/DeepSeek-V3", "DeepSeek V3 (Together)", "chat", {
    tier: "smart",
    ctx: 131_072,
  }),
  m(
    "fireworks",
    "accounts/fireworks/models/llama-v3p3-70b-instruct",
    "Llama 3.3 70B (Fireworks)",
    "chat",
    { tier: "smart", ctx: 131_072 }
  ),
  m("perplexity", "sonar-pro", "Sonar Pro (con búsqueda)", "chat", { tier: "smart", ctx: 200_000 }),
  m("perplexity", "sonar", "Sonar (con búsqueda)", "chat", { tier: "fast", ctx: 128_000 }),
  m("openrouter", "anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5 (OpenRouter)", "chat", {
    tier: "smart",
    ctx: 200_000,
  }),
  m("openrouter", "google/gemini-2.5-pro", "Gemini 2.5 Pro (OpenRouter)", "chat", {
    tier: "powerful",
    ctx: 1_000_000,
  }),
  m("openrouter", "meta-llama/llama-3.3-70b-instruct", "Llama 3.3 70B (OpenRouter)", "chat", {
    tier: "smart",
    ctx: 131_072,
  }),
  m("qwen", "qwen-max", "Qwen Max", "chat", { tier: "powerful", ctx: 32_000 }),
  m("qwen", "qwen-plus", "Qwen Plus", "chat", { tier: "smart", ctx: 131_072 }),
  m("moonshot", "kimi-k2-0905-preview", "Kimi K2", "chat", { tier: "smart", ctx: 256_000 }),
  m("zhipu", "glm-4.6", "GLM-4.6", "chat", { tier: "smart", ctx: 200_000 }),
  m("sambanova", "Meta-Llama-3.3-70B-Instruct", "Llama 3.3 70B (SambaNova)", "chat", {
    tier: "fast",
    ctx: 131_072,
  }),
  m("deepinfra", "meta-llama/Llama-3.3-70B-Instruct", "Llama 3.3 70B (DeepInfra)", "chat", {
    tier: "smart",
    ctx: 131_072,
  }),
  m("cohere", "command-a-03-2025", "Command A", "chat", { tier: "smart", ctx: 256_000 }),
  m("nvidia", "meta/llama-3.3-70b-instruct", "Llama 3.3 70B (NVIDIA)", "chat", {
    tier: "smart",
    ctx: 131_072,
  }),
  m("ai21", "jamba-large", "Jamba Large", "chat", { tier: "smart", ctx: 256_000 }),

  // ── Imagen ───────────────────────────────────────────────────────────────────
  m("openai", "gpt-image-1", "GPT Image 1", "image", { tier: "powerful" }),
  m("openai", "dall-e-3", "DALL·E 3", "image", { tier: "smart" }),
  m("google", "gemini-3-pro-image-preview", "Gemini 3 Pro Image (Nano Banana Pro)", "image", {
    tier: "powerful",
  }),
  m("google", "gemini-2.5-flash-image", "Gemini 2.5 Flash Image (Nano Banana)", "image", {
    tier: "smart",
  }),
  m("google", "imagen-4.0-ultra-generate-001", "Imagen 4 Ultra", "image", { tier: "powerful" }),
  m("google", "imagen-4.0-generate-001", "Imagen 4", "image", { tier: "smart" }),
  m("google", "imagen-4.0-fast-generate-001", "Imagen 4 Fast", "image", { tier: "fast" }),
  m("google", "imagen-3.0-generate-002", "Imagen 3", "image", { tier: "smart" }),
  m("stability", "sd3.5-large", "Stable Diffusion 3.5 Large", "image", { tier: "smart" }),
  m("bfl", "flux-pro-1.1", "FLUX 1.1 Pro", "image", { tier: "powerful" }),
  m("bfl", "flux-dev", "FLUX dev", "image", { tier: "smart" }),
  m("ideogram", "ideogram-v3", "Ideogram v3 (texto en imagen)", "image", { tier: "smart" }),
  m("recraft", "recraftv3", "Recraft v3 (texto/vector)", "image", { tier: "smart" }),
  m("bytedance", "seedream-4.0", "Seedream 4", "image", { tier: "smart" }),
  m("reve", "reve-image-1.0", "Reve", "image", { tier: "smart" }),
  m("luma", "photon-1", "Luma Photon", "image", { tier: "smart" }),
  m("leonardo", "leonardo-phoenix-1.0", "Leonardo Phoenix", "image", { tier: "smart" }),
  m("adobe_firefly", "firefly-image-4", "Firefly Image 4", "image", { tier: "smart" }),
  m("bria", "bria-3.2", "Bria 3.2 (comercial)", "image", { tier: "smart" }),
  m("playground", "playground-v3", "Playground v3", "image", { tier: "smart" }),
  m("replicate", "black-forest-labs/flux-1.1-pro", "FLUX 1.1 Pro (Replicate)", "image", {
    tier: "powerful",
  }),
  m("replicate", "ideogram-ai/ideogram-v3-turbo", "Ideogram v3 Turbo (Replicate)", "image", {
    tier: "smart",
  }),
  m("fal", "fal-ai/flux-pro/v1.1", "FLUX 1.1 Pro (fal)", "image", { tier: "powerful" }),
  m("fal", "fal-ai/recraft-v3", "Recraft v3 (fal)", "image", { tier: "smart" }),

  // ── Embeddings ─────────────────────────────────────────────────────────────────
  m("openai", "text-embedding-3-small", "text-embedding-3-small", "embedding", { tier: "fast" }),
  m("openai", "text-embedding-3-large", "text-embedding-3-large", "embedding", { tier: "smart" }),
  m("google", "text-embedding-004", "Google text-embedding-004", "embedding", { tier: "fast" }),
  m("google", "gemini-embedding-001", "Gemini Embedding", "embedding", { tier: "smart" }),
  m("voyage", "voyage-3.5", "Voyage 3.5", "embedding", { tier: "smart" }),
  m("voyage", "voyage-3-large", "Voyage 3 Large", "embedding", { tier: "powerful" }),
  m("cohere", "embed-v4.0", "Cohere Embed v4", "embedding", { tier: "smart" }),
  m("mistral", "mistral-embed", "Mistral Embed", "embedding", { tier: "fast" }),
  m("jina", "jina-embeddings-v3", "Jina Embeddings v3", "embedding", { tier: "smart" }),
  m("nomic", "nomic-embed-text-v1.5", "Nomic Embed v1.5", "embedding", { tier: "fast" }),
  m("qwen", "text-embedding-v4", "Qwen3 Embedding", "embedding", { tier: "smart" }),

  // ── Video (catálogo) ───────────────────────────────────────────────────────────
  m("google_veo", "veo-3.0-generate-preview", "Veo 3", "video"),
  m("google_veo", "veo-3.0-fast-generate-preview", "Veo 3 Fast", "video"),
  m("google_veo", "veo-2.0-generate-001", "Veo 2", "video"),
  m("openai_sora", "sora-2", "Sora 2", "video"),
  m("runway", "gen-4", "Runway Gen-4", "video"),
  m("kling", "kling-v2", "Kling 2.0", "video"),
  m("luma", "ray-2", "Luma Ray 2", "video"),
  m("minimax", "hailuo-02", "Hailuo 02", "video"),
  m("pika", "pika-2.2", "Pika 2.2", "video"),
  m("higgsfield", "higgsfield-dop", "Higgsfield DoP", "video"),
  m("alibaba_wan", "wan-2.5", "Wan 2.5", "video"),
  m("bytedance", "seedance-1.0-pro", "Seedance 1.0 Pro", "video"),
  m("vidu", "vidu-q1", "Vidu Q1", "video"),
  m("lightricks", "ltx-video", "LTX Video", "video"),
  m("replicate", "minimax/video-01", "Hailuo (Replicate)", "video"),
  m("fal", "fal-ai/minimax/video-01", "Hailuo (fal)", "video"),

  // ── Avatar (catálogo) ────────────────────────────────────────────────────────
  m("heygen", "avatar-iv", "HeyGen Avatar IV", "avatar"),
  m("synthesia", "synthesia-avatar", "Synthesia Avatar", "avatar"),
  m("did", "did-clips", "D-ID Clips", "avatar"),
  m("tavus", "tavus-replica", "Tavus Replica", "avatar"),
  m("sync", "lipsync-2", "Sync Lipsync 2", "avatar"),

  // ── TTS (catálogo) ─────────────────────────────────────────────────────────────
  m("elevenlabs", "eleven-v3", "ElevenLabs v3", "tts"),
  m("elevenlabs", "eleven-multilingual-v2", "ElevenLabs Multilingual v2", "tts"),
  m("openai", "gpt-4o-mini-tts", "OpenAI gpt-4o-mini-tts", "tts"),
  m("cartesia", "sonic-2", "Cartesia Sonic 2", "tts"),
  m("playht", "play-3.0-mini", "PlayHT 3.0 mini", "tts"),
  m("hume", "octave", "Hume Octave", "tts"),

  // ── STT (catálogo) ───────────────────────────────────────────────────────────
  m("openai", "gpt-4o-transcribe", "OpenAI gpt-4o-transcribe", "stt"),
  m("openai", "whisper-1", "Whisper", "stt"),
  m("deepgram", "nova-3", "Deepgram Nova 3", "stt"),
  m("assemblyai", "universal-2", "AssemblyAI Universal 2", "stt"),
  m("groq", "whisper-large-v3-turbo", "Whisper Large v3 Turbo (Groq)", "stt"),
  m("elevenlabs", "scribe-v1", "ElevenLabs Scribe", "stt"),

  // ── Música (catálogo) ──────────────────────────────────────────────────────────
  m("suno", "suno-v4.5", "Suno v4.5", "music"),
  m("udio", "udio-1.5", "Udio 1.5", "music"),
  m("stability", "stable-audio-2.5", "Stable Audio 2.5", "music"),
  m("google_lyria", "lyria-2", "Lyria 2", "music"),
  m("elevenlabs", "eleven-music", "ElevenLabs Music", "music"),
  m("replicate", "meta/musicgen", "MusicGen (Replicate)", "music"),
  m("fal", "fal-ai/stable-audio", "Stable Audio (fal)", "music"),

  // ── Rerank (catálogo) ────────────────────────────────────────────────────────
  m("cohere", "rerank-v3.5", "Cohere Rerank v3.5", "rerank"),
  m("voyage", "rerank-2.5", "Voyage Rerank 2.5", "rerank"),
  m("jina", "jina-reranker-v2-base-multilingual", "Jina Reranker v2", "rerank"),

  // ── OCR (catálogo) ─────────────────────────────────────────────────────────────
  m("mistral", "mistral-ocr-latest", "Mistral OCR", "ocr"),
  m("llamaparse", "llamaparse", "LlamaParse", "ocr"),
  m("reducto", "reducto-parse", "Reducto", "ocr"),
];
