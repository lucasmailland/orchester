# Settings — `/[locale]/settings`

> Estado: stable · Owner: platform · Última edición: 2026-05-06

## Planning

**Objetivo:** una sola pantalla densa donde owners y admins gestionan TODO lo
relacionado al workspace (datos, equipo, billing, devs) y donde cualquier user
controla SUS preferencias personales (nombre, idioma, tema, notificaciones).

**Por qué un solo `/settings` y no 3 pantallas:**
- "Cuenta" y "workspace" comparten la misma audiencia (admin sentado a hacer
  setup) y comparten widgets (validaciones de formularios, toggles).
- Romperlo en 3 rutas duplica navegación y código (3 layouts distintos).
- Una nav lateral interna con tabs es suficiente y más rápida (no hace
  navegación de páginas, sólo cambia el panel derecho).

**Restricciones:**
- 100% conectado al backend. Cero `useState` con datos persistentes que no
  hagan fetch/PATCH al endpoint correspondiente.
- Cada acción de mutación pasa por permission check en server (role).
- A11y: cada input tiene `id`+`name`+`label htmlFor`. Los toggles usan
  `role="switch"` + `aria-checked`.
- Compacta. Selects para listas de 3 opciones, NO grids de 3 botones gigantes.

## Layout

```
┌─────────────────────────────────────────────────────────┐
│ Ajustes                                                  │
│ Configuración del workspace                              │
│                                                          │
│ ┌──────────────┬─────────────────────────────────────┐  │
│ │ TABS NAV     │ Contenido del tab activo            │  │
│ │              │                                      │  │
│ │ ▸ General    │ ┌─────────────────────────────────┐ │  │
│ │ • Mi cuenta  │ │ <icon> Mi cuenta      [Guardar]│ │  │
│ │ • Notif.     │ │ Datos personales y prefs        │ │  │
│ │ • Prov. IA   │ │                                  │ │  │
│ │ • Plan       │ │ Nombre [____]   Email [_____]   │ │  │
│ │ • Equipo     │ │ Idioma [▼  ]    Tema [▼   ]     │ │  │
│ │ • Devs       │ └─────────────────────────────────┘ │  │
│ │ • Peligro    │                                      │  │
│ └──────────────┴─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Sidebar tabs** sticky (lg:sticky top-4). En móvil se vuelve scroll horizontal.
URL hash sincronizado: `/settings#account`, `/settings#providers`, etc.

## Tabs

| Tab | Sección | Edita | Roles que pueden editar |
| --- | --- | --- | --- |
| `general` | `GeneralSection` | workspace name, timezone | owner, admin |
| `account` | `AccountSection` | user name, locale, theme | self |
| `notifications` | `NotificationsSection` | 4 toggles personales | self |
| `providers` | `AIProvidersSection` | API keys de Anthropic/OpenAI/Google/Azure | owner, admin |
| `billing` | `BillingSection` | (read-only en self-host) | self-host: nadie. Stripe: owner |
| `members` | `MembersSection` | members CRUD + invites | owner, admin |
| `developers` | `DevelopersSection` | API keys + outbound webhooks | owner, admin |
| `danger` | `DangerZoneSection` | delete workspace | owner |

## Backend

### Endpoints

| Método | Ruta | Body / Query | Auth |
| --- | --- | --- | --- |
| GET | `/api/me` | — | session |
| PATCH | `/api/me` | `{ name?, preferredLocale?, preferredTheme? }` | session |
| GET | `/api/workspaces/[id]` | — | member |
| PATCH | `/api/workspaces/[id]` | `{ name?, timezone? }` | owner/admin |
| DELETE | `/api/workspaces/[id]?slug=<slug>` | — | owner |
| GET | `/api/notification-prefs` | — | session |
| PATCH | `/api/notification-prefs` | `{ key, enabled }` | session |
| GET | `/api/workspace-members` | — | member |
| PATCH | `/api/workspace-members?userId=&role=` | — | owner/admin |
| DELETE | `/api/workspace-members?userId=` | — | owner/admin |
| GET | `/api/invites` | — | member |
| POST | `/api/invites` | `{ email, role }` | owner/admin |
| DELETE | `/api/invites?id=` | — | owner/admin |
| GET | `/api/billing/usage` | — | session |
| GET, POST | `/api/providers` | `{ provider, apiKey, endpoint? }` | owner/admin |
| GET | `/api/providers?summary=1` | — | session |

### Validaciones server-side

- **`PATCH /api/me`**: `preferredLocale` ∈ `{en, es, pt-BR}`; `preferredTheme` ∈ `{light, dark, system}`; `name` ≤ 80 chars.
- **`PATCH /api/workspaces/[id]`**: `timezone` validado con `Intl.DateTimeFormat` (acepta cualquier IANA TZ); `name` ≤ 80.
- **`DELETE /api/workspaces/[id]`**: requiere `?slug=<exact_slug>` para evitar borrados accidentales. Solo `owner`.
- **`PATCH /api/workspace-members`**: no permite degradar al último owner; solo el owner puede promover a otro a owner.
- **`DELETE /api/workspace-members`**: no permite borrar a un owner.
- **`PATCH /api/notification-prefs`**: `key` debe estar en el catálogo `NOTIFICATION_KEYS`.

