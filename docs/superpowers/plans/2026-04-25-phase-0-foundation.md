# Orchester Phase 0 — Foundation & Visual Identity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the Orchester monorepo with Next.js 15, HeroUI v2, Tailwind CSS with Fichap design tokens, Framer Motion animations, dark/light theming, three-locale i18n (en, pt-BR, es), a fully animated Shell layout (topbar + sidebar), and Docker Compose for Postgres+pgvector, Redis, and Mailhog.

**Architecture:** pnpm workspaces + Turborepo monorepo. `apps/web` is a Next.js 15 App Router app with `[locale]` routing handled by next-intl middleware. Route groups separate auth pages (`(auth)`) from shell pages (`(shell)`). All providers (HeroUI, next-themes, next-intl) wrap at root layout. The widget will live in `apps/widget` (stubbed here, built in Phase 10).

**Tech Stack:** pnpm 9, Node.js 20+, Next.js 15, TypeScript 5 strict, HeroUI v2 (`@heroui/react`), Tailwind CSS 3, Framer Motion 11 (`motion`), next-intl 3, next-themes 0.4, Geist fonts (`next/font/google`), Lucide React, Vitest 2 + Testing Library.

---

## File Map

```
/dev/orchester/
├── package.json                         # pnpm workspaces root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .gitignore
├── .env.example
├── docker-compose.yml
├── apps/
│   ├── web/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── next.config.ts
│   │   ├── postcss.config.js
│   │   ├── tailwind.config.ts
│   │   ├── app/
│   │   │   ├── layout.tsx               # Root layout — html/body + all providers
│   │   │   ├── globals.css              # Tailwind directives + CSS variables
│   │   │   └── [locale]/
│   │   │       ├── layout.tsx           # NextIntlClientProvider
│   │   │       ├── (auth)/
│   │   │       │   └── login/
│   │   │       │       └── page.tsx     # Login placeholder
│   │   │       ├── (shell)/
│   │   │       │   ├── layout.tsx       # Shell layout — sidebar + topbar
│   │   │       │   └── page.tsx         # Dashboard placeholder
│   │   │       └── showcase/
│   │   │           ├── loading/
│   │   │           │   └── page.tsx     # Loading/skeleton showcase
│   │   │           └── empty/
│   │   │               └── page.tsx     # Empty state showcase
│   │   ├── components/
│   │   │   └── shell/
│   │   │       ├── Shell.tsx            # Root shell wrapper (sidebar + main area)
│   │   │       ├── Sidebar.tsx          # Animated sidebar with nav items
│   │   │       ├── SidebarItem.tsx      # Single nav item with animated indicator
│   │   │       ├── Topbar.tsx           # Top navigation bar
│   │   │       ├── ThemeToggle.tsx      # Dark/light toggle button
│   │   │       ├── LanguageSelector.tsx # Locale switcher dropdown
│   │   │       └── PresentationMode.tsx # Presentation mode context + toggle
│   │   ├── i18n/
│   │   │   └── routing.ts              # next-intl defineRouting
│   │   ├── lib/
│   │   │   └── motion.ts               # Shared Framer Motion variants
│   │   ├── messages/
│   │   │   ├── en.json
│   │   │   ├── pt-BR.json
│   │   │   └── es.json
│   │   └── middleware.ts               # next-intl locale routing
│   └── widget/
│       └── package.json                # Stub for Phase 10
├── packages/
│   └── db/
│       ├── package.json
│       ├── src/
│       │   ├── index.ts                # Re-exports client + schema
│       │   └── client.ts              # Drizzle client + pool config
│       └── tsconfig.json
└── docs/
    └── superpowers/
        └── plans/
            └── 2026-04-25-phase-0-foundation.md  # This file
```

---

## Task 1: Root Monorepo Scaffold

**Files:**
- Create: `/dev/orchester/package.json`
- Create: `/dev/orchester/pnpm-workspace.yaml`
- Create: `/dev/orchester/turbo.json`
- Create: `/dev/orchester/tsconfig.base.json`
- Create: `/dev/orchester/.gitignore`
- Create: `/dev/orchester/.env.example`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "orchester",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "db:migrate": "pnpm --filter @orchester/db migrate",
    "db:seed": "pnpm --filter @orchester/db seed",
    "worker": "pnpm --filter @orchester/workers dev"
  },
  "devDependencies": {
    "turbo": "^2.3.3",
    "typescript": "^5.7.2"
  },
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 4: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "dom", "dom.iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "declaration": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
.next/
dist/
build/
.turbo/
.env
.env.local
*.log
.DS_Store
coverage/
.vercel/
```

- [ ] **Step 6: Create .env.example**

```bash
# ─── DATABASE ────────────────────────────────────────────────────────────────
DATABASE_URL="postgresql://orchester:orchester@localhost:5432/orchester"

# ─── REDIS ───────────────────────────────────────────────────────────────────
REDIS_URL="redis://localhost:6379"

# ─── AUTH ────────────────────────────────────────────────────────────────────
AUTH_SECRET="generate-with: openssl rand -base64 32"
AUTH_URL="http://localhost:3000"

# ─── GOOGLE OAUTH (optional, for SSO) ────────────────────────────────────────
# GOOGLE_CLIENT_ID=""
# GOOGLE_CLIENT_SECRET=""

# ─── AI PROVIDERS ────────────────────────────────────────────────────────────
# ANTHROPIC_API_KEY=""
# OPENAI_API_KEY=""
# GOOGLE_AI_API_KEY=""

# ─── ENCRYPTION ──────────────────────────────────────────────────────────────
ENCRYPTION_KEY="generate-with: openssl rand -hex 32"

# ─── STORAGE ─────────────────────────────────────────────────────────────────
STORAGE_DRIVER="local"   # "local" | "s3"
STORAGE_LOCAL_PATH="./uploads"

# ─── MAIL ────────────────────────────────────────────────────────────────────
MAIL_DRIVER="smtp"       # "smtp" | "ses" | "console"
SMTP_HOST="localhost"
SMTP_PORT="1025"
SMTP_USER=""
SMTP_PASS=""
MAIL_FROM="noreply@orchester.io"

# ─── APP ─────────────────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NODE_ENV="development"

# ─── FEATURE FLAGS ───────────────────────────────────────────────────────────
ENABLE_BULL_BOARD="false"
ENABLE_LANGFUSE="false"
```

- [ ] **Step 7: Initialize git and install dependencies**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git init
cp .env.example .env
pnpm install
```

