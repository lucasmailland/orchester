import type { FieldDef } from "./field-types";

/**
 * Registro declarativo de nodos del Flow Builder — ÚNICA fuente de verdad.
 *
 * El palette, el inspector y el copiloto se derivan de acá. Agregar un nodo =
 * agregar una entrada acá (+ su ejecutor en `flow-engine.ts` si es nuevo).
 *
 * COPYS: en lenguaje simple, que entienda cualquier persona (ver el principio
 * de copys del plan). Trilingüe (es/en/pt-BR).
 */

export type NodeCategory = "trigger" | "ai" | "logic" | "apps" | "data" | "actions";

export type Locale = "es" | "en" | "pt-BR";
export type I18n = Record<Locale, string>;

export interface NodeDef {
  /** id del nodo en el registry (único). */
  id: string;
  /** tipo que ejecuta el motor (`flow-engine` FlowNodeType). */
  engine: string;
  category: NodeCategory;
  /** ícono lucide (nombre). */
  icon: string;
  /** color de acento del nodo (hex). */
  accent: string;
  title: I18n;
  /** una línea: "qué hace" en humano. */
  summary: I18n;
  fields: FieldDef[];
  /** config por defecto al crear el nodo. */
  defaults?: Record<string, unknown>;
  /** valores fijos que distinguen variantes que comparten engine (ej. triggers). */
  fixedConfig?: Record<string, unknown>;
}

const i = (es: string, en: string, pt: string): I18n => ({ es, en, "pt-BR": pt });

