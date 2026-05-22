# UI Design System

**Canonical doc:** [`docs/UI-DESIGN-SYSTEM.md`](../../docs/UI-DESIGN-SYSTEM.md)
**Owner:** frontend

## Purpose
Fuente única de verdad del diseño de Orchester (tokens, tipografía, spacing,
componentes, shell, motion, reglas). **Toda UI nueva DEBE seguirla** para no
divergir. Este archivo es sólo un puntero — el contenido vive en
`docs/UI-DESIGN-SYSTEM.md`.

## Reglas no-negociables (resumen)
- **Dual-theme (light + dark) por tokens semánticos.** Superficies/bordes/texto
  neutro SIEMPRE con tokens (`bg-app/surface/card/elevated`, `border-line`,
  `bg-hover`, `text-strong/body/muted/faint`) — NUNCA `zinc`/`white` literales.
  `text-white` sólo sobre fondos de color. Probar AMBOS temas.
- Acento = **violet**; estados = emerald/amber/rose/blue con patrón
  `text-300 + bg-500/10 + border-500/30`.
- Radios: `rounded-2xl` cards, `rounded-xl` sub-bloques, `rounded-lg`
  botones/inputs/badges. Bordes `border-line`.
- Inputs HeroUI con `labelPlacement="outside"` + `text-foreground` (nunca
  `dark:text-default-*`). Forms con `flex flex-col gap-4` (no `space-y` con
  labels flotantes).
- Íconos: sólo lucide-react. Motion: variants de `@/lib/motion` + `APPLE_EASE`.

## Execution (changelog)

### 2026-05-22 — dual-theme (light + dark)
- Sistema de tokens semánticos (CSS vars en `globals.css`: `:root` light, `.dark`
  dark) mapeados en `tailwind.config.ts` (`app/surface/card/elevated/line/hover`
  + `text-strong/body/muted/faint`).
- Migrados shell + páginas autenticadas + componentes (78 archivos) de literales
  `zinc`/`white` a tokens. Re-habilitado el toggle de tema en el topbar.
- Verificado en browser: light y dark renderizan correctos, sin regresión en dark.

### 2026-05-21 — created
- Documentado el design system completo en `docs/UI-DESIGN-SYSTEM.md`.
- (Decisión inicial dark-only revertida el 2026-05-22 a favor de dual-theme real.)
- Fix: highlight activo del sidebar inseteado (`left-2 right-2`, antes `inset-0`
  chocaba con el borde derecho).
