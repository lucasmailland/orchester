# UI Design System

**Canonical doc:** [`docs/UI-DESIGN-SYSTEM.md`](../../docs/UI-DESIGN-SYSTEM.md)
**Owner:** frontend

## Purpose
Fuente única de verdad del diseño de Orchester (tokens, tipografía, spacing,
componentes, shell, motion, reglas). **Toda UI nueva DEBE seguirla** para no
divergir. Este archivo es sólo un puntero — el contenido vive en
`docs/UI-DESIGN-SYSTEM.md`.

## Reglas no-negociables (resumen)
- **Dark-only.** No hay light mode ni toggles de tema.
- Acento = **violet**; estados = emerald/amber/rose/blue con patrón
  `text-300 + bg-500/10 + border-500/30`; neutros = escala **zinc** + `white/[op]`.
- Radios: `rounded-2xl` cards, `rounded-xl` sub-bloques, `rounded-lg`
  botones/inputs/badges. Bordes `white/[0.06]`–`[0.08]`.
- Inputs HeroUI con `labelPlacement="outside"` + `text-foreground` (nunca
  `dark:text-default-*`). Forms con `flex flex-col gap-4` (no `space-y` con
  labels flotantes).
- Íconos: sólo lucide-react. Motion: variants de `@/lib/motion` + `APPLE_EASE`.

## Execution (changelog)

### 2026-05-21 — created
- Documentado el design system completo en `docs/UI-DESIGN-SYSTEM.md`.
- Decisión **dark-only**: removido el toggle de tema (no funcionaba — todo el
  shell usa colores dark hardcodeados); `ThemeProvider forcedTheme="dark"`;
  eliminado el selector de tema en Ajustes.
- Fix: highlight activo del sidebar inseteado (`left-2 right-2`, antes `inset-0`
  chocaba con el borde derecho).