export const NODE_REGISTRY: Record<string, NodeDef> = {
  // ── Disparadores ──────────────────────────────────────────────────────────
  trigger_manual: {
    id: "trigger_manual", engine: "trigger", category: "trigger", icon: "Play", accent: "#10b981",
    title: i("Inicio manual", "Manual start", "Início manual"),
    summary: i("Arranca el flujo cuando lo ejecutás a mano o por API.", "Starts when you run it by hand or via API.", "Inicia quando você executa manualmente ou via API."),
    fields: [], fixedConfig: { triggerKind: "manual" },
  },
  trigger_message: {
    id: "trigger_message", engine: "trigger", category: "trigger", icon: "MessageSquare", accent: "#10b981",
    title: i("Cuando llega un mensaje", "When a message arrives", "Quando chega uma mensagem"),
    summary: i("Arranca cada vez que un cliente escribe por un canal.", "Runs whenever a customer writes on a channel.", "Roda sempre que um cliente escreve em um canal."),
    fields: [
      { key: "channelId", label: "Canal", type: "channel-picker", help: "Elegí por qué canal escucha (Web, WhatsApp, Telegram…). Vacío = todos." },
    ], fixedConfig: { triggerKind: "message" },
  },
  trigger_schedule: {
    id: "trigger_schedule", engine: "trigger", category: "trigger", icon: "Clock", accent: "#10b981",
    title: i("En un horario", "On a schedule", "Em um horário"),
    summary: i("Arranca solo, repetido (cada hora, cada día, etc.).", "Runs by itself on a repeating schedule.", "Roda sozinho em um horário repetido."),
    fields: [
      { key: "cron", label: "Cada cuánto", type: "cron", required: true, help: "Elegí la frecuencia. Ej. todos los días a las 9." },
    ], fixedConfig: { triggerKind: "schedule" },
  },
  trigger_webhook: {
    id: "trigger_webhook", engine: "trigger", category: "trigger", icon: "Webhook", accent: "#10b981",
    title: i("Cuando llega un webhook", "When a webhook arrives", "Quando chega um webhook"),
    summary: i("Arranca cuando otra app le pega a una URL tuya.", "Runs when another app calls a URL of yours.", "Roda quando outro app chama uma URL sua."),
    fields: [], fixedConfig: { triggerKind: "webhook" },
  },

  // ── IA ────────────────────────────────────────────────────────────────────
  agent: {
    id: "agent", engine: "agent", category: "ai", icon: "Bot", accent: "#8b5cf6",
    title: i("Agente", "Agent", "Agente"),
    summary: i("Le pasa el mensaje a un agente de IA y usa su respuesta.", "Sends the message to an AI agent and uses its reply.", "Envia a mensagem a um agente de IA e usa a resposta."),
    fields: [
      { key: "agentId", label: "Agente", type: "agent-picker", required: true, help: "Elegí qué agente responde en este paso." },
      { key: "prompt", label: "Instrucción extra (opcional)", type: "textarea", help: "Texto que se antepone al mensaje. Podés usar {{variables}}.", example: "Respondé en tono formal.", advanced: true },
    ],
  },
  kb_search: {
    id: "kb_search", engine: "kb_search", category: "ai", icon: "BookOpen", accent: "#8b5cf6",
    title: i("Buscar en conocimiento", "Search knowledge", "Buscar no conhecimento"),
    summary: i("Busca información relevante en una base de conocimiento.", "Finds relevant info in a knowledge base.", "Encontra informação relevante numa base de conhecimento."),
    fields: [
      { key: "kbId", label: "Base de conocimiento", type: "kb-picker", required: true, help: "Dónde buscar." },
      { key: "query", label: "Qué buscar", type: "variable", required: true, help: "El texto a buscar. Podés usar {{message}}.", example: "{{message}}" },
      { key: "topK", label: "Cuántos resultados", type: "number", help: "Cantidad de fragmentos a traer (por defecto 5).", advanced: true },
    ],
    defaults: { topK: 5 },
  },
  generate_image: {
    id: "generate_image", engine: "generate_image", category: "ai", icon: "Image", accent: "#ec4899",
    title: i("Crear imagen", "Create image", "Criar imagem"),
    summary: i("Genera una imagen con IA a partir de un texto.", "Generates an AI image from a text prompt.", "Gera uma imagem de IA a partir de um texto."),
    fields: [
      { key: "model", label: "Modelo de imagen", type: "model-picker", capability: "image", required: true, help: "Con qué modelo generar (gpt-image-1, FLUX, Imagen…). Conectá proveedores en Ajustes." },
      { key: "prompt", label: "Descripción de la imagen", type: "variable", required: true, help: "Qué querés que muestre. Podés usar {{variables}}.", example: "Invitación de cumpleaños para {{nombre}}, estilo acuarela" },
      { key: "size", label: "Tamaño", type: "select", advanced: true, options: [
        { value: "1024x1024", label: "Cuadrada (1024×1024)" },
        { value: "1024x1536", label: "Vertical (1024×1536)" },
        { value: "1536x1024", label: "Horizontal (1536×1024)" },
      ] },
      { key: "outputVar", label: "Guardar resultado en", type: "text", advanced: true, placeholder: "image", help: "Nombre de la variable que tendrá la URL de la imagen." },
    ],
  },
  llm_prompt: {
    id: "llm_prompt", engine: "llm_prompt", category: "ai", icon: "Sparkles", accent: "#8b5cf6",
    title: i("Generar texto (IA)", "Generate text (AI)", "Gerar texto (IA)"),
    summary: i("Le das una instrucción a un modelo y te devuelve texto. Sin armar un agente.", "Give a model a prompt and get text back. No agent needed.", "Dê uma instrução a um modelo e receba texto."),
    fields: [
      { key: "model", label: "Modelo", type: "model-picker", capability: "chat", required: true, help: "Qué modelo de IA usar." },
      { key: "prompt", label: "Instrucción", type: "variable", required: true, help: "Qué querés que haga. Podés usar {{variables}}.", example: "Resumí esto en 3 puntos: {{texto}}" },
      { key: "system", label: "Rol / contexto (opcional)", type: "textarea", advanced: true, help: "Cómo se tiene que comportar el modelo.", example: "Sos un redactor formal." },
      { key: "outputVar", label: "Guardar en", type: "text", advanced: true, placeholder: "texto", help: "Variable con el texto generado." },
    ],
  },
  generate_video: {
    id: "generate_video", engine: "generate_video", category: "ai", icon: "Video", accent: "#ec4899",
    title: i("Crear video (IA)", "Create video (AI)", "Criar vídeo (IA)"),
    summary: i("Genera un video corto a partir de un texto.", "Generates a short video from a text prompt.", "Gera um vídeo curto a partir de um texto."),
    fields: [
      { key: "model", label: "Modelo de video", type: "model-picker", capability: "video", required: true, help: "Hoy se ejecuta vía Replicate o fal. Conectá uno." },
      { key: "prompt", label: "Descripción del video", type: "variable", required: true, example: "Un gato astronauta flotando en el espacio" },
      { key: "outputVar", label: "Guardar en", type: "text", advanced: true, placeholder: "video", help: "Variable con la URL del video." },
    ],
  },
  text_to_speech: {
    id: "text_to_speech", engine: "text_to_speech", category: "ai", icon: "Volume2", accent: "#06b6d4",
    title: i("Texto a voz", "Text to speech", "Texto para voz"),
    summary: i("Convierte un texto en audio hablado.", "Turns text into spoken audio.", "Converte texto em áudio falado."),
    fields: [
      { key: "model", label: "Modelo de voz", type: "model-picker", capability: "tts", required: true, help: "ElevenLabs, OpenAI TTS… Conectá uno." },
      { key: "text", label: "Texto a decir", type: "variable", required: true, help: "Podés usar {{variables}}.", example: "Hola {{nombre}}, ¡bienvenido!" },
      { key: "voice", label: "Voz (id)", type: "text", advanced: true, help: "Id de la voz del proveedor (opcional)." },
      { key: "outputVar", label: "Guardar en", type: "text", advanced: true, placeholder: "audio", help: "Variable con la URL del audio." },
    ],
  },
  transcribe: {
    id: "transcribe", engine: "transcribe", category: "ai", icon: "Mic", accent: "#06b6d4",
    title: i("Transcribir audio", "Transcribe audio", "Transcrever áudio"),
    summary: i("Convierte un audio en texto.", "Turns audio into text.", "Converte áudio em texto."),
    fields: [
      { key: "model", label: "Modelo de transcripción", type: "model-picker", capability: "stt", required: true, help: "Whisper, Deepgram… Conectá uno." },
      { key: "audioUrl", label: "URL del audio", type: "variable", required: true, help: "Link al archivo de audio. Podés usar {{variables}}.", example: "{{audio}}" },
      { key: "outputVar", label: "Guardar en", type: "text", advanced: true, placeholder: "texto", help: "Variable con el texto transcripto." },
    ],
  },

  // ── Lógica ──────────────────────────────────────────────────────────────────
  condition: {
    id: "condition", engine: "condition", category: "logic", icon: "GitBranch", accent: "#f59e0b",
    title: i("Si… entonces", "If… then", "Se… então"),
    summary: i("Toma un camino u otro según una condición.", "Branches one way or another based on a condition.", "Ramifica conforme uma condição."),
    fields: [
      { key: "left", label: "Valor a comparar", type: "variable", required: true, help: "Ej. {{message}} o el resultado de un paso anterior.", example: "{{message}}" },
      { key: "op", label: "Comparación", type: "select", required: true, options: [
        { value: "==", label: "es igual a" }, { value: "!=", label: "es distinto de" },
        { value: "contains", label: "contiene" }, { value: ">", label: "es mayor que" },
        { value: "<", label: "es menor que" }, { value: ">=", label: "es mayor o igual que" }, { value: "<=", label: "es menor o igual que" },
      ] },
      { key: "right", label: "Comparar contra", type: "text", required: true, example: "urgente" },
    ],
  },
  switch: {
    id: "switch", engine: "switch", category: "logic", icon: "Split", accent: "#f59e0b",
    title: i("Elegir camino", "Pick a path", "Escolher caminho"),
    summary: i("Manda el flujo por uno de varios caminos según un valor.", "Routes the flow down one of several paths by value.", "Direciona o fluxo por um de vários caminhos."),
    fields: [
      { key: "value", label: "Valor a evaluar", type: "variable", required: true, example: "{{categoria}}" },
      { key: "cases", label: "Caminos posibles", type: "string-list", help: "Escribí los valores que querés distinguir (ej. ventas, soporte). Cada uno crea una salida. Lo que no coincida sale por 'Siguiente'.", example: "ventas" },
    ],
  },
  loop_for_each: {
    id: "loop_for_each", engine: "loop_for_each", category: "logic", icon: "Repeat", accent: "#f59e0b",
    title: i("Repetir por cada", "Repeat for each", "Repetir para cada"),
    summary: i("Ejecuta los pasos siguientes una vez por cada elemento de una lista.", "Runs the next steps once per item in a list.", "Executa os próximos passos uma vez por item de uma lista."),
    fields: [
      { key: "items", label: "Lista", type: "variable", required: true, help: "La lista por la que repetir. Ej. {{contactos}}.", example: "{{contactos}}" },
    ],
  },
  parallel: {
    id: "parallel", engine: "parallel", category: "logic", icon: "Rows3", accent: "#ec4899",
    title: i("En paralelo", "In parallel", "Em paralelo"),
    summary: i("Hace varias cosas al mismo tiempo en vez de una tras otra.", "Does several things at once instead of one by one.", "Faz várias coisas ao mesmo tempo."),
    fields: [],
  },
  try_catch: {
    id: "try_catch", engine: "try_catch", category: "logic", icon: "LifeBuoy", accent: "#f97316",
    title: i("Intentar / si falla", "Try / on error", "Tentar / se falhar"),
    summary: i("Intenta unos pasos; si algo falla, sigue por otro camino.", "Tries some steps; if anything fails, takes another path.", "Tenta passos; se algo falha, segue outro caminho."),
    fields: [],
  },
  code: {
    id: "code", engine: "code", category: "logic", icon: "Code2", accent: "#64748b",
    title: i("Código (avanzado)", "Code (advanced)", "Código (avançado)"),
    summary: i("Para programadores: corré JavaScript a medida.", "For developers: run custom JavaScript.", "Para devs: rode JavaScript personalizado."),
    fields: [
      { key: "code", label: "Código JavaScript", type: "code", help: "Recibís `input` (los datos del paso anterior) y devolvés un objeto.", example: "return { total: input.a + input.b }" },
    ],
  },

  // ── Conectar apps ────────────────────────────────────────────────────────────
  integration: {
    id: "integration", engine: "integration", category: "apps", icon: "Plug", accent: "#3b82f6",
    title: i("Conectar una app", "Connect an app", "Conectar um app"),
    summary: i("Usa una de tus integraciones (Stripe, Notion, Slack, etc.).", "Uses one of your integrations (Stripe, Notion, Slack…).", "Usa uma das suas integrações (Stripe, Notion, Slack…)."),
    fields: [
      { key: "integrationId", label: "App + acción", type: "integration-action", required: true, help: "Elegí qué app y qué acción ejecutar. Configurá apps en Integraciones." },
      { key: "input", label: "Datos para la acción", type: "key-value", help: "Los datos que necesita la acción. Podés usar {{variables}}.", advanced: true },
    ],
  },
  http: {
    id: "http", engine: "http", category: "apps", icon: "Globe", accent: "#3b82f6",
    title: i("Llamar una API (HTTP)", "Call an API (HTTP)", "Chamar uma API (HTTP)"),
    summary: i("Le pega a cualquier servicio web por su URL.", "Calls any web service by its URL.", "Chama qualquer serviço web pela URL."),
    fields: [
      { key: "url", label: "Dirección (URL)", type: "text", required: true, placeholder: "https://api.tu-servicio.com/datos", help: "La URL del servicio a llamar." },
      { key: "method", label: "Tipo de llamada", type: "select", options: [
        { value: "GET", label: "Traer datos (GET)" }, { value: "POST", label: "Enviar datos (POST)" },
        { value: "PUT", label: "Actualizar (PUT)" }, { value: "DELETE", label: "Borrar (DELETE)" },
      ], help: "Por lo general 'Traer datos' para leer y 'Enviar datos' para crear." },
      { key: "headers", label: "Encabezados", type: "key-value", advanced: true, help: "Pares clave/valor (ej. Authorization)." },
      { key: "body", label: "Cuerpo del mensaje", type: "json", advanced: true, help: "Los datos a enviar, en formato JSON." },
    ],
    defaults: { method: "GET" },
  },
  transform: {
    id: "transform", engine: "transform", category: "data", icon: "Wand2", accent: "#3b82f6",
    title: i("Modificar datos", "Modify data", "Modificar dados"),
    summary: i("Arma o transforma datos para el siguiente paso.", "Builds or reshapes data for the next step.", "Monta ou transforma dados para o próximo passo."),
    fields: [
      { key: "template", label: "Resultado", type: "json", required: true, help: "Definí qué datos salen de este paso. Podés usar {{variables}}.", example: '{ "nombre": "{{message}}" }' },
    ],
  },
  spreadsheet: {
    id: "spreadsheet", engine: "spreadsheet", category: "data", icon: "Table2", accent: "#22c55e",
    title: i("Planilla / fórmulas", "Spreadsheet / formulas", "Planilha / fórmulas"),
    summary: i("Hacé cálculos con fórmulas tipo Excel (SUM, IF, BUSCARV…).", "Run Excel-style formulas (SUM, IF, VLOOKUP…).", "Rode fórmulas tipo Excel (SUM, IF, PROCV…)."),
    fields: [
      { key: "grid", label: "Planilla", type: "spreadsheet", help: "Escribí valores o fórmulas (empezando con =) en las celdas, como en Excel. Elegí qué celda es el resultado." },
    ],
  },
  embed_text: {
    id: "embed_text", engine: "embed_text", category: "data", icon: "Binary", accent: "#22c55e",
    title: i("Vectorizar / embeddings", "Vectorize / embeddings", "Vetorizar / embeddings"),
    summary: i("Convierte un texto en vector (números) para búsquedas por significado.", "Turns text into a vector for semantic search.", "Converte texto em vetor para busca semântica."),
    fields: [
      { key: "model", label: "Modelo de embeddings", type: "model-picker", capability: "embedding", required: true, help: "Con qué modelo vectorizar (OpenAI, Voyage, Google…)." },
      { key: "input", label: "Texto a vectorizar", type: "variable", required: true, help: "El texto que se convierte en vector. Podés usar {{variables}}.", example: "{{message}}" },
      { key: "outputVar", label: "Guardar en", type: "text", advanced: true, placeholder: "vector", help: "Nombre de la variable con el vector resultante." },
    ],
  },
  rerank: {
    id: "rerank", engine: "rerank", category: "data", icon: "ListOrdered", accent: "#3b82f6",
    title: i("Ordenar por relevancia (rerank)", "Rerank by relevance", "Reordenar por relevância"),
    summary: i("Ordena una lista de textos según cuán relevantes son a una consulta.", "Ranks a list of texts by relevance to a query.", "Ordena textos por relevância a uma consulta."),
    fields: [
      { key: "model", label: "Modelo de rerank", type: "model-picker", capability: "rerank", required: true, help: "Cohere, Voyage, Jina… Conectá uno." },
      { key: "query", label: "Consulta", type: "variable", required: true, example: "{{message}}" },
      { key: "documents", label: "Lista de textos", type: "variable", required: true, help: "Una lista (array) de textos a ordenar. Ej. {{resultados}}.", example: "{{resultados}}" },
      { key: "topN", label: "Cuántos traer", type: "number", advanced: true, help: "Cantidad de resultados top (opcional)." },
      { key: "outputVar", label: "Guardar en", type: "text", advanced: true, placeholder: "ranked", help: "Variable con los resultados ordenados." },
    ],
  },

  // ── Acciones ──────────────────────────────────────────────────────────────────
  delay: {
    id: "delay", engine: "delay", category: "actions", icon: "Timer", accent: "#06b6d4",
    title: i("Esperar un rato", "Wait a bit", "Esperar um pouco"),
    summary: i("Pausa el flujo un tiempo antes de seguir.", "Pauses the flow for a while before continuing.", "Pausa o fluxo por um tempo antes de continuar."),
    fields: [
      { key: "duration", label: "Cuánto esperar", type: "duration", required: true, help: "Ej. 30 segundos, 5 minutos." },
    ],
  },
  notify: {
    id: "notify", engine: "notify", category: "actions", icon: "Bell", accent: "#06b6d4",
    title: i("Avisar", "Notify", "Avisar"),
    summary: i("Manda un aviso (email/mensaje) a alguien.", "Sends a notification (email/message) to someone.", "Envia um aviso (email/mensagem) a alguém."),
    fields: [
      { key: "to", label: "A quién avisar", type: "text", required: true, placeholder: "alguien@empresa.com", help: "Email o destino del aviso." },
      { key: "message", label: "Mensaje", type: "textarea", required: true, help: "Qué decir. Podés usar {{variables}}." },
    ],
  },
  wait_human: {
    id: "wait_human", engine: "wait_human", category: "actions", icon: "UserCheck", accent: "#06b6d4",
    title: i("Esperar a una persona", "Wait for a person", "Esperar uma pessoa"),
    summary: i("Pausa hasta que alguien apruebe o responda.", "Pauses until someone approves or replies.", "Pausa até alguém aprovar ou responder."),
    fields: [
      { key: "instructions", label: "Qué se le pide a la persona", type: "textarea", help: "Instrucción para quien tiene que aprobar/responder." },
    ],
  },
  subflow: {
    id: "subflow", engine: "subflow", category: "actions", icon: "Workflow", accent: "#a78bfa",
    title: i("Sub-flujo", "Sub-flow", "Subfluxo"),
    summary: i("Ejecuta otro flujo guardado como un paso más.", "Runs another saved flow as one step.", "Executa outro fluxo salvo como um passo."),
    fields: [
      { key: "flowId", label: "Flujo a ejecutar", type: "text", required: true, help: "El id del flujo a ejecutar." },
    ],
  },
  note: {
    id: "note", engine: "note", category: "actions", icon: "StickyNote", accent: "#eab308",
    title: i("Nota", "Note", "Nota"),
    summary: i("Un comentario para explicar el flujo (no hace nada).", "A comment to explain the flow (does nothing).", "Um comentário para explicar o fluxo (não faz nada)."),
    fields: [
      { key: "text", label: "Texto de la nota", type: "textarea", help: "Anotá lo que quieras recordar sobre el flujo." },
    ],
  },
};

export function getNodeDef(id: string): NodeDef | undefined {
  return NODE_REGISTRY[id];
}

const CATEGORY_ORDER: NodeCategory[] = ["trigger", "ai", "logic", "apps", "data", "actions"];

export const CATEGORY_LABELS: Record<NodeCategory, I18n> = {
  trigger: i("Disparadores", "Triggers", "Disparadores"),
  ai: i("IA", "AI", "IA"),
  logic: i("Lógica", "Logic", "Lógica"),
  apps: i("Conectar apps", "Connect apps", "Conectar apps"),
  data: i("Datos", "Data", "Dados"),
  actions: i("Acciones", "Actions", "Ações"),
};

export function listNodesByCategory(): { category: NodeCategory; nodes: NodeDef[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    nodes: Object.values(NODE_REGISTRY).filter((n) => n.category === category),
  })).filter((g) => g.nodes.length > 0);
}