Expected: `Lockfile was successfully patched.` or similar.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "chore: init monorepo scaffold with turbo + pnpm workspaces"
```

---

## Task 2: apps/web Next.js 15 Bootstrap

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/postcss.config.js`

- [ ] **Step 1: Create apps/web/package.json**

```json
{
  "name": "@orchester/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "^15.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@heroui/react": "^2.7.6",
    "framer-motion": "^11.15.0",
    "next-intl": "^3.26.3",
    "next-themes": "^0.4.4",
    "lucide-react": "^0.469.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "tailwindcss": "^3.4.17",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "eslint": "^9.17.0",
    "eslint-config-next": "^15.3.0",
    "vitest": "^2.1.8",
    "@vitejs/plugin-react": "^4.3.4",
    "@testing-library/react": "^16.1.0",
    "@testing-library/jest-dom": "^6.6.3",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 2: Create apps/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    },
    "jsx": "preserve",
    "incremental": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create apps/web/next.config.ts**

```ts
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/routing.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    optimizePackageImports: ["@heroui/react", "lucide-react"],
  },
};

export default withNextIntl(nextConfig);
```

- [ ] **Step 4: Create apps/web/postcss.config.js**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 5: Install deps**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
pnpm install
```

Expected: workspace packages resolved, no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/
git commit -m "chore: add apps/web Next.js 15 package config"
```

---

## Task 3: HeroUI v2 + Tailwind + Fichap Design Tokens

**Files:**
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/app/globals.css`

- [ ] **Step 1: Write test for design token exports**

Create `apps/web/__tests__/design-tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";

// Snapshot test: ensure the tailwind config includes all required Fichap tokens
describe("Design tokens", () => {
  it("tailwind config exports a valid config object", async () => {
    const config = await import("../tailwind.config");
    expect(config.default).toBeDefined();
    expect(config.default.theme?.extend?.colors).toBeDefined();
  });

  it("fichap color tokens are defined", async () => {
    const config = await import("../tailwind.config");
    const colors = config.default.theme?.extend?.colors as Record<string, unknown>;
    expect(colors["fichap"]).toBeDefined();
    const fichap = colors["fichap"] as Record<string, unknown>;
    expect(fichap["primary"]).toBeDefined();
    expect(fichap["accent"]).toBeDefined();
    expect(fichap["success"]).toBeDefined();
    expect(fichap["warning"]).toBeDefined();
    expect(fichap["danger"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd apps/web
pnpm test -- --reporter=verbose design-tokens
```

Expected: FAIL — `Cannot find module '../tailwind.config'`

- [ ] **Step 3: Create apps/web/tailwind.config.ts**

```ts
import type { Config } from "tailwindcss";
import { heroui } from "@heroui/react";
import { fontFamily } from "tailwindcss/defaultTheme";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", ...fontFamily.sans],
        mono: ["var(--font-geist-mono)", ...fontFamily.mono],
      },
      colors: {
        fichap: {
          primary: {
            DEFAULT: "#3B3BFF",
            subtle: "#F0F0FF",
            emphasis: "#1A1AFF",
            foreground: "#FFFFFF",
          },
          accent: {
            DEFAULT: "#7C3AED",
            subtle: "#F5F3FF",
            foreground: "#FFFFFF",
          },
          success: {
            DEFAULT: "#22C55E",
            subtle: "#F0FDF4",
            foreground: "#FFFFFF",
          },
          warning: {
            DEFAULT: "#F59E0B",
            subtle: "#FFFBEB",
            foreground: "#FFFFFF",
          },
          danger: {
            DEFAULT: "#EF4444",
            subtle: "#FEF2F2",
            foreground: "#FFFFFF",
          },
        },
      },
      borderRadius: {
        sm: "0.375rem",
        DEFAULT: "0.5rem",
        md: "0.625rem",
        lg: "0.75rem",
        xl: "1rem",
        "2xl": "1.25rem",
      },
      transitionTimingFunction: {
        apple: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      },
    },
  },
  plugins: [
    heroui({
      themes: {
        light: {
          colors: {
            primary: {
              DEFAULT: "#3B3BFF",
              foreground: "#ffffff",
              50: "#F0F0FF",
              100: "#E0E0FF",
              200: "#C7C7FF",
              300: "#A5A5FF",
              400: "#7272FF",
              500: "#3B3BFF",
              600: "#1A1AFF",
              700: "#0000E0",
              800: "#0000B0",
              900: "#000080",
            },
            secondary: {
              DEFAULT: "#7C3AED",
              foreground: "#ffffff",
            },
            success: { DEFAULT: "#22C55E" },
            warning: { DEFAULT: "#F59E0B" },
            danger: { DEFAULT: "#EF4444" },
          },
        },
        dark: {
          colors: {
            primary: {
              DEFAULT: "#6060FF",
              foreground: "#ffffff",
              50: "#1A1A3E",
              100: "#1E1E50",
              200: "#2A2A70",
              300: "#3535A0",
              400: "#4545CC",
              500: "#6060FF",
              600: "#8080FF",
              700: "#A0A0FF",
              800: "#C0C0FF",
              900: "#E0E0FF",
            },
            secondary: {
              DEFAULT: "#9B6FFF",
              foreground: "#ffffff",
            },
          },
        },
      },
    }),
  ],
};

export default config;
```

- [ ] **Step 4: Create apps/web/app/globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --fichap-primary: 59 59 255;
    --fichap-primary-subtle: 240 240 255;
    --fichap-accent: 124 58 237;
    --fichap-success: 34 197 94;
    --fichap-warning: 245 158 11;
    --fichap-danger: 239 68 68;

    --sidebar-width: 240px;
    --sidebar-collapsed-width: 64px;
    --topbar-height: 56px;
  }

  * {
    scrollbar-width: thin;
    scrollbar-color: rgb(var(--fichap-primary) / 0.15) transparent;
  }

  *::-webkit-scrollbar {
    width: 5px;
  }

  *::-webkit-scrollbar-track {
    background: transparent;
  }

  *::-webkit-scrollbar-thumb {
    background-color: rgb(var(--fichap-primary) / 0.15);
    border-radius: 9999px;
  }
}
```

- [ ] **Step 5: Run test — verify it passes**

```bash
cd apps/web
pnpm test -- --reporter=verbose design-tokens
```

Expected: PASS — 2 tests

- [ ] **Step 6: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/tailwind.config.ts apps/web/app/globals.css apps/web/__tests__/
git commit -m "feat: add Tailwind config with Fichap design tokens and HeroUI v2"
```

