import type { I18n, Locale } from "./node-registry";

/**
 * Documentación rica de cada paso, pensada para que CUALQUIER persona entienda
 * qué hace, para qué sirve y cuándo conviene usarlo. También alimenta al
 * copiloto para que elija el paso correcto. Trilingüe (es/en/pt-BR).
 */

export interface NodeDocs {
  /** Para qué sirve, en una o dos frases simples. */
  whatFor: I18n;
  /** Cuándo es ideal usarlo (situaciones concretas). */
  whenToUse: I18n;
  /** Un consejo práctico (opcional). */
  tip?: I18n;
}

const i = (es: string, en: string, pt: string): I18n => ({ es, en, "pt-BR": pt });

export const NODE_DOCS: Record<string, NodeDocs> = {
  trigger_manual: {
    whatFor: i(
      "Es el botón de arranque: el flujo corre cuando vos lo ejecutás o cuando otra parte de tu sistema lo llama por API.",
      "The start button: the flow runs when you launch it or when another system calls it via API.",
      "É o botão de início: o fluxo roda quando você o executa ou quando outro sistema o chama via API."
    ),
    whenToUse: i(
      "Ideal para probar el flujo mientras lo armás, o para tareas que disparás vos mismo (ej. generar un reporte cuando lo necesitás).",
      "Great for testing while you build, or for tasks you launch yourself (e.g. generate a report on demand).",
      "Ótimo para testar enquanto monta, ou para tarefas que você dispara (ex. gerar um relatório sob demanda)."
    ),
    tip: i("Usalo siempre al principio para probar antes de automatizar el disparo.", "Use it at the start to test before automating the trigger.", "Use no início para testar antes de automatizar o disparo."),
  },
  trigger_message: {
    whatFor: i(
      "Arranca el flujo automáticamente cada vez que un cliente escribe por un canal (web, WhatsApp, etc.).",
      "Starts the flow automatically whenever a customer writes on a channel (web, WhatsApp, etc.).",
      "Inicia o fluxo automaticamente sempre que um cliente escreve por um canal (web, WhatsApp, etc.)."
    ),
    whenToUse: i(
      "Perfecto para atención al cliente: responder consultas, derivar, registrar el mensaje.",
      "Perfect for customer support: answer questions, route, log the message.",
      "Perfeito para atendimento: responder, encaminhar, registrar a mensagem."
    ),
    tip: i("El texto del cliente queda en el dato {{message}} para los pasos siguientes.", "The customer's text is available as {{message}} for next steps.", "O texto do cliente fica em {{message}} para os próximos passos."),
  },
  trigger_schedule: {
    whatFor: i(
      "Hace que el flujo corra solo, repetido en el tiempo (cada hora, todos los días, etc.).",
      "Makes the flow run by itself on a repeating schedule (hourly, daily, etc.).",
      "Faz o fluxo rodar sozinho em um horário repetido (a cada hora, todos os dias, etc.)."
    ),
    whenToUse: i(
      "Ideal para tareas periódicas: enviar un resumen cada mañana, limpiar datos cada noche, recordatorios.",
      "Ideal for recurring tasks: send a daily summary, nightly cleanups, reminders.",
      "Ideal para tarefas periódicas: resumo diário, limpezas noturnas, lembretes."
    ),
  },
  trigger_webhook: {
    whatFor: i(
      "Arranca el flujo cuando otra aplicación le avisa pegándole a una dirección (URL) tuya.",
      "Starts the flow when another app notifies it by calling a URL of yours.",
      "Inicia o fluxo quando outro app avisa chamando uma URL sua."
    ),
    whenToUse: i(
      "Para conectar herramientas externas: que Stripe te avise de un pago, un formulario web te mande datos, etc.",
      "To connect external tools: have Stripe notify a payment, a web form send data, etc.",
      "Para conectar ferramentas externas: Stripe avisar um pagamento, um formulário enviar dados, etc."
    ),
    tip: i("Copiá la URL del webhook y pegala en la app externa que quiera avisarte.", "Copy the webhook URL and paste it into the external app that should notify you.", "Copie a URL do webhook e cole no app externo que deve avisar você."),
  },
  agent: {
    whatFor: i(
      "Le pasa el mensaje a un agente de inteligencia artificial y usa su respuesta en el flujo.",
      "Sends the message to an AI agent and uses its reply in the flow.",
      "Envia a mensagem a um agente de IA e usa a resposta no fluxo."
    ),
    whenToUse: i(
      "Cuando necesitás entender, redactar o responder en lenguaje natural: responder una consulta, resumir un texto, clasificar un pedido.",
      "When you need to understand, write or reply in natural language: answer a query, summarize text, classify a request.",
      "Quando precisa entender, redigir ou responder em linguagem natural: responder, resumir, classificar."
    ),
    tip: i("Elegí un agente ya entrenado con tu información para mejores respuestas.", "Pick an agent already trained on your info for better answers.", "Escolha um agente já treinado com sua informação para respostas melhores."),
  },
  kb_search: {
    whatFor: i(
      "Busca la información más relevante dentro de una base de conocimiento tuya (tus documentos, manuales, FAQs).",
      "Finds the most relevant info inside one of your knowledge bases (your docs, manuals, FAQs).",
      "Busca a informação mais relevante dentro de uma base de conhecimento sua (seus documentos, manuais, FAQs)."
    ),
    whenToUse: i(
      "Antes de responder con un agente, para que conteste con datos reales tuyos y no invente.",
      "Before answering with an agent, so it replies with your real data instead of guessing.",
      "Antes de responder com um agente, para que use seus dados reais e não invente."
    ),
    tip: i("Combinalo con un paso 'Agente': primero buscás, después el agente responde con eso.", "Pair it with an 'Agent' step: search first, then let the agent answer using it.", "Combine com um passo 'Agente': busque primeiro, depois o agente responde com isso."),
  },
  condition: {
    whatFor: i(
      "Hace que el flujo tome un camino u otro según si se cumple algo (Sí o No).",
      "Branches the flow one way or another depending on whether something is true (Yes or No).",
      "Faz o fluxo seguir um caminho ou outro conforme uma condição (Sim ou Não)."
    ),
    whenToUse: i(
      "Cuando querés decidir: '¿el mensaje dice urgente?' → si Sí, avisar; si No, seguir normal.",
      "When you need to decide: 'does the message say urgent?' → if Yes, alert; if No, continue.",
      "Quando precisa decidir: 'a mensagem diz urgente?' → se Sim, avisar; se Não, seguir."
    ),
    tip: i("Conectá el camino verde (Sí) y el rojo (No) a pasos distintos.", "Connect the green (Yes) and red (No) paths to different steps.", "Conecte o caminho verde (Sim) e o vermelho (Não) a passos diferentes."),
  },
  switch: {
    whatFor: i(
      "Manda el flujo por uno de varios caminos según el valor de un dato.",
      "Routes the flow down one of several paths based on a value.",
      "Direciona o fluxo por um de vários caminhos conforme um valor."
    ),
    whenToUse: i(
      "Cuando hay más de dos opciones: según la categoría del pedido (ventas, soporte, facturación) seguís por caminos distintos.",
      "When there are more than two options: route by request category (sales, support, billing).",
      "Quando há mais de duas opções: rotear pela categoria (vendas, suporte, faturamento)."
    ),
    tip: i("Si solo hay dos caminos, usá 'Si… entonces' que es más simple.", "If there are only two paths, use 'If… then' — it's simpler.", "Se há só dois caminhos, use 'Se… então', é mais simples."),
  },
  loop_for_each: {
    whatFor: i(
      "Repite los pasos siguientes una vez por cada elemento de una lista.",
      "Repeats the next steps once for each item in a list.",
      "Repete os próximos passos uma vez para cada item de uma lista."
    ),
    whenToUse: i(
      "Cuando tenés muchas cosas que procesar igual: mandar un email a cada contacto, revisar cada pedido de una lista.",
      "When you have many things to process the same way: email each contact, check each order in a list.",
      "Quando tem muitas coisas a processar igual: e-mail a cada contato, revisar cada pedido."
    ),
    tip: i("Dentro del loop, cada elemento está disponible como {{item}}.", "Inside the loop, each element is available as {{item}}.", "Dentro do loop, cada elemento está disponível como {{item}}."),
  },
  parallel: {
    whatFor: i(
      "Hace varias cosas al mismo tiempo en vez de una tras otra, y sigue cuando todas terminan.",
      "Does several things at once instead of one after another, then continues when all finish.",
      "Faz várias coisas ao mesmo tempo em vez de uma após a outra, e segue quando todas terminam."
    ),
    whenToUse: i(
      "Cuando hay tareas independientes que pueden correr juntas para ahorrar tiempo (ej. consultar 3 APIs a la vez).",
      "When there are independent tasks that can run together to save time (e.g. call 3 APIs at once).",
      "Quando há tarefas independentes que podem rodar juntas para ganhar tempo (ex. chamar 3 APIs)."
    ),
  },
  try_catch: {
    whatFor: i(
      "Intenta unos pasos y, si algo falla, sigue por un camino alternativo en lugar de cortar todo.",
      "Tries some steps and, if anything fails, takes an alternate path instead of stopping everything.",
      "Tenta alguns passos e, se algo falha, segue um caminho alternativo em vez de parar tudo."
    ),
    whenToUse: i(
      "Cuando un paso puede fallar (una API caída) y querés manejarlo con elegancia: reintentar, avisar, usar un valor por defecto.",
      "When a step might fail (an API down) and you want to handle it gracefully: retry, alert, use a default.",
      "Quando um passo pode falhar (uma API fora) e você quer tratar com elegância: tentar de novo, avisar, usar padrão."
    ),
    tip: i("El motivo del error queda disponible para el camino 'Si falla'.", "The error reason is available to the 'on error' path.", "O motivo do erro fica disponível para o caminho 'se falhar'."),
  },
  code: {
    whatFor: i(
      "Para gente técnica: corré un poco de código JavaScript a medida cuando ningún otro paso alcanza.",
      "For technical people: run a bit of custom JavaScript when no other step is enough.",
      "Para pessoas técnicas: rode um pouco de JavaScript quando nenhum outro passo basta."
    ),
    whenToUse: i(
      "Solo cuando necesitás una transformación de datos muy específica. Para lo común, usá 'Modificar datos' o 'Planilla'.",
      "Only when you need a very specific data transformation. For the usual, use 'Modify data' or 'Spreadsheet'.",
      "Só quando precisa de uma transformação muito específica. Para o comum, use 'Modificar dados' ou 'Planilha'."
    ),
    tip: i("Recibís los datos en `input` y devolvés un objeto con `return`.", "You get the data in `input` and return an object with `return`.", "Você recebe os dados em `input` e retorna um objeto com `return`."),
  },
  integration: {
    whatFor: i(
      "Ejecuta una acción en una de tus apps conectadas (Stripe, Notion, Slack, etc.).",
      "Runs an action in one of your connected apps (Stripe, Notion, Slack, etc.).",
      "Executa uma ação em um dos seus apps conectados (Stripe, Notion, Slack, etc.)."
    ),
    whenToUse: i(
      "Cuando querés hacer algo en otra herramienta: crear una factura, guardar una fila, mandar un mensaje de Slack.",
      "When you want to do something in another tool: create an invoice, save a row, send a Slack message.",
      "Quando quer fazer algo em outra ferramenta: criar fatura, salvar linha, mandar mensagem no Slack."
    ),
    tip: i("Primero conectá la app en la sección Integraciones; después aparece acá.", "Connect the app in Integrations first; then it shows up here.", "Conecte o app em Integrações primeiro; depois ele aparece aqui."),
  },
  http: {
    whatFor: i(
      "Le pega a cualquier servicio web por su dirección (URL), aunque no tenga una integración lista.",
      "Calls any web service by its URL, even without a ready-made integration.",
      "Chama qualquer serviço web pela URL, mesmo sem integração pronta."
    ),
    whenToUse: i(
      "Cuando una herramienta tiene API pero no está en tus integraciones. Si existe la integración, usala (es más fácil).",
      "When a tool has an API but isn't in your integrations. If the integration exists, prefer it (it's easier).",
      "Quando uma ferramenta tem API mas não está nas integrações. Se a integração existir, prefira-a."
    ),
    tip: i("'Traer datos' (GET) para leer; 'Enviar datos' (POST) para crear.", "'Get data' (GET) to read; 'Send data' (POST) to create.", "'Trazer dados' (GET) para ler; 'Enviar dados' (POST) para criar."),
  },
  transform: {
    whatFor: i(
      "Arma o reordena datos para el paso siguiente, combinando los datos que ya tenés.",
      "Builds or reshapes data for the next step by combining what you already have.",
      "Monta ou reorganiza dados para o próximo passo combinando o que você já tem."
    ),
    whenToUse: i(
      "Cuando un paso necesita los datos con cierta forma: armar un texto, juntar campos, preparar lo que va a una API.",
      "When a step needs data in a certain shape: build a text, join fields, prepare what goes to an API.",
      "Quando um passo precisa dos dados em certo formato: montar um texto, juntar campos, preparar o envio."
    ),
  },
  spreadsheet: {
    whatFor: i(
      "Hace cálculos con fórmulas como las de Excel (SUM, IF, BUSCARV y muchas más) sobre tus datos.",
      "Runs Excel-style formulas (SUM, IF, VLOOKUP and many more) over your data.",
      "Faz cálculos com fórmulas tipo Excel (SUM, IF, PROCV e muitas mais) sobre seus dados."
    ),
    whenToUse: i(
      "Cuando necesitás sumar, promediar, redondear o decidir con números, sin escribir código.",
      "When you need to sum, average, round or decide with numbers, without writing code.",
      "Quando precisa somar, fazer média, arredondar ou decidir com números, sem escrever código."
    ),
    tip: i("Los datos del paso anterior están en `input`. Ej: =SUM(input.ventas)", "The previous step's data is in `input`. E.g.: =SUM(input.sales)", "Os dados do passo anterior estão em `input`. Ex.: =SUM(input.vendas)"),
  },
  delay: {
    whatFor: i(
      "Pausa el flujo un tiempo antes de seguir con el paso siguiente.",
      "Pauses the flow for a while before continuing to the next step.",
      "Pausa o fluxo por um tempo antes de seguir."
    ),
    whenToUse: i(
      "Cuando querés esperar entre acciones: dar tiempo a que algo se procese, no saturar una API, espaciar mensajes.",
      "When you want to wait between actions: let something process, avoid hammering an API, space out messages.",
      "Quando quer esperar entre ações: dar tempo para processar, não saturar uma API, espaçar mensagens."
    ),
  },
  notify: {
    whatFor: i(
      "Manda un aviso (email o mensaje) a una persona.",
      "Sends a notification (email or message) to a person.",
      "Envia um aviso (e-mail ou mensagem) a uma pessoa."
    ),
    whenToUse: i(
      "Cuando alguien tiene que enterarse de algo: avisar al equipo de un lead nuevo, notificar un error, confirmar una acción.",
      "When someone needs to know something: alert the team of a new lead, notify an error, confirm an action.",
      "Quando alguém precisa saber de algo: avisar a equipe de um lead, notificar um erro, confirmar uma ação."
    ),
  },
  wait_human: {
    whatFor: i(
      "Pausa el flujo hasta que una persona apruebe o responda.",
      "Pauses the flow until a person approves or replies.",
      "Pausa o fluxo até uma pessoa aprovar ou responder."
    ),
    whenToUse: i(
      "Cuando hace falta una decisión humana antes de seguir: aprobar un descuento, revisar un texto antes de publicarlo.",
      "When a human decision is needed before continuing: approve a discount, review a text before publishing.",
      "Quando é preciso uma decisão humana antes de seguir: aprovar um desconto, revisar um texto."
    ),
  },
  subflow: {
    whatFor: i(
      "Ejecuta otro flujo que ya guardaste, como si fuera un paso más.",
      "Runs another flow you already saved, as if it were one more step.",
      "Executa outro fluxo que você já salvou, como se fosse mais um passo."
    ),
    whenToUse: i(
      "Cuando repetís la misma serie de pasos en varios flujos: armala una vez y reutilizala.",
      "When you repeat the same series of steps across flows: build it once and reuse it.",
      "Quando repete a mesma série de passos em vários fluxos: monte uma vez e reutilize."
    ),
  },
  note: {
    whatFor: i(
      "Es un comentario para explicar el flujo. No hace nada al ejecutarse.",
      "A comment to explain the flow. It does nothing when the flow runs.",
      "Um comentário para explicar o fluxo. Não faz nada na execução."
    ),
    whenToUse: i(
      "Para dejar aclaraciones a tu equipo (o a tu yo futuro) sobre cómo funciona el flujo.",
      "To leave clarifications for your team (or future you) about how the flow works.",
      "Para deixar explicações para sua equipe (ou seu eu futuro) sobre o fluxo."
    ),
  },
};

export function getNodeDocs(id: string): NodeDocs | undefined {
  return NODE_DOCS[id];
}

/** Bloque de doc para el system prompt del copiloto. */
export function docsForPrompt(id: string, locale: Locale = "es"): string {
  const d = NODE_DOCS[id];
  if (!d) return "";
  return `${d.whatFor[locale]} Cuándo: ${d.whenToUse[locale]}`;
}
