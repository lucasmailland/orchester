/**
 * Shared types for the first-mile onboarding wizard.
 *
 * The wizard has 5 steps. The numeric index is the source of truth and is
 * persisted to localStorage so a reload doesn't lose progress.
 */

export type StepIndex = 0 | 1 | 2 | 3 | 4;

export type Role = "customer-support" | "internal-automation" | "exploring";

export type AgentTemplateId = "tier1" | "helpdesk" | "sales-coach" | "blank";

/**
 * In-progress form values for the Agent step.
 *
 * Persisted on every change so a re-login round trip (triggered by a 401
 * on POST /api/agents) doesn't lose what the user typed.
 */
export interface AgentDraft {
  selectedTpl: AgentTemplateId;
  model: string;
  name: string;
  role: string;
}

export interface PersistedState {
  step: StepIndex;
  role: Role | null;
  useSample: boolean;
  agentId: string | null;
  providerConnected: boolean;
  conversationStarted: boolean;
  agentDraft: AgentDraft | null;
}

export const STORAGE_KEYS = {
  state: "compass.onboarding.state",
  role: "compass.onboarding.role",
  skipped: "compass.onboarding.skipped",
} as const;

export function readState(): Partial<PersistedState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.state);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedState>;
  } catch {
    return {};
  }
}

export function writeState(patch: Partial<PersistedState>): void {
  if (typeof window === "undefined") return;
  try {
    const current = readState();
    const next = { ...current, ...patch };
    window.localStorage.setItem(STORAGE_KEYS.state, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable (private mode, quota); silent is fine
  }
}

export function emitActivation(step: StepIndex, workspaceId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("compass:activation", { detail: { step, workspaceId } }));
  } catch {
    // CustomEvent unsupported -> ignore
  }
}