---

## Task 4: Providers — HeroUI + next-themes (Root Layout)

**Files:**
- Create: `apps/web/components/providers/Providers.tsx`
- Create: `apps/web/app/layout.tsx`

- [ ] **Step 1: Create apps/web/components/providers/Providers.tsx**

```tsx
"use client";

import { HeroUIProvider } from "@heroui/react";
import { ThemeProvider } from "next-themes";

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <HeroUIProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange={false}
      >
        {children}
      </ThemeProvider>
    </HeroUIProvider>
  );
}
```

- [ ] **Step 2: Create apps/web/app/layout.tsx**

```tsx
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/providers/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    template: "%s | Orchester",
    default: "Orchester — AI Agent Platform",
  },
  description: "Build teams of AI agents for your enterprise in minutes.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Install Geist fonts**

```bash
cd apps/web
pnpm add geist
```

Expected: `+ geist X.X.X`

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/web
pnpm exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/components/ apps/web/app/layout.tsx
git commit -m "feat: add HeroUI + next-themes root providers and root layout"
```

---

## Task 5: next-intl — Routing, Middleware, Messages

**Files:**
- Create: `apps/web/i18n/routing.ts`
- Create: `apps/web/middleware.ts`
- Create: `apps/web/messages/en.json`
- Create: `apps/web/messages/pt-BR.json`
- Create: `apps/web/messages/es.json`
- Create: `apps/web/app/[locale]/layout.tsx`
- Test: `apps/web/__tests__/i18n-routing.test.ts`

- [ ] **Step 1: Write failing test for locale routing**

Create `apps/web/__tests__/i18n-routing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { routing } from "../i18n/routing";

describe("i18n routing", () => {
  it("supports exactly three locales", () => {
    expect(routing.locales).toEqual(["en", "pt-BR", "es"]);
  });

  it("defaults to English", () => {
    expect(routing.defaultLocale).toBe("en");
  });

  it("includes all required locales", () => {
    expect(routing.locales).toContain("en");
    expect(routing.locales).toContain("pt-BR");
    expect(routing.locales).toContain("es");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd apps/web
pnpm test -- --reporter=verbose i18n-routing
```

Expected: FAIL — `Cannot find module '../i18n/routing'`

- [ ] **Step 3: Create apps/web/i18n/routing.ts**

```ts
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "pt-BR", "es"],
  defaultLocale: "en",
  localePrefix: "always",
});
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd apps/web
pnpm test -- --reporter=verbose i18n-routing
```

Expected: PASS — 3 tests

- [ ] **Step 5: Create apps/web/middleware.ts**

```ts
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|widget|c).*)",
  ],
};
```

- [ ] **Step 6: Create apps/web/messages/en.json**

```json
{
  "nav": {
    "home": "Home",
    "teams": "Teams",
    "agents": "Agents",
    "conversations": "Conversations",
    "employees": "Employees",
    "channels": "Channels",
    "integrations": "Integrations",
    "usage": "Usage",
    "settings": "Settings"
  },
  "common": {
    "loading": "Loading…",
    "error": "Something went wrong",
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "edit": "Edit",
    "create": "Create",
    "search": "Search",
    "noResults": "No results found",
    "learnMore": "Learn more"
  },
  "themes": {
    "light": "Light",
    "dark": "Dark",
    "system": "System"
  },
  "presentationMode": {
    "enable": "Enable presentation mode",
    "disable": "Disable presentation mode"
  },
  "emptyStates": {
    "teams": {
      "title": "No teams yet",
      "description": "Create your first AI team and let them work for you.",
      "cta": "Create a team"
    },
    "agents": {
      "title": "No agents here",
      "description": "Agents are the building blocks of your AI teams.",
      "cta": "Add an agent"
    },
    "conversations": {
      "title": "No conversations yet",
      "description": "Conversations will appear here once employees start chatting.",
      "cta": "Set up a channel"
    },
    "employees": {
      "title": "No employees loaded",
      "description": "Import your team via CSV or add them one by one.",
      "cta": "Import employees"
    }
  }
}
```

- [ ] **Step 7: Create apps/web/messages/pt-BR.json**

```json
{
  "nav": {
    "home": "Início",
    "teams": "Equipes",
    "agents": "Agentes",
    "conversations": "Conversas",
    "employees": "Colaboradores",
    "channels": "Canais",
    "integrations": "Integrações",
    "usage": "Uso",
    "settings": "Configurações"
  },
  "common": {
    "loading": "Carregando…",
    "error": "Algo deu errado",
    "save": "Salvar",
    "cancel": "Cancelar",
    "delete": "Excluir",
    "edit": "Editar",
    "create": "Criar",
    "search": "Buscar",
    "noResults": "Nenhum resultado encontrado",
    "learnMore": "Saiba mais"
  },
  "themes": {
    "light": "Claro",
    "dark": "Escuro",
    "system": "Sistema"
  },
  "presentationMode": {
    "enable": "Ativar modo apresentação",
    "disable": "Desativar modo apresentação"
  },
  "emptyStates": {
    "teams": {
      "title": "Nenhuma equipe ainda",
      "description": "Crie sua primeira equipe de IA e deixe-a trabalhar por você.",
      "cta": "Criar uma equipe"
    },
    "agents": {
      "title": "Nenhum agente aqui",
      "description": "Os agentes são os blocos construtores das suas equipes de IA.",
      "cta": "Adicionar um agente"
    },
    "conversations": {
      "title": "Nenhuma conversa ainda",
      "description": "As conversas aparecerão aqui quando os colaboradores começarem a usar.",
      "cta": "Configurar um canal"
    },
    "employees": {
      "title": "Nenhum colaborador carregado",
      "description": "Importe sua equipe via CSV ou adicione um por um.",
      "cta": "Importar colaboradores"
    }
  }
}
```

- [ ] **Step 8: Create apps/web/messages/es.json**

