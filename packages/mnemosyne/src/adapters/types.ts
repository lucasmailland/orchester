// packages/mnemosyne/src/adapters/types.ts
//
// Provider capability interface (§25 Charter). Mnemosyne core never
// branches on provider id — adapters opportunistically use provider-
// specific optimizations behind these flags.

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface CallParams {
  workspaceId: string;
  systemPrompt: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /** Mnemosyne marks blocks as cacheable. Adapter decides if it uses them. */
  cacheableBlocks?: string[];
  /** Hard fail if estimated cost exceeds this (USD). */
  costCeiling?: number;
}

export interface CallResult {
  content: string;
  tokensUsed: number;
  model: string;
  costUsd?: number;
}

export interface ModelAdapter {
  readonly providerId: string;

  call(params: CallParams): Promise<CallResult>;
  callBatched(params: CallParams[]): Promise<CallResult[]>;
  embed(texts: string[]): Promise<number[][]>;

  supportsPromptCaching(): boolean;
  supportsJSONMode(): boolean;
  supportsBatchedCompletion(): boolean;
  supportsBatchedEmbedding(): boolean;

  costPer1MTokens(): { input: number; output: number };
  costPer1MEmbeddings(): number;
}
