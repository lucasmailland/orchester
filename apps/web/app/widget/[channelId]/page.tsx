import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { WidgetChat } from "@/components/channels/WidgetChat";

export const dynamic = "force-dynamic";

const LOCALE_DEFAULTS: Record<string, { greeting: string; placeholder: string }> = {
  es: { greeting: "Hola, ¿en qué puedo ayudarte?", placeholder: "Escribí un mensaje…" },
  en: { greeting: "Hi! How can I help you?", placeholder: "Type a message…" },
  pt: { greeting: "Olá! Como posso ajudar?", placeholder: "Escreva uma mensagem…" },
};

export default async function WidgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { channelId } = await params;
  const sp = await searchParams;
  const locale = (sp.locale ?? "es") in LOCALE_DEFAULTS ? (sp.locale ?? "es") : "es";
  const localeDefaults = LOCALE_DEFAULTS[locale]!;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .limit(1);
  const channel = rows[0];
  if (
    !channel ||
    (channel.type !== "widget" && channel.type !== "web") ||
    channel.status !== "active"
  ) {
    notFound();
  }

  // Fetch agent for greeting/branding
  const agentRows = channel.agentId
    ? await db.select().from(schema.agents).where(eq(schema.agents.id, channel.agentId)).limit(1)
    : [];
  const agent = agentRows[0];

  const cfg = (channel.config ?? {}) as {
    color?: string;
    greeting?: string;
    title?: string;
    placeholder?: string;
  };

  return (
    <html>
      <body style={{ margin: 0, padding: 0, fontFamily: "system-ui, sans-serif" }}>
        <WidgetChat
          channelId={channel.id}
          color={cfg.color ?? agent?.color ?? "#8b5cf6"}
          title={cfg.title ?? agent?.name ?? "Chat"}
          greeting={cfg.greeting ?? agent?.greeting ?? localeDefaults.greeting}
          starters={(agent?.starters as string[]) ?? []}
          placeholder={cfg.placeholder ?? localeDefaults.placeholder}
        />
      </body>
    </html>
  );
}