```json
{
  "nav": {
    "home": "Inicio",
    "teams": "Equipos",
    "agents": "Agentes",
    "conversations": "Conversaciones",
    "employees": "Empleados",
    "channels": "Canales",
    "integrations": "Integraciones",
    "usage": "Uso",
    "settings": "Configuración"
  },
  "common": {
    "loading": "Cargando…",
    "error": "Algo salió mal",
    "save": "Guardar",
    "cancel": "Cancelar",
    "delete": "Eliminar",
    "edit": "Editar",
    "create": "Crear",
    "search": "Buscar",
    "noResults": "Sin resultados",
    "learnMore": "Más información"
  },
  "themes": {
    "light": "Claro",
    "dark": "Oscuro",
    "system": "Sistema"
  },
  "presentationMode": {
    "enable": "Activar modo presentación",
    "disable": "Desactivar modo presentación"
  },
  "emptyStates": {
    "teams": {
      "title": "Aún no hay equipos",
      "description": "Crea tu primer equipo de IA y déjalo trabajar para ti.",
      "cta": "Crear un equipo"
    },
    "agents": {
      "title": "Sin agentes aquí",
      "description": "Los agentes son los bloques fundamentales de tus equipos de IA.",
      "cta": "Agregar un agente"
    },
    "conversations": {
      "title": "Aún no hay conversaciones",
      "description": "Las conversaciones aparecerán aquí cuando los empleados empiecen a chatear.",
      "cta": "Configurar un canal"
    },
    "employees": {
      "title": "Sin empleados cargados",
      "description": "Importa tu equipo por CSV o agrégalos uno a uno.",
      "cta": "Importar empleados"
    }
  }
}
```

- [ ] **Step 9: Create apps/web/app/[locale]/layout.tsx**

```tsx
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
```

- [ ] **Step 10: Verify TypeScript compiles**

```bash
cd apps/web
pnpm exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 11: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/i18n/ apps/web/middleware.ts apps/web/messages/ apps/web/app/\[locale\]/layout.tsx apps/web/__tests__/
git commit -m "feat: add next-intl routing, middleware, and three-locale messages"
```

---

## Task 6: Framer Motion Animation System

**Files:**
- Create: `apps/web/lib/motion.ts`
- Test: `apps/web/__tests__/motion.test.ts`

- [ ] **Step 1: Write failing tests for motion variants**

Create `apps/web/__tests__/motion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  fadeIn,
  fadeInUp,
  staggerContainer,
  scaleIn,
  slideInLeft,
  cardHover,
} from "../lib/motion";

describe("Motion variants", () => {
  it("fadeIn has hidden and visible states", () => {
    expect(fadeIn.hidden).toBeDefined();
    expect(fadeIn.visible).toBeDefined();
    expect((fadeIn.hidden as { opacity: number }).opacity).toBe(0);
    expect((fadeIn.visible as { opacity: number }).opacity).toBe(1);
  });

  it("fadeInUp moves element upward on enter", () => {
    const hidden = fadeInUp.hidden as { opacity: number; y: number };
    const visible = fadeInUp.visible as { opacity: number; y: number };
    expect(hidden.y).toBeGreaterThan(0);
    expect(visible.y).toBe(0);
    expect(visible.opacity).toBe(1);
  });

  it("staggerContainer has staggerChildren", () => {
    const visible = staggerContainer.visible as {
      transition: { staggerChildren: number };
    };
    expect(visible.transition.staggerChildren).toBeGreaterThan(0);
  });

  it("cardHover has rest and hover states", () => {
    expect(cardHover.rest).toBeDefined();
    expect(cardHover.hover).toBeDefined();
  });

  it("scaleIn starts below scale 1", () => {
    const hidden = scaleIn.hidden as { scale: number };
    expect(hidden.scale).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd apps/web
pnpm test -- --reporter=verbose motion
```

Expected: FAIL — `Cannot find module '../lib/motion'`

- [ ] **Step 3: Create apps/web/lib/motion.ts**

```ts
import type { Variants } from "framer-motion";

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

export const fadeInDown: Variants = {
  hidden: { opacity: 0, y: -16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: {
    opacity: 0,
    scale: 0.92,
    transition: { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

export const cardHover: Variants = {
  rest: {
    y: 0,
    boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.1)",
    transition: { duration: 0.2, ease: "easeOut" },
  },
  hover: {
    y: -2,
    boxShadow: "0 10px 25px -5px rgb(0 0 0 / 0.15)",
    transition: { duration: 0.2, ease: "easeOut" },
  },
};

export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: 8 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 8,
    transition: { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

export const sidebarVariants = {
  expanded: { width: "var(--sidebar-width)" },
  collapsed: { width: "var(--sidebar-collapsed-width)" },
};

export const APPLE_EASE = [0.25, 0.46, 0.45, 0.94] as const;
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd apps/web
pnpm test -- --reporter=verbose motion
```

Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/lib/motion.ts apps/web/__tests__/motion.test.ts
git commit -m "feat: add Framer Motion animation variants library"
```

---

## Task 7: Presentation Mode Context

**Files:**
- Create: `apps/web/components/providers/PresentationModeProvider.tsx`
- Test: `apps/web/__tests__/presentation-mode.test.tsx`

The presentation mode hides cost figures, beta badges, and admin-only UI when demoing to clients. It must be accessible throughout the app.

- [ ] **Step 1: Write failing tests**

Create `apps/web/__tests__/presentation-mode.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  PresentationModeProvider,
  usePresentationMode,
} from "../components/providers/PresentationModeProvider";

function TestConsumer() {
  const { isPresenting, toggle } = usePresentationMode();
  return (
    <div>
      <span data-testid="status">{isPresenting ? "presenting" : "normal"}</span>
      <button onClick={toggle}>toggle</button>
    </div>
  );
}

describe("PresentationModeProvider", () => {
  it("starts in normal mode", () => {
    render(
      <PresentationModeProvider>
        <TestConsumer />
      </PresentationModeProvider>
    );
    expect(screen.getByTestId("status").textContent).toBe("normal");
  });

  it("toggles to presenting mode", () => {
    render(
      <PresentationModeProvider>
        <TestConsumer />
      </PresentationModeProvider>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("status").textContent).toBe("presenting");
  });

  it("toggles back to normal mode", () => {
    render(
      <PresentationModeProvider>
        <TestConsumer />
      </PresentationModeProvider>
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("status").textContent).toBe("normal");
  });
});
```

- [ ] **Step 2: Create vitest.config.ts**

Create `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
```

Create `apps/web/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom";
```

- [ ] **Step 3: Run test — verify it fails**

```bash
cd apps/web
pnpm test -- --reporter=verbose presentation-mode
```

Expected: FAIL — `Cannot find module '../components/providers/PresentationModeProvider'`

- [ ] **Step 4: Create apps/web/components/providers/PresentationModeProvider.tsx**

```tsx
"use client";

import { createContext, useContext, useState } from "react";

interface PresentationModeContextValue {
  isPresenting: boolean;
  toggle: () => void;
  enable: () => void;
  disable: () => void;
}

