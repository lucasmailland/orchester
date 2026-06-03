# Compass Voice Guide

> The canonical reference for every piece of UI copy in Orchester. If a string ships in the product, it must comply with this document. Reviewers will reject PRs that violate the rules below.

---

## Vision

Compass is the voice of a calm, expert colleague. The product talks to operators who already have a job to do — they did not come here to be entertained, sold to, or congratulated. Every word earns its place by helping the user understand what the system is doing, why it matters, and what to do next. We treat technical concepts with respect: we name them precisely and then explain them in one short sentence. We never hide complexity behind cheerful slogans, and we never flatten it into engineering jargon. The result is an interface that feels professional, trustworthy, and quietly teachable — the kind of product you can hand to a new teammate without a translator.

---

## Principles

### 1. Amable, no casual

The user is not your friend; treat them with professional warmth.

- Yes: "Conecta un proveedor para que tus agentes puedan responder."
- No: "Dale, conectá un proveedor y a romperla."

### 2. Clear, never condescending

Say the thing. Do not over-explain, do not soften with filler.

- Yes: "This action removes 14 facts. You can restore them within 30 days."
- No: "Don't worry! We're just going to clean things up a little for you."

### 3. Specific, never vague

Numbers, names, and outcomes beat adjectives.

- Yes: "Se combinaron 3 registros en 2,1 segundos."
- No: "Operación completada con éxito."

### 4. Confident, never apologetic

State facts. Reserve apologies for moments when the product is genuinely at fault.

- Yes: "We couldn't reach the provider. Check the API key and try again."
- No: "Oops! Sorry, something might have gone a little wrong, sorry about that!"

### 5. Pedagogical

When introducing a technical term, explain why it matters in one short sentence.

- Yes: "Un embedding es la representación numérica de un texto. Permite que los agentes encuentren información parecida, no solo idéntica."
- No: "Embedding (vector de 1536d, cosine similarity ≥ 0.92)."

---

## Hard rules

These are non-negotiable. Copy that breaks any of them must be rewritten before merge.

