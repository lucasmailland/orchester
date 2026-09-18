/**
 * Compass Templates — typed registry of starting templates for the four
 * core "+ New X" entry points (Agent, Flow, Knowledge Base, Channel).
 *
 * Each template is rendered by `<TemplatePicker kind="..." />` as a card.
 * Selecting a card hands the consumer a typed `payload` that mirrors the
 * POST body the existing API route already accepts.
 *
 * Voice: copy lives in i18n (compass.templates.<kind>.<id>.*). This file
 * is structure and payloads only — no user-facing strings.
 */

import { specToStoredGraph } from "@/lib/flows/normalize";

/**
 * Mirrors the `type` enum on `schema.channels` (apps/web/app/api/channels).
 * Kept inline rather than imported because the schema package doesn't export
 * a named ChannelType union. (The registry is no longer zero-dep: flow
 * templates are built from the node registry, so they can only reference
 * steps the editor actually has.)
 */
export type ChannelType =
  | "widget"
  | "web"
  | "telegram"
  | "slack"
  | "discord"
  | "whatsapp"
  | "email"
  | "api";

// -------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------

export type TemplateKind = "agent" | "flow" | "knowledge" | "channel";

/**
 * Type-safe registry of icon names accepted by the TemplatePicker.
 *
 * This union is the single source of truth for "which lucide icons can a
 * template reference?". TemplatePicker's ICON_BY_NAME map is typed as
 * `Record<CompassIconName, LucideIcon>`, so:
 *   - Adding an icon here forces the picker to register a matching import
 *     (compile error otherwise).
 *   - Typing `iconName: "Hedphones"` in a template fails at the template
 *     definition, not silently at render with a fallback.
 *
 * Keep this list alphabetized; mirror it in the picker's import block.
 */
export type CompassIconName =
  | "BookOpen"
  | "Code2"
  | "Compass"
  | "Globe"
  | "GitPullRequest"
  | "Hash"
  | "Headphones"
  | "Inbox"
  | "LifeBuoy"
  | "Mail"
  | "Megaphone"
  | "MessageCircle"
  | "Newspaper"
  | "ScrollText"
  | "Sparkles"
  | "Target"
  | "Trophy"
  | "Webhook";

/**
 * A starting template for one of the four creation flows. The `payload`
 * is the object the create-form modal pre-fills + posts to the API.
 *
 * `TPayload` is generic so each kind has a typed payload (see the
 * unions below). The registry exposes typed accessors that keep this
 * narrow on read.
 */
export interface CompassTemplate<TPayload = unknown> {
  /** Stable slug. Used in i18n keys and analytics. */
  id: string;
  kind: TemplateKind;
  /** i18n key under compass.templates.<kind>.<id>.label */
  labelKey: string;
  /** i18n key under compass.templates.<kind>.<id>.description */
  descriptionKey: string;
  /** lucide-react icon name, resolved by TemplatePicker's icon map. */
  iconName: CompassIconName;
  /** Optional i18n key resolving to an array of tag strings. */
  tagsKey?: string;
  /**
   * Whether this is the "Blank" / start-from-scratch card. Rendered
   * visually distinct (lighter style) and pinned first in the grid.
   */
  blank?: boolean;
  /** Payload pre-filled into the create modal. Shape depends on kind. */
  payload: TPayload;
}

// -------------------------------------------------------------------------
// Payload shapes — mirror the existing POST /api/<resource> bodies
// -------------------------------------------------------------------------

/** POST /api/agents body. Mirrors createAgentSchema. */
export interface AgentTemplatePayload {
  name: string;
  role: string;
  systemPrompt: string;
  model?: string;
  status?: "draft" | "active" | "paused";
  /** Optional suggestion of KBs to attach in a post-create step. */
  suggestedKnowledgeBaseTemplateIds?: string[];
}

/** POST /api/flows body. Mirrors createFlowSchema. */
export interface FlowTemplatePayload {
  name: string;
  description?: string;
  /**
   * Either a server-known templateId (loads from flowTemplates table)
   * or an inline node/edge graph. Both are supported by the route.
   */
  templateId?: string;
  nodes?: unknown[];
  edges?: unknown[];
  variables?: Record<string, unknown>;
}