const PresentationModeContext = createContext<PresentationModeContextValue | null>(null);

export function PresentationModeProvider({ children }: { children: React.ReactNode }) {
  const [isPresenting, setIsPresenting] = useState(false);

  const toggle = () => setIsPresenting((prev) => !prev);
  const enable = () => setIsPresenting(true);
  const disable = () => setIsPresenting(false);

  return (
    <PresentationModeContext.Provider value={{ isPresenting, toggle, enable, disable }}>
      {children}
    </PresentationModeContext.Provider>
  );
}

export function usePresentationMode(): PresentationModeContextValue {
  const ctx = useContext(PresentationModeContext);
  if (!ctx) {
    throw new Error("usePresentationMode must be used inside PresentationModeProvider");
  }
  return ctx;
}
```

- [ ] **Step 5: Add PresentationModeProvider to apps/web/components/providers/Providers.tsx**

Replace the file content:

```tsx
"use client";

import { HeroUIProvider } from "@heroui/react";
import { ThemeProvider } from "next-themes";
import { PresentationModeProvider } from "./PresentationModeProvider";

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <HeroUIProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange={false}
      >
        <PresentationModeProvider>
          {children}
        </PresentationModeProvider>
      </ThemeProvider>
    </HeroUIProvider>
  );
}
```

- [ ] **Step 6: Run test — verify it passes**

```bash
cd apps/web
pnpm test -- --reporter=verbose presentation-mode
```

Expected: PASS — 3 tests

- [ ] **Step 7: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/components/providers/ apps/web/vitest.config.ts apps/web/vitest.setup.ts apps/web/__tests__/presentation-mode.test.tsx
git commit -m "feat: add PresentationModeProvider context with toggle"
```

---

## Task 8: Shell Layout — Sidebar

**Files:**
- Create: `apps/web/components/shell/Sidebar.tsx`
- Create: `apps/web/components/shell/SidebarItem.tsx`
- Create: `apps/web/app/[locale]/(shell)/layout.tsx`
- Create: `apps/web/app/[locale]/(shell)/page.tsx`

- [ ] **Step 1: Create apps/web/components/shell/SidebarItem.tsx**

