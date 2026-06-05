import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { WidgetChat } from "@/components/channels/WidgetChat";

export const dynamic = "force-dynamic";

export default async function WidgetPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
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
          greeting={cfg.greeting ?? agent?.greeting ?? "Hola, ¿en qué puedo ayudarte?"}
          starters={(agent?.starters as string[]) ?? []}
          placeholder={cfg.placeholder ?? "Escribí un mensaje…"}
        />
      </body>
    </html>
  );
}
