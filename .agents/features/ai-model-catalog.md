# AI Model Catalog & Multi-Capability Integrations

**Files:** `apps/web/lib/ai/*`, `apps/web/components/ai/ModelPicker.tsx`,
`apps/web/components/settings/AIProvidersSection.tsx`,
`apps/web/app/api/ai/models/route.ts`, `apps/web/app/api/providers/*`
**Owner:** ai / flows
**Status:** chat + image + embeddings functional; rest catalog-only (connectable)

## Purpose

Connect ANY AI provider (BYO key per workspace) and pick a provider+model anywhere
a model is needed (agents, flow steps) across 10 capabilities: chat, image, video,
avatar, embedding, rerank, tts, stt, music, ocr.

## Architecture (hand-rolled adapters, no external SDK)

```
lib/ai/
  catalog/    types.ts providers.ts models.ts index.ts   # declarative source of truth
  capabilities.ts        # ChatAdapter / ImageAdapter / EmbeddingAdapter (ports)
  credentials.ts         # loadCredential (decrypt by workspace+provider), listConnectedProviderIds
  adapters/images.ts     # OpenAI, Google Imagen/Gemini, Replicate, fal
  adapters/embeddings.ts # openai-compatible + Google
  run.ts                 # runChat / generateImage / embed (resolve→cred→adapter)
```

- **Families** make it scale: one `openai-compatible` path (baseURL + key) covers
  ~25 chat providers; aggregators (Replicate/fal/OpenRouter) cover hundreds.
  `lib/llm-call.ts` is now catalog-driven (dispatch by family) and gained
  OpenAI-style tool calling.
- **resolveModel("provider:model")** maps to provider+capability; legacy bare chat
  ids (`claude-…`, `gpt-…`) and free-form aggregator ids still resolve.
- **Storage:** `ai_provider.provider` is now `text` (open set) + `config jsonb`.

## UI

- **Settings → IA** (`AIProvidersSection`): all catalog providers grouped by
  capability, each connectable (key [+ endpoint]), with capability chips + model
  counts. Catalog is a client-importable data module.
- **`components/ai/ModelPicker`**: capability-filtered, lists models of connected
  providers (via `/api/ai/models?capability=…`). Used by the `model-picker` field
  type and the agent editor.

## Flow nodes (AI suite)

- **`llm_prompt`** ("Generar texto") → `runChat` → text.
- **`generate_image`** ("Crear imagen") → `run.generateImage` → image URL (base64 saved to storage).
- **`generate_video`** ("Crear video") → `run.generateVideo` (Replicate/fal polled) → video URL.
- **`text_to_speech`** ("Texto a voz") → `run.textToSpeech` (ElevenLabs/OpenAI) → audio URL.
- **`transcribe`** ("Transcribir audio") → `run.transcribe` (Whisper/Deepgram) → text.
- **`embed_text`** ("Vectorizar") → `run.embed` → vector.
- **`rerank`** ("Ordenar por relevancia") → `run.rerank` (Cohere/Voyage/Jina) → ranked.

Every node with a model uses the `model-picker` field, which lists connected
providers' models and lets you **connect a provider inline** (ConnectProviderModal)
without leaving the editor.

## Changelog

### 2026-05-22 — initial
- Catalog of ~80 providers / 10 capabilities; resolveModel + capability ports.
- Provider storage enum→text + credentials layer.
- Catalog-driven chat (all openai-compatible/anthropic/gemini providers) + OpenAI
  tool calling.
- Image generation (OpenAI/Google/Replicate/fal) + embeddings adapters.
- Settings provider directory by capability; ModelPicker; generate_image &
  embed_text nodes.

## Audit fixes applied (2026-05-22)
- Reasoning models (o3/o4-mini/gpt-5*) use max_completion_tokens, no temperature.
- Local providers (ollama/lmstudio) gated behind ALLOW_LOCAL_AI_PROVIDERS (SSRF).
- Generated images saved to app storage (no base64 in flow_runs.output).
- Replicate/fal send only {prompt} (avoid 422 on unknown input keys).
- Azure deployment ids (azure/<deploy>) resolve; pickers merge tested modelsJson.
- Bespoke image adapters: Recraft, Stability, Ideogram, BFL (no longer aggregator-only).

## Open issues / TODO
- Avatar / music / OCR: connectable + catalogued, executors are a follow-up.
- Some bespoke endpoints (Ideogram/BFL/Stability) are best-effort — verify per key.
- Per-provider "test" is generic for non-core providers (key-shape only).
- Catalog model ids/baseURLs are curated/best-effort; validate vs live APIs.