```tsx
"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface SidebarItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
}

export function SidebarItem({ href, icon, label, collapsed }: SidebarItemProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link href={href} className="relative block px-2">
      {isActive && (
        <motion.div
          layoutId="sidebar-active-indicator"
          className="absolute inset-0 rounded-lg bg-fichap-primary/10 dark:bg-fichap-primary/20"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
      <div
        className={cn(
          "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
          "hover:bg-fichap-primary/5 dark:hover:bg-fichap-primary/10",
          isActive
            ? "text-fichap-primary dark:text-fichap-primary"
            : "text-default-600 hover:text-default-900 dark:text-default-400 dark:hover:text-default-100"
        )}
      >
        <span className={cn("flex-shrink-0 transition-transform duration-150", isActive && "scale-110")}>
          {icon}
        </span>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="overflow-hidden whitespace-nowrap"
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Create apps/web/lib/utils.ts** (needed by SidebarItem)

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Create apps/web/components/shell/Sidebar.tsx**

```tsx
"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Home,
  Users,
  Bot,
  MessageSquare,
  Plug,
  Radio,
  BarChart3,
  Settings,
  ChevronLeft,
} from "lucide-react";
import { SidebarItem } from "./SidebarItem";
import { sidebarVariants, APPLE_EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface SidebarProps {
  locale: string;
}

export function Sidebar({ locale }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const t = useTranslations("nav");

  const navItems = [
    { href: `/${locale}`, icon: <Home size={18} />, label: t("home") },
    { href: `/${locale}/teams`, icon: <Users size={18} />, label: t("teams") },
    { href: `/${locale}/agents`, icon: <Bot size={18} />, label: t("agents") },
    { href: `/${locale}/conversations`, icon: <MessageSquare size={18} />, label: t("conversations") },
    { href: `/${locale}/employees`, icon: <Users size={18} />, label: t("employees") },
    { href: `/${locale}/channels`, icon: <Radio size={18} />, label: t("channels") },
    { href: `/${locale}/integrations`, icon: <Plug size={18} />, label: t("integrations") },
    { href: `/${locale}/usage`, icon: <BarChart3 size={18} />, label: t("usage") },
    { href: `/${locale}/settings`, icon: <Settings size={18} />, label: t("settings") },
  ];

  return (
    <motion.aside
      variants={sidebarVariants}
      animate={collapsed ? "collapsed" : "expanded"}
      transition={{ duration: 0.25, ease: APPLE_EASE }}
      className={cn(
        "relative flex h-full flex-col border-r border-default-100 bg-background",
        "dark:border-default-50/20"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center px-4">
        <motion.div
          animate={{ opacity: collapsed ? 0 : 1, scale: collapsed ? 0.8 : 1 }}
          transition={{ duration: 0.2 }}
          className="flex items-center gap-2"
        >
          {!collapsed && (
            <span className="text-lg font-bold tracking-tight text-fichap-primary">
              Orchester
            </span>
          )}
          {collapsed && (
            <span className="text-lg font-bold text-fichap-primary">O</span>
          )}
        </motion.div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-2">
        <div className="flex flex-col gap-0.5">
          {navItems.map((item) => (
            <SidebarItem key={item.href} {...item} collapsed={collapsed} />
          ))}
        </div>
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-default-100 p-2 dark:border-default-50/20">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            "flex w-full items-center justify-center rounded-lg p-2",
            "text-default-400 hover:bg-default-100 hover:text-default-700",
            "dark:hover:bg-default-50/10 dark:hover:text-default-300",
            "transition-colors duration-150"
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <motion.div
            animate={{ rotate: collapsed ? 180 : 0 }}
            transition={{ duration: 0.25, ease: APPLE_EASE }}
          >
            <ChevronLeft size={16} />
          </motion.div>
        </button>
      </div>
    </motion.aside>
  );
}
```

- [ ] **Step 4: Create apps/web/app/[locale]/(shell)/layout.tsx**

```tsx
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";

export default async function ShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <div className="flex h-screen overflow-hidden bg-default-50 dark:bg-default-50/5">
      <Sidebar locale={locale} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar locale={locale} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create apps/web/app/[locale]/(shell)/page.tsx**

```tsx
import { useTranslations } from "next-intl";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-default-500">Phase 1 will build this out.</p>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/components/shell/Sidebar.tsx apps/web/components/shell/SidebarItem.tsx apps/web/lib/utils.ts apps/web/app/
git commit -m "feat: add animated sidebar with collapse, active indicator, and nav items"
```

---

## Task 9: Shell Layout — Topbar

**Files:**
- Create: `apps/web/components/shell/ThemeToggle.tsx`
- Create: `apps/web/components/shell/LanguageSelector.tsx`
- Create: `apps/web/components/shell/PresentationModeToggle.tsx`
- Create: `apps/web/components/shell/Topbar.tsx`

- [ ] **Step 1: Create apps/web/components/shell/ThemeToggle.tsx**

```tsx
"use client";

import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import { Sun, Moon } from "lucide-react";
import { Button } from "@heroui/react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-8 w-8 rounded-lg bg-default-100" />;
  }

  const isDark = theme === "dark";

  return (
    <Button
      isIconOnly
      variant="light"
      size="sm"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="text-default-500 hover:text-default-900 dark:hover:text-default-100"
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.div
            key="sun"
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Sun size={16} />
          </motion.div>
        ) : (
          <motion.div
            key="moon"
            initial={{ rotate: 90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: -90, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Moon size={16} />
          </motion.div>
        )}
      </AnimatePresence>
    </Button>
  );
}
```

- [ ] **Step 2: Create apps/web/components/shell/LanguageSelector.tsx**

```tsx
"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button } from "@heroui/react";
import { Globe } from "lucide-react";
import { routing } from "@/i18n/routing";

const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  "pt-BR": "Português",
  es: "Español",
};

const LOCALE_FLAGS: Record<string, string> = {
  en: "🇺🇸",
  "pt-BR": "🇧🇷",
  es: "🇪🇸",
};

export function LanguageSelector() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function switchLocale(newLocale: string) {
    // Replace current locale prefix with the new one
    const segments = pathname.split("/");
    segments[1] = newLocale;
    router.push(segments.join("/"));
  }

  return (
    <Dropdown>
      <DropdownTrigger>
        <Button
          variant="light"
          size="sm"
          startContent={<Globe size={15} />}
          className="text-default-500 hover:text-default-900 dark:hover:text-default-100"
        >
          <span className="hidden sm:inline">{LOCALE_FLAGS[locale]} {LOCALE_LABELS[locale]}</span>
          <span className="sm:hidden">{LOCALE_FLAGS[locale]}</span>
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label="Select language"
        onAction={(key) => switchLocale(String(key))}
        selectedKeys={[locale]}
        selectionMode="single"
      >
        {routing.locales.map((loc) => (
          <DropdownItem key={loc} startContent={<span>{LOCALE_FLAGS[loc]}</span>}>
            {LOCALE_LABELS[loc]}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}
```

- [ ] **Step 3: Create apps/web/components/shell/PresentationModeToggle.tsx**

```tsx
"use client";

import { Button, Tooltip } from "@heroui/react";
import { Presentation } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { usePresentationMode } from "@/components/providers/PresentationModeProvider";
import { cn } from "@/lib/utils";

export function PresentationModeToggle() {
  const { isPresenting, toggle } = usePresentationMode();
  const t = useTranslations("presentationMode");

  return (
    <Tooltip
      content={isPresenting ? t("disable") : t("enable")}
      placement="bottom"
    >
      <Button
        isIconOnly
        variant="light"
        size="sm"
        onClick={toggle}
        aria-label={isPresenting ? t("disable") : t("enable")}
        className={cn(
          "transition-colors duration-200",
          isPresenting
            ? "text-fichap-primary"
            : "text-default-400 hover:text-default-900 dark:hover:text-default-100"
        )}
      >
        <motion.div
          animate={{
            scale: isPresenting ? [1, 1.2, 1] : 1,
          }}
          transition={{ duration: 0.3 }}
        >
          <Presentation size={16} />
        </motion.div>
      </Button>
    </Tooltip>
  );
}
```

- [ ] **Step 4: Create apps/web/components/shell/Topbar.tsx**

```tsx
"use client";

import { motion } from "framer-motion";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageSelector } from "./LanguageSelector";
import { PresentationModeToggle } from "./PresentationModeToggle";
import { Avatar } from "@heroui/react";
import { fadeInDown } from "@/lib/motion";
import { usePresentationMode } from "@/components/providers/PresentationModeProvider";
import { cn } from "@/lib/utils";

interface TopbarProps {
  locale: string;
}

export function Topbar({ locale: _locale }: TopbarProps) {
  const { isPresenting } = usePresentationMode();

  return (
    <motion.header
      variants={fadeInDown}
      initial="hidden"
      animate="visible"
      className={cn(
        "flex h-14 items-center justify-between border-b px-6",
        "border-default-100 bg-background dark:border-default-50/20",
        "backdrop-blur-sm"
      )}
    >
      {/* Left: breadcrumb placeholder */}
      <div className="flex items-center gap-2">
        {isPresenting && (
          <motion.span
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="rounded-full bg-fichap-primary/10 px-2.5 py-0.5 text-xs font-medium text-fichap-primary"
          >
            Presentation Mode
          </motion.span>
        )}
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-1">
        <PresentationModeToggle />
        <ThemeToggle />
        <LanguageSelector />
        <div className="ml-2">
          <Avatar
            size="sm"
            name="Demo User"
            className="cursor-pointer bg-gradient-to-br from-fichap-primary to-fichap-accent text-white"
          />
        </div>
      </div>
    </motion.header>
  );
}
```

- [ ] **Step 5: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/components/shell/
git commit -m "feat: add topbar with theme toggle, language selector, and presentation mode"
```

---

## Task 10: Showcase Pages (Loading + Empty States)

**Files:**
- Create: `apps/web/app/[locale]/showcase/loading/page.tsx`
- Create: `apps/web/app/[locale]/showcase/empty/page.tsx`
- Create: `apps/web/components/ui/EmptyState.tsx`

These pages validate the visual system is working in both dark and light mode.

- [ ] **Step 1: Create apps/web/components/ui/EmptyState.tsx**

```tsx
"use client";

import { motion } from "framer-motion";
import { Button } from "@heroui/react";
import { fadeInUp, staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  ctaLabel?: string;
  onCta?: () => void;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  onCta,
  className,
}: EmptyStateProps) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-2xl",
        "border border-dashed border-default-200 bg-default-50/50 p-12",
        "dark:border-default-100/20 dark:bg-default-50/5",
        className
      )}
    >
      {icon && (
        <motion.div
          variants={staggerItem}
          className="rounded-2xl bg-fichap-primary/10 p-4 text-fichap-primary dark:bg-fichap-primary/20"
        >
          {icon}
        </motion.div>
      )}

      <motion.div variants={staggerItem} className="space-y-1 text-center">
        <h3 className="text-base font-semibold text-default-800 dark:text-default-100">
          {title}
        </h3>
        <p className="max-w-sm text-sm text-default-500">{description}</p>
      </motion.div>

      {ctaLabel && onCta && (
        <motion.div variants={staggerItem}>
          <Button
            color="primary"
            size="sm"
            onClick={onCta}
            className="bg-fichap-primary font-medium"
          >
            {ctaLabel}
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}
```

- [ ] **Step 2: Create apps/web/app/[locale]/showcase/loading/page.tsx**

```tsx
"use client";

import { Skeleton, Card, CardBody } from "@heroui/react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";

export default function LoadingShowcasePage() {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      <motion.div variants={staggerItem}>
        <h1 className="text-2xl font-semibold tracking-tight">Loading States</h1>
        <p className="text-sm text-default-500">Skeleton patterns used throughout the app</p>
      </motion.div>

      {/* KPI cards skeleton */}
      <motion.div variants={staggerItem} className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="rounded-xl shadow-small">
            <CardBody className="gap-2 p-4">
              <Skeleton className="h-4 w-24 rounded-lg" />
              <Skeleton className="h-8 w-16 rounded-lg" />
              <Skeleton className="h-3 w-20 rounded-lg" />
            </CardBody>
          </Card>
        ))}
      </motion.div>

      {/* Table skeleton */}
      <motion.div variants={staggerItem}>
        <Card className="rounded-xl shadow-small">
          <CardBody className="gap-3 p-4">
            <div className="flex items-center gap-3 border-b border-default-100 pb-3">
              {["40%", "20%", "20%", "20%"].map((w, i) => (
                <Skeleton key={i} className={`h-4 w-[${w}] rounded-lg`} />
              ))}
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 w-[35%] rounded-lg" />
                <Skeleton className="h-4 w-[20%] rounded-lg" />
                <Skeleton className="h-4 w-[20%] rounded-lg" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            ))}
          </CardBody>
        </Card>
      </motion.div>

      {/* Text block skeleton */}
      <motion.div variants={staggerItem} className="space-y-2">
        {[90, 75, 85, 60].map((w, i) => (
          <Skeleton key={i} className={`h-4 w-[${w}%] rounded-lg`} />
        ))}
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 3: Create apps/web/app/[locale]/showcase/empty/page.tsx**