- **Spanish: use "tú" universally.** NEVER "vos", NEVER "usted".
- **No regionalisms in any language.** Banned ES words: "atenti", "boludez", "padre" (MX informal), "chévere" (CO/VE), "guay" (ES), "che", "qué onda".
- **Imperatives in Spanish:** "Conecta", "Revisa", "Configura" — never "Conectá", never "Por favor configure".
- **Contractions in English** (you're, we'll, don't); **never in Spanish** (do not abbreviate — write "no es", not "n'es").
- **Error messages must answer:** WHAT failed · WHY (if known) · WHAT the user can do next.
- **Outcome messages must be specific:** "Se combinaron 3 registros. Tiempo: 2,1 segundos." NOT "Listo."
- **Wrap jargon** (Mnemosyne, embedding, cosine, REM, MCP, RAG, pgvector) in the `TermDef` component so users can hover for a friendly definition.

---

## Banned vocabulary

Do not use these words in any locale. They are either marketing inflation, regional slang, or condescending fluff.

### English

revolutionary · game-changing · cutting-edge · unlock · unlocking · disrupt · disrupting · AI-powered · next-generation · seamlessly · effortlessly · robust · enterprise-grade · best-in-class · world-class · supercharge · turbocharge · magic · magical · simply · just · easily · powerful · amazing · awesome · delightful

### Spanish (neutral — no regional variants)

revolucionario · disruptivo · de última generación · de vanguardia · potenciado por IA · sin esfuerzo · simplemente · fácilmente · poderoso · increíble · genial · atenti · boludez · padre · chévere · guay · che · qué onda · ¡dale! · ¡buenísimo! · vos · usted · ustedes (use "tú" — second person singular)

### Portuguese (Brazil)

revolucionário · disruptivo · de última geração · de ponta · turbinado · alimentado por IA · sem esforço · simplesmente · facilmente · poderoso · incrível · maneiro · top demais · massa · da hora · arrasou · bombar

---

## Tone calibration table

Each row shows the same intent rendered correctly in all three locales. Use as a reference when writing new copy.

### Empty states

| Context                 | EN (do)                                                                                                           | ES neutral (do)                                                                                                               | pt-BR (do)                                                                                                                        | Don't                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Memory has no facts yet | No memories yet. Connect a provider in **Settings → Providers** so your agents can start saving information.      | Aún no hay información guardada. Conecta un proveedor en **Ajustes → Proveedores** para que tus agentes empiecen a guardarla. | Ainda não há informações salvas. Conecte um provedor em **Configurações → Provedores** para que seus agentes comecem a salvá-las. | "Tus agentes todavía no recordaron nada."    |
| No flows created        | No flows yet. A flow connects several agents so they run in sequence. Create the first one to get started.        | Todavía no hay flujos. Un flujo conecta varios agentes para que se ejecuten en orden. Crea el primero para empezar.           | Ainda não há fluxos. Um fluxo conecta vários agentes para que sejam executados em sequência. Crie o primeiro para começar.        | "¡Aún no hay nada! Crea tu primer flujo."    |
| Review queue is clear   | The review queue is empty. New items appear here when the system flags a fact as low-confidence or contradictory. | La cola de revisión está vacía. Aquí aparecerán los hechos que el sistema marque como de baja confianza o contradictorios.    | A fila de revisão está vazia. Aqui aparecerão os fatos que o sistema marcar como de baixa confiança ou contraditórios.            | "¡Todo en orden! No tenés nada que revisar." |

### Errors

| Context              | EN (do)                                                                                                                 | ES neutral (do)                                                                                                                    | pt-BR (do)                                                                                                                                   | Don't                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Save failed, generic | We couldn't save the change. Check your connection and try again. If the problem continues, see the system status page. | No pudimos guardar el cambio. Verifica tu conexión y vuelve a intentarlo. Si el problema continúa, consulta el estado del sistema. | Não conseguimos salvar a alteração. Verifique sua conexão e tente novamente. Se o problema continuar, confira a página de status do sistema. | "Algo salió mal."               |
| Invalid API key      | The provider rejected the API key. Open the provider's dashboard, generate a new key, and paste it here.                | El proveedor rechazó la clave de API. Abre el panel del proveedor, genera una clave nueva y pégala aquí.                           | O provedor rejeitou a chave de API. Abra o painel do provedor, gere uma chave nova e cole aqui.                                              | "Error de autenticación (401)." |
| Form validation      | Enter a valid email address. We use it to send sign-in links.                                                           | Ingresa un correo electrónico válido. Lo usamos para enviarte el enlace de acceso.                                                 | Informe um e-mail válido. Usamos ele para enviar o link de acesso.                                                                           | "Email inválido."               |

### Confirmations (destructive)

| Context          | EN (do)                                                                                                                                                           | ES neutral (do)                                                                                                                                                                                                | pt-BR (do)                                                                                                                                                                                    | Don't                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Delete agent     | Delete this agent? Its conversations and memory will be archived for 30 days and then removed permanently.                                                        | ¿Eliminar este agente? Sus conversaciones y memoria se archivarán durante 30 días y luego se eliminarán de forma definitiva.                                                                                   | Excluir este agente? As conversas e a memória dele ficarão arquivadas por 30 dias e depois serão removidas em definitivo.                                                                     | "¿Seguro? Esta acción no se puede deshacer." |
| Forget a fact    | Forget this fact? Your agents will stop using it in answers. You can restore it from the timeline within 30 days.                                                 | ¿Olvidar este hecho? Tus agentes dejarán de usarlo en sus respuestas. Puedes restaurarlo desde el historial durante los próximos 30 días.                                                                      | Esquecer este fato? Seus agentes deixarão de usá-lo nas respostas. Você pode restaurá-lo pelo histórico nos próximos 30 dias.                                                                 | "Borrar fact (no se puede deshacer)."        |
| Run memory dedup | Run the dedup pass now? It will scan every fact in this workspace and merge near-duplicates. The job runs in the background and usually finishes within a minute. | ¿Ejecutar ahora la pasada de deduplicación? Revisará todos los hechos de este espacio de trabajo y combinará los duplicados. La tarea se ejecuta en segundo plano y normalmente termina en menos de un minuto. | Executar agora a passada de deduplicação? Ela vai revisar todos os fatos deste workspace e combinar os duplicados. A tarefa roda em segundo plano e geralmente termina em menos de um minuto. | "¿Correr dedup pass?"                        |

### Success / outcome

| Context           | EN (do)                                                                   | ES neutral (do)                                                                         | pt-BR (do)                                                                              | Don't                |
| ----------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------- |
| Saved provider    | Anthropic connected. Your agents can now use Claude models.               | Anthropic conectado. Tus agentes ya pueden usar los modelos de Claude.                  | Anthropic conectado. Seus agentes já podem usar os modelos do Claude.                   | "¡Guardado! :)"      |
| Dedup finished    | Merged 3 duplicate facts in 2.1 seconds.                                  | Se combinaron 3 hechos duplicados en 2,1 segundos.                                      | 3 fatos duplicados foram combinados em 2,1 segundos.                                    | "Operación exitosa." |
| Flow published    | Flow published as version 4. New runs will use this version starting now. | Flujo publicado como versión 4. Las nuevas ejecuciones usarán esta versión desde ahora. | Fluxo publicado como versão 4. As novas execuções usarão esta versão a partir de agora. | "¡Listo, publicado!" |
| Channel connected | Telegram channel connected. Send a message to your bot to test it.        | Canal de Telegram conectado. Envía un mensaje a tu bot para probarlo.                   | Canal do Telegram conectado. Envie uma mensagem para o seu bot para testá-lo.           | "Telegram OK ✓"      |

---

## Component-by-component voice notes

Use this section to decide which primitive to reach for. Each component has a specific role; mixing them up flattens the system.

### `PageHero`

The top of every page. One line for the page name, one line that answers "what is this page for?" in plain language. Never marketing. Never longer than two sentences. If you need a third sentence, you need a `Callout` underneath instead.

- Voice: declarative, present tense, second person.
- Example (EN): "Memory · All durable information your agents have learned and can recall."
- Example (ES): "Memoria · Toda la información permanente que tus agentes aprendieron y pueden recordar."

### `EmptyState`

Shown when a list, table, or board has zero items. Three required parts: title (what is missing), description (why and what unlocks it), CTA (the next concrete step). The CTA verb is always specific — never "Get started".

- Voice: helpful, no exclamation marks, no celebration.
- The description must answer "what fills this view?".

### `TermDef`

Wraps any term that a non-engineer would not recognize. The default render is the term with a dashed underline; hover or focus reveals a one-sentence definition from `lib/compass/terms.ts`. Use whenever you would otherwise drop a glossary entry into a help doc.

- Use for: Mnemosyne, embedding, cosine, REM, MCP, RAG, pgvector, recall, fact, chunk, dedup, provider.
- Do not nest jargon inside the definition.
- If the same term appears three times in one paragraph, wrap only the first occurrence.

### `Callout`

A bordered note inline with the content. Three intents: `info` (neutral context), `warning` (irreversible or rate-limited action ahead), `tip` (optional shortcut). Never use a callout for celebration. Never stack two callouts in a row — pick one.

- Voice: brief, two sentences maximum.
- A callout earns its border by saying something the body copy cannot say without breaking flow.

### `NextStep`

The footer of an empty state, a wizard step, or a "you just finished X" screen. One sentence + one button. Always points forward, never backward. Never says "Done" — the user already knows they finished.

- Voice: imperative, specific.
- Example (EN): "Next: connect a channel so your agent can answer messages."
- Example (ES): "Siguiente paso: conecta un canal para que tu agente pueda responder mensajes."

### `ConfirmAction`

The single source of truth for destructive confirmations. Replaces every direct call to `window.confirm`, ad-hoc HeroUI Modals, and one-off ConfirmDialog usages. Required props: `title`, `description` (answers WHAT will change, WHO is affected, and WHETHER it is reversible), `confirmLabel` (the verb of the action, not "OK"), `destructive` boolean.

- Voice: precise. Numbers when available ("Delete 14 facts", not "Delete facts").
- Always say whether the action is reversible and for how long.
- The cancel label is always the locale's default ("Cancel" / "Cancelar" / "Cancelar"). Do not invent variants.

---

## Review checklist for PRs that add new copy

Reviewers: refuse to approve until every box is checked. Authors: copy this list into the PR description.

- [ ] All new keys exist in `en.json`, `es.json`, **and** `pt-BR.json`.
- [ ] Spanish uses "tú", not "vos" or "usted", in every string.
- [ ] No banned vocabulary (see the section above) appears in any locale.
- [ ] Error messages answer WHAT failed, WHY (if known), and WHAT to do next.
- [ ] Success / outcome messages include a number, a name, or a concrete result — not just "Done".
- [ ] Every technical term in user-facing copy is either wrapped in `TermDef` or defined inline in one sentence.
- [ ] Imperatives in Spanish are peninsular-neutral ("Conecta", "Revisa", "Configura").
- [ ] No emoji in error or confirmation copy. Emoji is allowed only in tutorial empty states, sparingly.
- [ ] No exclamation marks in errors, confirmations, or destructive flows.
- [ ] Destructive actions use `ConfirmAction` and the description states whether the action is reversible and for how long.
- [ ] Page headers use `PageHero`; empty lists use `EmptyState`; inline guidance uses `Callout`.
- [ ] If a new technical term ships, it has been added to `apps/web/lib/compass/terms.ts` in all three locales.
- [ ] Strings have been read out loud once before merge. If you would not say them to a colleague, rewrite them.
