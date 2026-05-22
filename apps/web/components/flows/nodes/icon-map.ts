import {
  Play, MessageSquare, Clock, Webhook, Bot, BookOpen, GitBranch, Split,
  Repeat, Rows3, LifeBuoy, Code2, Plug, Globe, Wand2, Table2, Timer, Bell,
  UserCheck, Workflow, StickyNote, Image, Binary, Box, type LucideIcon,
} from "lucide-react";

/**
 * Mapa nombre→ícono de lucide. Única fuente de verdad para los íconos de los
 * nodos, usada por la paleta y por los nodos del lienzo (así cada paso muestra
 * SU ícono y no uno genérico).
 */
export const NODE_ICONS: Record<string, LucideIcon> = {
  Play, MessageSquare, Clock, Webhook, Bot, BookOpen, GitBranch, Split,
  Repeat, Rows3, LifeBuoy, Code2, Plug, Globe, Wand2, Table2, Timer, Bell,
  UserCheck, Workflow, StickyNote, Image, Binary,
};

export function iconFor(name: string | undefined): LucideIcon {
  return (name && NODE_ICONS[name]) || Box;
}