```tsx
"use client";

import { motion } from "framer-motion";
import { Users, Bot, MessageSquare, Briefcase } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { useTranslations } from "next-intl";

export default function EmptyShowcasePage() {
  const t = useTranslations("emptyStates");

  const examples = [
    {
      icon: <Users size={24} />,
      title: t("teams.title"),
      description: t("teams.description"),
      ctaLabel: t("teams.cta"),
    },
    {
      icon: <Bot size={24} />,
      title: t("agents.title"),
      description: t("agents.description"),
      ctaLabel: t("agents.cta"),
    },
    {
      icon: <MessageSquare size={24} />,
      title: t("conversations.title"),
      description: t("conversations.description"),
      ctaLabel: t("conversations.cta"),
    },
    {
      icon: <Briefcase size={24} />,
      title: t("employees.title"),
      description: t("employees.description"),
      ctaLabel: t("employees.cta"),
    },
  ];

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      <motion.div variants={staggerItem}>
        <h1 className="text-2xl font-semibold tracking-tight">Empty States</h1>
        <p className="text-sm text-default-500">
          Personality-driven empty states for all major lists
        </p>
      </motion.div>

      <motion.div variants={staggerItem} className="grid grid-cols-2 gap-6">
        {examples.map((ex) => (
          <EmptyState
            key={ex.title}
            icon={ex.icon}
            title={ex.title}
            description={ex.description}
            ctaLabel={ex.ctaLabel}
            onCta={() => {}}
          />
        ))}
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/components/ui/ apps/web/app/\[locale\]/showcase/
git commit -m "feat: add EmptyState component and loading/empty showcase pages"
```

---

## Task 11: Docker Compose (Postgres+pgvector, Redis, Mailhog)

**Files:**
- Create: `/dev/orchester/docker-compose.yml`

- [ ] **Step 1: Create docker-compose.yml**

```yaml
version: "3.9"

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: orchester-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: orchester
      POSTGRES_PASSWORD: orchester
      POSTGRES_DB: orchester
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U orchester -d orchester"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: orchester-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  mailhog:
    image: mailhog/mailhog:latest
    container_name: orchester-mailhog
    restart: unless-stopped
    ports:
      - "1025:1025"   # SMTP
      - "8025:8025"   # Web UI
    logging:
      driver: none

  # Optional: Langfuse for agent observability
  # Enable with: docker compose --profile langfuse up -d
  langfuse:
    image: ghcr.io/langfuse/langfuse:latest
    container_name: orchester-langfuse
    profiles: ["langfuse"]
    restart: unless-stopped
    environment:
      DATABASE_URL: "postgresql://orchester:orchester@postgres:5432/orchester"
      NEXTAUTH_SECRET: "langfuse-dev-secret"
      NEXTAUTH_URL: "http://localhost:3010"
      SALT: "langfuse-dev-salt"
    ports:
      - "3010:3000"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres-data:
  redis-data:
```

- [ ] **Step 2: Start containers**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
docker compose up -d postgres redis mailhog
```

Expected: Three containers running. `docker compose ps` shows all `Up`.

- [ ] **Step 3: Verify Postgres is ready**

```bash
docker exec orchester-postgres pg_isready -U orchester -d orchester
```

Expected: `orchester:5432 - accepting connections`

- [ ] **Step 4: Verify Mailhog web UI**

Open http://localhost:8025 in browser. Expected: Mailhog inbox UI loads.

- [ ] **Step 5: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add docker-compose.yml
git commit -m "chore: add Docker Compose with Postgres+pgvector, Redis, and Mailhog"
```

---

