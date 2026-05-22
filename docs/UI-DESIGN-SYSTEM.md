# Orchester — UI Design System

> **Propósito:** Fuente única de verdad del diseño de Orchester. Toda pantalla,
> componente o feature nueva DEBE seguir este documento para mantener coherencia
> visual. Si algo no está acá, buscá el patrón equivalente más cercano y copiá
> sus tokens — **nunca inventes una paleta, radio o spacing nuevo.**
>
> **Stack:** Next.js 15 (App Router) · Tailwind CSS 3 · HeroUI · framer-motion ·
> lucide-react · next-intl. Tipografías: Geist Sans / Geist Mono / Syne.

---

## 0. Reglas de oro (leer primero)

1. **Dual-theme vía tokens semánticos.** Orchester soporta **light + dark**. El
   tema se maneja con tokens CSS que cambian solos (`globals.css`: `:root` =
   light, `.dark` = dark). **Para superficies/bordes/texto neutro usá SIEMPRE
   los tokens semánticos** (`bg-app`, `bg-surface`, `bg-card`, `bg-elevated`,
   `border-line`, `bg-hover`, `text-strong`, `text-body`, `text-muted`,
   `text-faint`) — **NUNCA** `bg-zinc-*`, `text-zinc-*`, `border-white/[…]`
   literales. Esos no responden al tema y rompen el light mode.
