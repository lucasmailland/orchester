# AI Model Catalog & Multi-Capability Integrations — Design

**Date:** 2026-05-22
**Status:** Approved (architecture: hand-rolled adapters, Option 2)
**Owner:** flows / ai

## Goal

Let users connect any AI provider (BYO key per workspace) and pick a specific
provider + model wherever a model is needed — agents and flow steps — across many
capabilities: chat, image, video, avatar, embedding, rerank, TTS, STT, music, OCR.
Ship chat + image + embeddings working end-to-end now; catalog and make connectable
(execution later) the rest. Unlocks: JPG invitation, file vectorization, and (later)
a talking-head video that says the person's name.

## Architecture

Hand-rolled ports & adapters with a declarative catalog. No third-party AI SDK.

```
lib/ai/
  catalog/ types.ts providers.ts models.ts index.ts   # declarative source of truth
  capabilities.ts        # ChatAdapter, ImageAdapter, EmbeddingAdapter (+ future ports)
  adapters/              # by FAMILY: openai-compatible, anthropic, gemini, images/*
  registry.ts            # resolveModel(modelId), getAdapter(capability, provider)
  credentials.ts         # load + decrypt workspace provider connection
  run.ts                 # runChat / generateImage / embed
```

Scalability lever: one `openai-compatible` adapter (baseURL + auth header) covers
~20 chat providers; each provider is one catalog row. Bespoke adapters only where
the API differs (Anthropic, Gemini, image providers, Replicate/fal aggregators).

### Types

```ts
type Capability = "chat"|"image"|"video"|"avatar"|"embedding"|"rerank"|"tts"|"stt"|"music"|"ocr";
type Family = "openai-compatible"|"anthropic"|"gemini"|"bedrock"|"replicate"|"fal"
  |"openai-images"|"google-imagen"|"stability"|"bfl"|"ideogram"|"recraft"
  |"elevenlabs"|"deepgram"|"assemblyai"|"bespoke";
interface ProviderDef { id; name; family; kind:"direct"|"aggregator"|"local";
  capabilities: Capability[]; auth:"api_key"|"api_key+endpoint"|"aws"; baseURL?; docsUrl? }
interface ModelDef { id /*"provider:model"*/; provider; name; capability; tier?; contextWindow?; notes? }
```

Chat keeps a back-compat shim so bare ids agents store today (`claude-…`,`gpt-…`) resolve.

### Data model

`ai-providers.ts`: `provider` pgEnum -> text (open set), keep unique(workspace,provider),
add `config jsonb`. Keys encrypted (AES-256-GCM), never logged. Adapters call known
hosts only (no SSRF); local providers (Ollama/LM Studio) loopback behind opt-in.

### UI

Settings AI section -> capability-grouped provider directory (connect/test). Shared
`ModelPicker({capability})` lists models from connected providers, used by agent
editor (chat) and flow nodes. New field type `model-picker` (with `capability`).

### Flow nodes (functional now)

- `generate_image` ("Crear imagen"): model(image) + prompt + size -> image URL var.
- `embed_text` ("Vectorizar"): model(embedding) + input -> vector(s) (reuse embeddings).
- Agent editor uses ModelPicker(chat). `llm-call.ts` refactored into chat adapters
  (reuse existing SSE); `llmCall`/`llmStream` become thin wrappers over runChat.

## Phasing

A catalog+types+registry(+tests) · B DB enum->text+config+credentials · C chat
adapters from llm-call + runChat · D Settings directory · E ModelPicker + agent ·
F image adapters + generate_image · G embeddings + embed_text · H catalog-only
providers (video/avatar/tts/stt/music/rerank/ocr) connectable · I docs.

## Appendix — providers

Chat (openai-compatible unless noted): OpenAI · Azure(+endpoint) · xAI · DeepSeek ·
Mistral · Groq · Together · Fireworks · Perplexity · OpenRouter(agg) · DeepInfra ·
Novita · SambaNova · Cerebras · Qwen · Moonshot · Zhipu · Meta Llama API · NVIDIA ·
HuggingFace · Ollama(local) · LM Studio(local) · AI21 · Reka · Writer · Cohere —
anthropic: Anthropic · Bedrock(aws) — gemini: Google.
Image: OpenAI(gpt-image-1,dall-e-3) · Google(Imagen 4, Gemini Flash Image "Nano
Banana", Gemini 3 Pro Image) · Stability · Black Forest FLUX · Ideogram · Recraft ·
Leonardo · Adobe Firefly · ByteDance Seedream 4 · Reve · Luma Photon · HiDream ·
Playground v3 · Bria · Replicate(agg) · fal(agg).
Video (catalog): Veo · Sora · Runway · Luma · Kling · Pika · MiniMax/Hailuo ·
Higgsfield · Wan 2.x · Seedance · Vidu · LTX · Hunyuan · Mochi · Haiper · Firefly
Video · SVD · Krea.
Avatar (catalog): HeyGen · Synthesia · D-ID · Tavus · Sync.so.
Embedding: OpenAI · Google · Voyage · Cohere · Mistral · Jina · Nomic · Qwen3 · BGE ·
Cloudflare.
Rerank (catalog): Cohere · Voyage · Jina.
TTS (catalog): ElevenLabs · OpenAI · Google · Cartesia · PlayHT · Hume · Polly ·
Azure · Fish · Kokoro · Rime · LMNT · Resemble · Camb.ai.
STT (catalog): Whisper · Deepgram · AssemblyAI · Google · Groq Whisper · ElevenLabs
Scribe · Speechmatics · Gladia · Azure.
Music (catalog): Suno · Udio · Stable Audio · Lyria · ElevenLabs Music · MusicGen.
OCR (catalog): Mistral OCR · LlamaParse · Google Document AI · AWS Textract · Azure
Document Intelligence · Reducto · Unstructured.