## Task 12: packages/db Stub (Drizzle ORM + Connection Pool)

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/index.ts`
- Test: `packages/db/src/__tests__/client.test.ts`

- [ ] **Step 1: Create packages/db/package.json**

```json
{
  "name": "@orchester/db",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "scripts": {
    "migrate": "drizzle-kit migrate",
    "push": "drizzle-kit push",
    "studio": "drizzle-kit studio",
    "seed": "tsx src/seed.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "drizzle-orm": "^0.38.3",
    "postgres": "^3.4.5"
  },
  "devDependencies": {
    "drizzle-kit": "^0.30.4",
    "tsx": "^4.19.2",
    "vitest": "^2.1.8",
    "typescript": "^5.7.2",
    "@types/node": "^22.10.2"
  }
}
```

- [ ] **Step 2: Create packages/db/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write failing test for DB client**

Create `packages/db/src/__tests__/client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createDbClient } from "../client";

describe("createDbClient", () => {
  it("returns a drizzle instance given a connection string", () => {
    const db = createDbClient("postgresql://orchester:orchester@localhost:5432/orchester");
    expect(db).toBeDefined();
    // Drizzle db object has a $count method signature
    expect(typeof db.select).toBe("function");
  });

  it("throws if connection string is empty", () => {
    expect(() => createDbClient("")).toThrow("DATABASE_URL is required");
  });
});
```

- [ ] **Step 4: Run test — verify it fails**

```bash
cd packages/db
pnpm install
pnpm test -- --reporter=verbose client
```

Expected: FAIL — `Cannot find module '../client'`

- [ ] **Step 5: Create packages/db/src/client.ts**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

let cachedDb: PostgresJsDatabase | null = null;

export function createDbClient(connectionString: string): PostgresJsDatabase {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  return drizzle(sql);
}

export function getDb(): PostgresJsDatabase {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");

  if (!cachedDb) {
    cachedDb = createDbClient(url);
  }

  return cachedDb;
}
```

- [ ] **Step 6: Create packages/db/src/index.ts**

```ts
export { createDbClient, getDb } from "./client";
```

- [ ] **Step 7: Run test — verify it passes**

```bash
cd packages/db
pnpm test -- --reporter=verbose client
```

Expected: PASS — 2 tests

- [ ] **Step 8: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
pnpm install  # link workspace packages
git add packages/db/
git commit -m "feat: add @orchester/db package with Drizzle ORM client and connection pool"
```

---

## Task 13: First Full Dev Run + Login Placeholder

**Files:**
- Create: `apps/web/app/[locale]/(auth)/login/page.tsx`
- Create: `apps/web/app/[locale]/(auth)/layout.tsx`

This final task wires everything together and proves the app starts cleanly.

- [ ] **Step 1: Create apps/web/app/[locale]/(auth)/layout.tsx**

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Left: form */}
      <div className="flex w-full flex-col items-center justify-center bg-background px-8 md:w-1/2">
        {children}
      </div>

      {/* Right: decorative panel */}
      <div
        className="hidden md:flex md:w-1/2 flex-col items-center justify-center
                   bg-gradient-to-br from-fichap-primary/90 to-fichap-accent/90"
      >
        <div className="text-center text-white">
          <p className="text-4xl font-bold tracking-tight">Orchester</p>
          <p className="mt-2 text-lg opacity-80">
            Build AI agent teams in minutes.
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create apps/web/app/[locale]/(auth)/login/page.tsx**

```tsx
"use client";

import { motion } from "framer-motion";
import { Button, Input } from "@heroui/react";
import { useTranslations } from "next-intl";
import { Mail, Lock } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";

export default function LoginPage() {
  const t = useTranslations("common");

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="w-full max-w-sm space-y-6"
    >
      <motion.div variants={staggerItem} className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-default-900 dark:text-default-100">
          Welcome back
        </h1>
        <p className="text-sm text-default-500">Sign in to your workspace</p>
      </motion.div>

      <motion.div variants={staggerItem} className="space-y-3">
        <Input
          type="email"
          label="Email"
          placeholder="you@company.com"
          startContent={<Mail size={16} className="text-default-400" />}
          classNames={{ inputWrapper: "bg-default-100 dark:bg-default-50/10" }}
        />
        <Input
          type="password"
          label="Password"
          placeholder="••••••••"
          startContent={<Lock size={16} className="text-default-400" />}
          classNames={{ inputWrapper: "bg-default-100 dark:bg-default-50/10" }}
        />
      </motion.div>

      <motion.div variants={staggerItem}>
        <Button
          color="primary"
          className="w-full bg-fichap-primary font-semibold"
          size="lg"
        >
          {t("save")}
        </Button>
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 3: Start the dev server**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
pnpm install
pnpm dev
```

Expected output contains:
```
▲ Next.js 15.x.x (Turbopack)
- Local: http://localhost:3000
✓ Starting...
✓ Ready in Xs
```

- [ ] **Step 4: Verify pages in browser**

Navigate to:
1. `http://localhost:3000` → redirects to `http://localhost:3000/en` → renders dashboard placeholder with sidebar + topbar
2. `http://localhost:3000/en/showcase/loading` → shows skeleton cards
3. `http://localhost:3000/en/showcase/empty` → shows four empty state cards with icons + CTAs
4. `http://localhost:3000/en/login` → shows split login page with gradient right panel
5. Toggle dark mode → all pages re-render without flicker
6. Switch language to `pt-BR` → nav items translate

- [ ] **Step 5: Run all tests**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
pnpm test
```

Expected: All tests pass. Look for `Tests X passed`.

- [ ] **Step 6: Final commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add .
git commit -m "feat: Phase 0 complete — foundation, shell, i18n, theming, animations, Docker"
```

---

## Phase 0 Completion Checklist

After all tasks are done, verify:

- [ ] `pnpm dev` starts without errors
- [ ] `/en`, `/pt-BR`, `/es` all load
- [ ] Dark mode toggle works (no FOUC)
- [ ] Language selector switches all nav labels
- [ ] Sidebar collapses/expands with animation
- [ ] Active nav indicator animates with layoutId
- [ ] Topbar shows presentation mode toggle
- [ ] `/en/showcase/loading` renders skeletons
- [ ] `/en/showcase/empty` renders four empty states
- [ ] `/en/login` renders split layout
- [ ] Docker: postgres, redis, mailhog all healthy
- [ ] `pnpm test` passes
- [ ] `tsc --noEmit` passes with no errors

---

## What's Next

Phase 0 delivers the visual foundation. No business logic yet.

**Phase 1 plan** (write next): Auth.js v5 with email/password + Google SSO, session management, workspace multi-tenancy, login/signup flows, onboarding redirect.

**Phase 2 plan**: Full Drizzle schema (all tables from the spec), Zod schemas, seed script with demo workspace + 20 employees + 6 template stubs.