/** POST /api/knowledge-bases body. Mirrors createKnowledgeBaseSchema. */
export interface KnowledgeTemplatePayload {
  name: string;
  description?: string;
  embeddingProvider?: "openai" | "google";
  embeddingModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

/** POST /api/channels body. Mirrors createChannelSchema. */
export interface ChannelTemplatePayload {
  name: string;
  type: ChannelType;
  agentId?: string;
  /** Optional default config to seed (greeting, webhook hints, etc.). */
  config?: Record<string, unknown>;
}

// Discriminated union — narrow by `kind`.
export type AnyCompassTemplate =
  | (CompassTemplate<AgentTemplatePayload> & { kind: "agent" })
  | (CompassTemplate<FlowTemplatePayload> & { kind: "flow" })
  | (CompassTemplate<KnowledgeTemplatePayload> & { kind: "knowledge" })
  | (CompassTemplate<ChannelTemplatePayload> & { kind: "channel" });

// -------------------------------------------------------------------------
// Agent templates
// -------------------------------------------------------------------------

const AGENT_TEMPLATES: CompassTemplate<AgentTemplatePayload>[] = [
  {
    id: "blank",
    kind: "agent",
    labelKey: "blank.label",
    descriptionKey: "blank.description",
    iconName: "Sparkles",
    blank: true,
    payload: {
      name: "",
      role: "",
      systemPrompt: "",
      model: "claude-sonnet-4-6",
      status: "draft",
    },
  },
  {
    id: "support-tier1",
    kind: "agent",
    labelKey: "support-tier1.label",
    descriptionKey: "support-tier1.description",
    iconName: "Headphones",
    tagsKey: "support-tier1.tags",
    payload: {
      name: "Support Tier 1",
      role: "Tier-1 support agent",
      systemPrompt:
        "You are a Tier-1 support agent. Answer customer questions using only the attached knowledge bases. If a question is outside the knowledge base or the confidence is low, escalate to a human and explain why. Always cite the source document when you answer. Be concise, friendly, and concrete.",
      model: "claude-sonnet-4-6",
      status: "draft",
      suggestedKnowledgeBaseTemplateIds: ["product-docs"],
    },
  },
  {
    id: "lead-qualifier",
    kind: "agent",
    labelKey: "lead-qualifier.label",
    descriptionKey: "lead-qualifier.description",
    iconName: "Target",
    tagsKey: "lead-qualifier.tags",
    payload: {
      name: "Lead Qualifier",
      role: "Inbound lead qualification agent",
      systemPrompt:
        "You qualify inbound leads using the BANT framework (Budget, Authority, Need, Timeline). Ask one question at a time, never more than five questions total. Score each dimension 0-3 and return a JSON summary {budget, authority, need, timeline, score, notes}. Be warm; this is a first conversation, not an interrogation.",
      model: "claude-sonnet-4-6",
      status: "draft",
    },
  },
  {
    id: "sales-coach",
    kind: "agent",
    labelKey: "sales-coach.label",
    descriptionKey: "sales-coach.description",
    iconName: "Trophy",
    tagsKey: "sales-coach.tags",
    payload: {
      name: "Sales Coach",
      role: "Coach for account executives",
      systemPrompt:
        "You coach account executives after their sales calls. Read the transcript or summary they share, then give three things: what went well, what to improve next time, and one specific phrase to try in the next conversation. Be direct but never harsh — coaching, not grading.",
      model: "claude-sonnet-4-6",
      status: "draft",
    },
  },
  {
    id: "internal-helpdesk",
    kind: "agent",
    labelKey: "internal-helpdesk.label",
    descriptionKey: "internal-helpdesk.description",
    iconName: "LifeBuoy",
    tagsKey: "internal-helpdesk.tags",
    payload: {
      name: "Internal Helpdesk",
      role: "IT and HR helpdesk for employees",
      systemPrompt:
        "You answer employee questions about IT, HR, and internal policies. Use only the attached knowledge bases. For anything that requires a human (account access, payroll changes, personal HR matters), open a ticket and tell the employee who will follow up and when.",
      model: "claude-sonnet-4-6",
      status: "draft",
      suggestedKnowledgeBaseTemplateIds: ["hr-policies", "engineering-wiki"],
    },
  },
  {
    id: "onboarding-guide",
    kind: "agent",
    labelKey: "onboarding-guide.label",
    descriptionKey: "onboarding-guide.description",
    iconName: "Compass",
    tagsKey: "onboarding-guide.tags",
    payload: {
      name: "Onboarding Guide",
      role: "Product onboarding companion",
      systemPrompt:
        "You guide new users through the product step by step. Ask what they want to accomplish first, then walk them through the shortest path. Link to the relevant docs when they need depth. Celebrate small wins. Never overwhelm — one step at a time.",
      model: "claude-sonnet-4-6",
      status: "draft",
      suggestedKnowledgeBaseTemplateIds: ["product-docs"],
    },
  },
];

// -------------------------------------------------------------------------
// Flow templates
// -------------------------------------------------------------------------

// Built with specToStoredGraph from real registry steps. These used to be
// { type, data: { label } } nodes with types the editor never had (tool,
// branch, handoff): every flow created from them crashed the editor on open.
// Fields a template cannot know — which agent, knowledge base, URL or token —
// are left empty, and the editor flags each one as "le falta completar".
const FLOW_TEMPLATES: CompassTemplate<FlowTemplatePayload>[] = [
  {
    id: "blank",
    kind: "flow",
    labelKey: "blank.label",
    descriptionKey: "blank.description",
    iconName: "Sparkles",
    blank: true,
    // Picking Blank opens the empty canvas with the editor's start guide.
    payload: { name: "", nodes: [], edges: [], variables: {} },
  },
  {
    id: "lead-qualification",
    kind: "flow",
    labelKey: "lead-qualification.label",
    descriptionKey: "lead-qualification.description",
    iconName: "Target",
    tagsKey: "lead-qualification.tags",
    payload: {
      name: "Lead Qualification",
      description: "Webhook intake, enrichment, qualifier agent, branch on score.",
      ...specToStoredGraph({
        nodes: [
          { id: "n1", nodeId: "trigger_webhook", label: "Webhook" },
          { id: "n2", nodeId: "http", label: "Enrich contact", config: { method: "GET", url: "" } },
          {
            id: "n3",
            nodeId: "agent",
            label: "Qualifier agent",
            config: {
              agentId: "",
              // The step leaves its reply in {{agentResult}} as text, so the
              // condition below can only compare a bare number.
              prompt:
                "Score this lead from 1 to 10 for fit and buying intent. Reply with the number only.\n\nLead: {{name}} <{{email}}>, {{company}}\nEnrichment: {{httpResult}}",
            },
          },
          {
            id: "n4",
            nodeId: "condition",
            label: "Score >= 6?",
            config: { left: "{{agentResult}}", op: ">=", right: "{{scoreThreshold}}" },
          },
        ],
        edges: [
          { source: "n1", target: "n2" },
          { source: "n2", target: "n3" },
          { source: "n3", target: "n4" },
        ],
      }),
      variables: { scoreThreshold: 6 },
    },
  },
  {
    id: "support-triage",
    kind: "flow",
    labelKey: "support-triage.label",
    descriptionKey: "support-triage.description",
    iconName: "Inbox",
    tagsKey: "support-triage.tags",
    payload: {
      name: "Support Triage",
      description:
        "Inbound message, knowledge base search, the agent answers and hands off to a person when it can't.",
      ...specToStoredGraph({
        nodes: [
          { id: "n1", nodeId: "trigger_message", label: "Inbound message" },
          {
            id: "n2",
            nodeId: "kb_search",
            label: "Search KB",
            config: { kbId: "", query: "{{message}}", topK: 3 },
          },
          {
            id: "n3",
            nodeId: "agent",
            label: "Support agent",
            config: {
              agentId: "",
              // An agent step returns text, not a confidence score, so the old
              // "minConfidence" had nothing to compare against. An explicit
              // signal is something the condition can actually evaluate.
              prompt:
                "Answer the customer using only these knowledge base excerpts. If they do not contain the answer, reply with exactly ESCALATE.\n\n{{knowledge}}",
            },
          },
          {
            id: "n4",
            nodeId: "condition",
            label: "Needs a person?",
            config: { left: "{{agentResult}}", op: "contains", right: "ESCALATE" },
          },
          {
            id: "n5",
            nodeId: "wait_human",
            label: "Escalate to human",
            config: {
              instructions:
                "The agent could not answer from the knowledge base. Reply to the customer: {{message}}",
            },
          },
        ],
        edges: [
          { source: "n1", target: "n2" },
          { source: "n2", target: "n3" },
          { source: "n3", target: "n4" },
          { source: "n4", target: "n5", sourceHandle: "true" },
        ],
      }),
      variables: {},
    },
  },
  {
    id: "newsletter-compile",
    kind: "flow",
    labelKey: "newsletter-compile.label",
    descriptionKey: "newsletter-compile.description",
    iconName: "Newspaper",
    tagsKey: "newsletter-compile.tags",
    payload: {
      name: "Newsletter Compile",
      description: "Scheduled pull of updates, agent writes the issue, sends it.",
      ...specToStoredGraph({
        nodes: [
          {
            id: "n1",
            nodeId: "trigger_schedule",
            label: "Schedule (weekly)",
            config: { cron: "0 9 * * 1" },
          },
          { id: "n2", nodeId: "http", label: "Fetch updates", config: { method: "GET", url: "" } },
          {
            id: "n3",
            nodeId: "agent",
            label: "Writer agent",
            config: {
              agentId: "",
              prompt:
                "Write this week's newsletter issue from these updates. Keep it short and scannable.\n\n{{httpResult}}",
            },
          },
          {
            // Not the "Notify" step: that one only records its output and sends
            // nothing. Resend actually delivers the email.
            id: "n4",
            nodeId: "integration",
            label: "Send email",
            config: {
              integrationId: "resend::send_email",
              input: { to: "", subject: "This week's update", text: "{{agentResult}}" },
            },
          },
        ],
        edges: [
          { source: "n1", target: "n2" },
          { source: "n2", target: "n3" },
          { source: "n3", target: "n4" },
        ],
      }),
      variables: {},
    },
  },
  {
    id: "pr-review-bot",
    kind: "flow",
    labelKey: "pr-review-bot.label",
    descriptionKey: "pr-review-bot.description",
    iconName: "GitPullRequest",
    tagsKey: "pr-review-bot.tags",
    payload: {
      name: "PR Review Bot",
      description: "GitHub webhook, fetch diff, review agent, post comment.",
      ...specToStoredGraph({
        nodes: [
          { id: "n1", nodeId: "trigger_webhook", label: "GitHub PR webhook" },
          {
            // The API URL with a diff Accept header, not diff_url: diff_url does
            // not answer for private repositories. Headers are not
            // interpolated, so the token is typed in here.
            id: "n2",
            nodeId: "http",
            label: "Fetch diff",
            config: {
              method: "GET",
              url: "{{pull_request.url}}",
              headers: {
                Accept: "application/vnd.github.diff",
                Authorization: "Bearer REPLACE_WITH_A_GITHUB_TOKEN",
              },
            },
          },
          {
            id: "n3",
            nodeId: "agent",
            label: "Review agent",
            config: {
              agentId: "",
              // The http body is interpolated as plain text, so a free-form
              // review with quotes or line breaks would not be valid JSON.
              prompt:
                'Review this pull request diff. Point out bugs, risky changes and missing tests. Reply only with a JSON object like {"body": "your review in Markdown"}, escaped as valid JSON.\n\n{{httpResult}}',
            },
          },
          {
            id: "n4",
            nodeId: "http",
            label: "Post PR comment",
            config: {
              method: "POST",
              url: "{{pull_request.comments_url}}",
              headers: {
                Accept: "application/vnd.github+json",
                Authorization: "Bearer REPLACE_WITH_A_GITHUB_TOKEN",
              },
              body: "{{agentResult}}",
            },
          },
        ],
        edges: [
          { source: "n1", target: "n2" },
          { source: "n2", target: "n3" },
          { source: "n3", target: "n4" },
        ],
      }),
      variables: {},
    },
  },
];

// -------------------------------------------------------------------------
// Knowledge Base templates
// -------------------------------------------------------------------------

const KNOWLEDGE_TEMPLATES: CompassTemplate<KnowledgeTemplatePayload>[] = [
  {
    id: "blank",
    kind: "knowledge",
    labelKey: "blank.label",
    descriptionKey: "blank.description",
    iconName: "Sparkles",
    blank: true,
    payload: {
      name: "",
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      chunkSize: 800,
      chunkOverlap: 100,
    },
  },
  {
    id: "product-docs",
    kind: "knowledge",
    labelKey: "product-docs.label",
    descriptionKey: "product-docs.description",
    iconName: "BookOpen",
    tagsKey: "product-docs.tags",
    payload: {
      name: "Product Docs",
      description: "Public documentation, changelogs, and feature guides for your product.",
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      chunkSize: 800,
      chunkOverlap: 100,
    },
  },
  {
    id: "hr-policies",
    kind: "knowledge",
    labelKey: "hr-policies.label",
    descriptionKey: "hr-policies.description",
    iconName: "ScrollText",
    tagsKey: "hr-policies.tags",
    payload: {
      name: "HR Policies",
      description: "Vacation, benefits, code of conduct, and other employee-facing policies.",
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      chunkSize: 600,
      chunkOverlap: 100,
    },
  },
  {
    id: "engineering-wiki",
    kind: "knowledge",
    labelKey: "engineering-wiki.label",
    descriptionKey: "engineering-wiki.description",
    iconName: "Code2",
    tagsKey: "engineering-wiki.tags",
    payload: {
      name: "Engineering Wiki",
      description: "Architecture notes, runbooks, on-call docs, ADRs.",
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      chunkSize: 1000,
      chunkOverlap: 150,
    },
  },
  {
    id: "brand-voice",
    kind: "knowledge",
    labelKey: "brand-voice.label",
    descriptionKey: "brand-voice.description",
    iconName: "Megaphone",
    tagsKey: "brand-voice.tags",
    payload: {
      name: "Brand Voice",
      description: "Tone of voice, banned words, examples of on-brand and off-brand copy.",
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      chunkSize: 500,
      chunkOverlap: 80,
    },
  },
];

// -------------------------------------------------------------------------
// Channel templates
// -------------------------------------------------------------------------

const CHANNEL_TEMPLATES: CompassTemplate<ChannelTemplatePayload>[] = [
  {
    id: "web-widget",
    kind: "channel",
    labelKey: "web-widget.label",
    descriptionKey: "web-widget.description",
    iconName: "Globe",
    tagsKey: "web-widget.tags",
    payload: {
      name: "Web widget",
      type: "web",
      config: {
        greeting: "Hi — how can I help today?",
        placeholder: "Write your message...",
        position: "bottom-right",
      },
    },
  },
  {
    id: "whatsapp",
    kind: "channel",
    labelKey: "whatsapp.label",
    descriptionKey: "whatsapp.description",
    iconName: "MessageCircle",
    tagsKey: "whatsapp.tags",
    payload: {
      name: "WhatsApp",
      type: "whatsapp",
      config: {},
    },
  },
  {
    id: "slack",
    kind: "channel",
    labelKey: "slack.label",
    descriptionKey: "slack.description",
    iconName: "Hash",
    tagsKey: "slack.tags",
    payload: {
      name: "Slack",
      type: "slack",
      config: {},
    },
  },
  {
    id: "email",
    kind: "channel",
    labelKey: "email.label",
    descriptionKey: "email.description",
    iconName: "Mail",
    tagsKey: "email.tags",
    payload: {
      name: "Email",
      type: "email",
      config: {},
    },
  },
  {
    id: "api",
    kind: "channel",
    labelKey: "api.label",
    descriptionKey: "api.description",
    iconName: "Webhook",
    tagsKey: "api.tags",
    payload: {
      name: "API",
      type: "api",
      config: {},
    },
  },
];

// -------------------------------------------------------------------------
// Registry — single source of truth + typed accessors
// -------------------------------------------------------------------------

interface TemplateRegistry {
  agent: CompassTemplate<AgentTemplatePayload>[];
  flow: CompassTemplate<FlowTemplatePayload>[];
  knowledge: CompassTemplate<KnowledgeTemplatePayload>[];
  channel: CompassTemplate<ChannelTemplatePayload>[];
}

export const COMPASS_TEMPLATES: TemplateRegistry = {
  agent: AGENT_TEMPLATES,
  flow: FLOW_TEMPLATES,
  knowledge: KNOWLEDGE_TEMPLATES,
  channel: CHANNEL_TEMPLATES,
};

/** Typed payload narrowing per kind. */
export type TemplatePayloadFor<K extends TemplateKind> = K extends "agent"
  ? AgentTemplatePayload
  : K extends "flow"
    ? FlowTemplatePayload
    : K extends "knowledge"
      ? KnowledgeTemplatePayload
      : K extends "channel"
        ? ChannelTemplatePayload
        : never;

/** Get the templates for a kind, with the blank card sorted first. */
export function getTemplatesFor<K extends TemplateKind>(
  kind: K
): CompassTemplate<TemplatePayloadFor<K>>[] {
  const list = COMPASS_TEMPLATES[kind] as CompassTemplate<TemplatePayloadFor<K>>[];
  return [...list].sort((a, b) => (a.blank === b.blank ? 0 : a.blank ? -1 : 1));
}

/** Look up a single template by kind + id. */
export function getTemplate<K extends TemplateKind>(
  kind: K,
  id: string
): CompassTemplate<TemplatePayloadFor<K>> | undefined {
  return getTemplatesFor(kind).find((t) => t.id === id);
}