### Schema relevante

```sql
-- workspaces.timezone agregado (IANA, default UTC)
ALTER TABLE workspace ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';

-- nueva tabla de prefs
CREATE TABLE notification_pref (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,  -- null = workspace-level
  key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, user_id, key)
);
```

### Resolver de notification prefs

`GET /api/notification-prefs` devuelve, para cada key del catálogo:

```ts
{ key, label, description, enabled, source: "user" | "workspace" | "default" }
```

El resolver es: `user-pref → workspace-pref → default`. Permite que un workspace
fuerce un default distinto al global (e.g. fuerza weekly_report=ON para todos
sus miembros) y que cada user lo overridee.

## Frontend

### Composición

```
SettingsClient (tabs nav + dispatcher)
├── GeneralSection      → PATCH /api/workspaces/[id]
├── AccountSection      → PATCH /api/me   (re-route on locale change)
├── NotificationsSection → PATCH /api/notification-prefs (optimistic)
├── AIProvidersSection  → POST/DELETE /api/providers
├── BillingSection      → GET /api/billing/usage (read-only)
├── MembersSection      → /api/workspace-members + /api/invites
├── DevelopersSection   → /api/api-keys + /api/webhooks-out
└── DangerZoneSection   → DELETE /api/workspaces/[id]?slug=
```

### Primitives compartidas — `_layout.tsx`

- `<SettingsCard icon title description action>` — wrapper con header + slot
  para CTA primario inline.
- `<FieldRow>` — grid 2 columnas responsive.
- `<Field label htmlFor hint>` — label + input + hint micro.
- `<Toggle>` — switch a11y reusable.

### Reglas de UI

1. **Selects para 3+ opciones simples** (idioma, tema, role). Buttons sólo
   cuando el usuario debe ver TODAS las opciones constantemente (e.g. tabs).
2. **CTA inline en el header** del card (no flota al fondo). Reduce scroll y
   alinea con patrones modernos (Linear, Notion).
3. **Padding compacto**: `p-5` en cards, `space-y-3` entre fields. La densidad
   permite ver 3-4 secciones sin scrollear.
4. **`disabled` por permiso**: cuando el caller no tiene rol, los inputs se
   muestran pero quedan disabled con hint del rol actual. No los escondemos:
   da contexto.
5. **Optimistic updates** en toggles y selects que no validan vs server. Si el
   server rechaza, rollback + toast de error.

### Deep linking

URL hash determina la tab activa: `/settings#providers` abre directo en
proveedores. Lo usamos en redirects desde otros lugares de la app (e.g. el
banner "Tu proveedor está desconectado" del header global linkea acá con
`#providers`).

## Execution log

### 2026-05-06 — rebuild completo

Reemplaza versión anterior que tenía:
- 4 toggles de notificaciones que NO persistían (sólo useState)
- Selector de idioma que NO cambiaba la URL ni guardaba en DB
- Selector de tema que NO existía en DB
- "Eliminar Workspace" que tiraba `toast.error("modo demo")` en lugar de borrar
- Sección "Miembros del Equipo" hardcodeada con "Demo Admin"
- Sección "API Keys" duplicada con "Production Key" mock

**Cambios en backend:**
- ✅ `workspace.timezone` agregado al schema.
- ✅ Nueva tabla `notification_pref` con resolver user → workspace → default.
- ✅ `/api/me`: GET + PATCH (name, locale, theme).
- ✅ `/api/workspaces/[id]`: GET (read), PATCH (name+timezone), DELETE (con
  confirmación de slug + chequeo owner-only).
- ✅ `/api/notification-prefs`: GET resolver + PATCH upsert user-level.
- ✅ `/api/workspace-members`: GET (lista con role), PATCH (cambiar role),
  DELETE (remove). Garantiza que quede ≥1 owner.
- ✅ `/api/invites`: agregado DELETE para revocar.

**Cambios en UI:**
- ✅ Layout con sidebar tabs URL-driven (`#general`, `#account`, …, `#danger`).
- ✅ 8 secciones componentizadas en `apps/web/components/settings/*Section.tsx`.
- ✅ Primitives `_layout.tsx` (SettingsCard, FieldRow, Field, Toggle).
- ✅ AccountSection con `<select>` compactos (no grids 3-button gigantes).
- ✅ CTA inline en header de cada card (action slot).
- ✅ DangerZone con modal "type the slug to confirm" estilo GitHub.
- ✅ MembersSection: lista miembros activos + invitaciones pendientes con CRUD.

**Pendientes / next steps:**
- [ ] Email send real para invites (hoy sólo guarda el record, el send está
  mockeado en `lib/email.ts` con SMTP — funciona si configurás SMTP_HOST).
- [ ] `notification_pref.enabled` lo lee el resolver pero todavía no hay
  consumidor que mande mails — esto se cierra cuando se conecte el worker
  cron `usage:aggregate` con un mailer.
- [ ] Theme switcher actualmente sólo guarda en DB; falta wirearlo al
  ThemeProvider de next-themes para que cambie sin reload.