2. **Paleta cerrada.** Neutros = tokens semánticos (regla #1). Acento =
   **violet**. Estados = emerald / amber / rose / blue (con alpha, funcionan en
   ambos temas). Nunca `gray`/`slate`/`neutral` ni colores sueltos.
3. **Radios fijos:** `rounded-2xl` (contenedores/cards), `rounded-xl` (sub-bloques
   e inputs grandes), `rounded-lg` (botones, inputs, badges, ítems de lista),
   `rounded-md` (chips pequeños), `rounded-full` (pills, avatares, dots).
4. **Bordes sutiles:** `border-line` (separadores/cards) y
   `border-line` (inputs/elementos interactivos). Nunca bordes opacos.
5. **HeroUI para formularios complejos** (Input, Button, Select, Avatar, Chip):
   siempre `labelPlacement="outside"` en Inputs y usá tokens semánticos
   (`text-foreground`, `bg-default-100`), NUNCA `text-default-900 dark:...`.
6. **Tailwind utilities para layout/cards** (la mayoría del shell). HeroUI sólo
   donde aporta (form controls con estados accesibles).
7. **Texto en español** en la UI de producto (es/en/pt-BR vía next-intl). Strings
   nuevas van al catálogo de traducción, no hardcodeadas, salvo páginas internas.

---

## 1. Tokens de color (semánticos — light + dark)

Definidos como CSS vars en `apps/web/app/globals.css` (`:root` light, `.dark`
dark) y mapeados a clases Tailwind en `tailwind.config.ts`. **Usar SIEMPRE estas
clases**, no literales `zinc`/`white`.

### Superficies (de atrás hacia adelante)
| Uso | Clase token | dark / light |
|-----|-------------|--------------|
| Página / fondo raíz | `bg-app` | negro / zinc-50 |
| Chrome (sidebar, topbar, drawer, modal) | `bg-surface` | zinc-950 / blanco |
| Card / panel | `bg-card` | `#121215` / blanco |
| Sub-bloque / input | `bg-elevated` | `#222226` / zinc-100 |
| Hover sutil / nav activo | `bg-hover` | zinc-800 / zinc-100 |

> Topbar translúcido: `bg-surface/80 backdrop-blur-md`. Overlays de modal/drawer:
> `bg-black/50`–`/60` (se dejan oscuros en ambos temas, es un scrim).

### Bordes
- `border-line` — todos los bordes y divisores (separadores, cards, inputs).
- Divisor vertical: `w-px bg-line`.

### Texto
| Nivel | Clase token |
|-------|-------------|
| Primario / títulos | `text-strong` |
| Secundario | `text-body` |
| Muted / labels | `text-muted` |
| Ultra-muted / hints | `text-faint` |
| Sobre fondo de color (botón violet, KPI) | `text-white` (queda fijo) |
| HeroUI (auto-contraste) | `text-foreground` / `text-default-500` |

> **Regla:** `text-white` SÓLO sobre fondos de color sólido (violet, gradientes,
> KPI cards). Sobre superficies neutras usá `text-strong` (en light, `text-white`
> sería invisible).

### Acento (marca) — Violet
- Base: `violet-500` (`#8b5cf6`). Hover: `violet-400`. Fondos: `violet-500/10`,
  `violet-500/15`. Borde: `violet-500/30`. Texto sobre fondo oscuro: `violet-300`.
- Gradiente de marca (logo, avatares): `bg-gradient-to-br from-violet-500 to-blue-500`
  (o `from-violet-600 to-blue-600`).
- Token Tailwind extendido disponible: `fichap-primary` (`#3B3BFF`) y
  `fichap-accent` (`#7C3AED`) — preferir las clases `violet-*` para consistencia.

### Estados (semánticos)
| Estado | Texto | Fondo | Borde |
|--------|-------|-------|-------|
| Éxito / online / OK | `text-emerald-300/400` | `bg-emerald-500/10..15` | `border-emerald-500/30` |
| Advertencia | `text-amber-300` | `bg-amber-500/10` | `border-amber-500/20..30` |
| Error / peligro | `text-rose-300` / `text-red-400` | `bg-rose-500/10` | `border-rose-500/30` |
| Info | `text-blue-400` | `bg-blue-500/10` | `border-blue-500/30` |

Regla: el patrón siempre es **`text-{color}-300` + `bg-{color}-500/10` +
`border-{color}-500/30`** para badges/callouts. No mezcles intensidades fuera de eso.

---

## 2. Tipografía

| Rol | Familia | Clase |
|-----|---------|-------|
| Display / títulos de página | Syne | `font-display` (ej. `font-display text-2xl font-bold tracking-tight`) |
| Body / UI | Geist Sans | default (`font-sans`) |
| Código / mono | Geist Mono | `font-mono` |

Escala típica:
- H1 página: `font-display text-2xl font-bold tracking-tight text-strong`
- H1 marketing/hero: `font-display text-4xl md:text-6xl font-bold`
- Subtítulo de página: `text-sm text-muted`
- Card title: `text-base font-semibold text-strong` (o `text-sm font-medium`)
- Label de sección (sidebar/grupos): `text-[9px] font-bold uppercase tracking-[0.15em] text-faint`
- Body card: `text-xs`/`text-[13px] leading-relaxed text-muted`
- Micro / metadata: `text-[10px]` / `text-[11px] text-faint`

---

## 3. Espaciado, radios y sombras

- **Radios:** ver Regla de oro #3.
- **Padding de card:** `p-4` (compacta) … `p-5`/`p-6` (cómoda).
- **Gaps de grid:** `gap-3` (listas de cards) con `md:grid-cols-2 lg:grid-cols-3`.
- **Spacing vertical de secciones:** `space-y-4` … `space-y-6`.
- **Formularios:** usar `flex flex-col gap-4` — **no** `space-y-*` con Inputs de
  HeroUI (el `margin-top` de la label flotante choca con `space-y`).
- **Sombras:** mínimas. Glow de acento sólo en CTAs/hero:
  `shadow-[0_0_40px_-10px_rgba(139,92,246,0.6)]`. Cards no llevan sombra dura.

---

## 4. Componentes (patrones canónicos)

### Card
```tsx
<div className="rounded-2xl border border-line bg-card p-4">
  …
</div>
```
Variante destacada (recomendado/seleccionado):
`border-violet-500/40 bg-card shadow-[0_0_60px_-20px_rgba(139,92,246,0.4)]`.

### Botones
- **Primario:** `rounded-lg bg-violet-500 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-40`.
- **Secundario / ghost:** `rounded-lg border border-line px-3 py-1.5 text-xs text-body hover:bg-hover`.
- **Peligro (icon):** `text-muted hover:text-rose-400`.
- HeroUI `Button color="primary"` → forzar `className="bg-[#3B3BFF] font-semibold"` o usar violet.

### Inputs
- **HeroUI (forms):** `<Input labelPlacement="outside" classNames={{ inputWrapper: "bg-default-100" }} />`.
- **Custom (filtros, search):** `rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong placeholder:text-faint outline-none focus:border-violet-500/60`.

### Badge / chip de estado
```tsx
<span className="flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
  <CheckCircle2 className="h-2.5 w-2.5" /> OK
</span>
```

### Callout (info/warn)
```tsx
<div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-200">…</div>
```

### Modal
Overlay `fixed inset-0 z-50 flex items-center justify-center p-4` + `absolute inset-0 bg-black/60` (click cierra) + panel
`relative w-full max-w-md rounded-2xl border border-line bg-surface p-5`. Header con título `font-display text-lg font-semibold` + botón `X` (`lucide` `X`, `text-muted hover:text-body`).

### Drawer (lateral)
`fixed inset-0 z-40 flex` → `flex-1 bg-black/50` (backdrop) + panel
`flex h-full w-[560px] flex-col border-l border-line bg-surface`.

### Lista / tabla
Filas: `border-b border-line bg-card px-4 py-3 text-xs hover:bg-card last:border-b-0`. Contenedor: `overflow-hidden rounded-2xl border border-line`.

### Empty state
Centro, `rounded-2xl border border-dashed border-line p-10 text-center` con ícono `lucide` `mx-auto mb-3 h-8 w-8 text-faint`, título `text-sm font-medium text-body` y subtítulo `text-xs text-muted`.

### Iconos
- Librería única: **lucide-react**. Tamaños: `h-4 w-4` (UI), `h-3.5 w-3.5` /
  `h-3 w-3` (inline/badges), `size={16}` en nav.
- Nunca mezclar otra librería de íconos. (`Github` está deprecado en lucide →
  usar `Code2` para GitHub.)

---

## 5. Shell & navegación

- **Sidebar** (`components/shell/Sidebar.tsx`): `bg-surface`, `border-r
  border-line`. Grupos con label `uppercase tracking-[0.15em] text-faint`
  separados por `border-t border-line`. Orden fijo: **Workspace ·
  Automatización · Datos · Sistema**.
- **Ítem activo** (`SidebarItem.tsx`): fondo `bg-hover` **inseteado**
  (`absolute inset-y-0 left-2 right-2`, NUNCA `inset-0` — choca con el borde) +
  barra violet `left-2.5 w-[3px] bg-violet-400`. Texto activo `text-strong`, ícono
  `text-violet-400`. Transición con `layoutId` (spring).
- **Topbar:** `h-14 bg-surface/80 backdrop-blur-md border-b`. Indicador "Live"
  (dot emerald con ping), modo presentación, **toggle de tema** (light/dark),
  selector de idioma, avatar.

---

## 6. Motion (framer-motion)

- Easing estándar: `APPLE_EASE = [0.25, 0.46, 0.45, 0.94]` (`@/lib/motion`).
- Variants reutilizables: `fadeIn`, `fadeInUp`, `fadeInDown`, `scaleIn`,
  `staggerContainer` + `staggerItem`, `sidebarVariants`. Usalos; no definas
  variants ad-hoc salvo necesidad real.
- Entradas de página/listas: `staggerContainer`/`staggerItem`. Transiciones de
  estado activo: `layoutId` + spring `{ stiffness: 500, damping: 35 }`.
- Duraciones: 0.2–0.4s. Nada más lento en UI (excepto hero).

---

## 7. Accesibilidad & i18n

- Todo control interactivo con texto o `aria-label`. Inputs con `<label>`
  asociado (`htmlFor`) o `aria-label`.
- Foco visible: `focus:border-violet-500/60` en inputs custom; HeroUI lo maneja.
- Strings de producto vía `next-intl` (`useTranslations`). No hardcodear en
  componentes de cara al usuario.
- Contraste: usar SIEMPRE los tokens de texto de §1 (`text-strong/body/muted/
  faint`). Nunca literales `text-zinc-*` — no responden al tema y rompen el light
  mode (texto claro sobre fondo claro = ilegible).

---

## 8. Checklist para una pantalla/feature nueva

- [ ] ¿Superficies/bordes/texto usan **tokens semánticos** (`bg-card`,
      `border-line`, `text-strong/body/muted/faint`) y NO literales `zinc`/`white`?
- [ ] ¿Probaste en **light Y dark**? (toggle en el topbar). ¿Nada ilegible?
- [ ] ¿`text-white` sólo sobre fondos de color (violet/gradiente/KPI)?
- [ ] ¿Card = `bg-card` + `border-line` + `rounded-2xl`?
- [ ] ¿Acento = violet, estados = emerald/amber/rose/blue con el patrón 300/500-10/500-30?
- [ ] ¿Títulos con `font-display`, jerarquía de texto según §2?
- [ ] ¿Inputs HeroUI con `labelPlacement="outside"` y forms con `flex flex-col gap-4`?
- [ ] ¿Íconos lucide, tamaños consistentes?
- [ ] ¿Strings traducibles? ¿`aria-label` en controles sin texto?
- [ ] ¿Motion con variants de `@/lib/motion` y `APPLE_EASE`?

> Si dudás, abrí un componente existente del mismo tipo (card → `IntegrationsClient`,
> drawer → `ConversationsClient`, form → `WelcomeStep`, tabla → conversaciones) y
> replicá sus clases. Consistencia > creatividad.
