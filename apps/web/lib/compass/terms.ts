/**
 * Compass Terms Dictionary
 *
 * Source of truth for every technical term that the `TermDef` component renders.
 * Definitions follow the Compass Voice Guide (docs/COMPASS_VOICE.md):
 *
 *   - One sentence in `short` that fits inside a tooltip.
 *   - Two or three sentences in `long` for the "Learn more" expanded view.
 *   - Plain language. No jargon inside a definition (no defining "embedding" with "vector").
 *   - Spanish uses "tú" universally, neutral (no "vos", no "usted").
 *   - pt-BR is Brazilian Portuguese without regional slang.
 *
 * Adding a new term: extend `CompassTermKey` and `COMPASS_TERMS`. Translations are
 * mandatory in all three locales; PRs that ship a partial entry will be rejected.
 */

export type CompassLocale = "en" | "es" | "pt-BR";

export interface LocalizedString {
  en: string;
  es: string;
  "pt-BR": string;
}

export interface TermDefinition {
  /** One-line friendly definition that fits in a tooltip. */
  short: LocalizedString;
  /** Two or three sentences for the "Learn more" view. Optional. */
  long?: LocalizedString;
  /** Optional documentation link. */
  href?: string;
}

export type CompassTermKey =
  | "mnemosyne"
  | "brain"
  | "embedding"
  | "cosine"
  | "rem"
  | "dedup"
  | "mcp"
  | "rag"
  | "pgvector"
  | "recall"
  | "fact"
  | "chunk"
  | "flow"
  | "channel"
  | "prompt"
  | "agent"
  | "workspace"
  | "provider";

export const COMPASS_TERMS: Record<CompassTermKey, TermDefinition> = {
  mnemosyne: {
    short: {
      en: "Keeps your agents from forgetting users or repeating themselves. Our memory service runs in the background after every conversation.",
      es: "Evita que tus agentes olviden usuarios o se repitan. Nuestro servicio de memoria corre en segundo plano después de cada conversación.",
      "pt-BR":
        "Evita que seus agentes esqueçam usuários ou se repitam. Nosso serviço de memória roda em segundo plano após cada conversa.",
    },
    long: {
      en: "Keeps your agents from forgetting users or repeating themselves across sessions. Our memory service Mnemosyne saves, merges, and prunes what each agent learns on a schedule, so accuracy holds up without manual cleanup.",
      es: "Evita que tus agentes olviden a los usuarios o se repitan entre sesiones. Nuestro servicio de memoria Mnemosyne guarda, combina y depura lo que cada agente aprende de forma programada, para que la precisión se sostenga sin limpieza manual.",
      "pt-BR":
        "Evita que seus agentes esqueçam usuários ou se repitam entre sessões. Nosso serviço de memória Mnemosyne salva, combina e remove o que cada agente aprende de forma programada, para que a precisão se mantenha sem limpeza manual.",
    },
  },

  brain: {
    short: {
      en: "What your agents have actually learned. Inspect it before deploying changes that depend on persisted context.",
      es: "Lo que tus agentes realmente aprendieron. Revísalo antes de publicar cambios que dependan del contexto guardado.",
      "pt-BR":
        "O que seus agentes de fato aprenderam. Revise antes de publicar mudanças que dependem do contexto salvo.",
    },
    long: {
      en: "Shows you what your agents have actually learned, so you can audit it before deploying changes that depend on persisted context. The Brain page lists every stored fact, when it was learned, and lets you keep or remove items one by one.",
      es: "Te muestra lo que tus agentes realmente aprendieron, para que puedas auditarlo antes de publicar cambios que dependan del contexto guardado. La página Brain lista cada hecho almacenado, cuándo se aprendió, y te permite conservar o eliminar elementos uno a uno.",
      "pt-BR":
        "Mostra o que seus agentes de fato aprenderam, para que você possa auditar antes de publicar mudanças que dependem do contexto salvo. A página Brain lista cada fato armazenado, quando foi aprendido, e permite manter ou remover itens um a um.",
    },
  },

  embedding: {
    short: {
      en: "Lets agents recognize the same question phrased differently, instead of demanding exact wording. Each text becomes a list of numbers; similar meanings end up near each other.",
      es: "Permite que los agentes reconozcan la misma pregunta formulada de otra manera, en vez de exigir las palabras exactas. Cada texto se convierte en una lista de números; los significados parecidos quedan cerca entre sí.",
      "pt-BR":
        "Permite que os agentes reconheçam a mesma pergunta feita de outro jeito, em vez de exigir as palavras exatas. Cada texto vira uma lista de números; significados parecidos ficam próximos entre si.",
    },
    long: {
      en: "Lets agents recognize the same question phrased differently, instead of demanding exact wording. We convert each text into a list of numbers that captures its meaning, so two sentences that say the same thing end up close to each other and the agent can pull the right memory even when the user rewords the question.",
      es: "Permite que los agentes reconozcan la misma pregunta formulada de otra manera, en vez de exigir las palabras exactas. Convertimos cada texto en una lista de números que captura su significado, así dos oraciones que dicen lo mismo quedan cerca entre sí y el agente puede traer el recuerdo correcto aunque el usuario reformule la pregunta.",
      "pt-BR":
        "Permite que os agentes reconheçam a mesma pergunta feita de outro jeito, em vez de exigir as palavras exatas. Convertemos cada texto em uma lista de números que captura o significado, então duas frases que dizem a mesma coisa ficam próximas entre si e o agente consegue trazer a memória certa mesmo quando o usuário reformula a pergunta.",
    },
  },

  cosine: {
    short: {
      en: "How we decide that two memories are saying the same thing. Returns a score from 0 to 1 comparing the meaning of two texts.",
      es: "Así decidimos que dos recuerdos dicen lo mismo. Devuelve una puntuación de 0 a 1 que compara el significado de dos textos.",
      "pt-BR":
        "É como decidimos que duas memórias estão dizendo a mesma coisa. Devolve uma pontuação de 0 a 1 que compara o significado de dois textos.",
    },
    long: {
      en: "How we decide that two memories are saying the same thing, so your agents don't store duplicates or repeat themselves. The score compares two embeddings and returns a value close to 1 when they mean the same thing and close to 0 when they are unrelated.",
      es: "Así decidimos que dos recuerdos dicen lo mismo, para que tus agentes no guarden duplicados ni se repitan. La puntuación compara dos embeddings y devuelve un valor cercano a 1 cuando significan lo mismo y cercano a 0 cuando no tienen relación.",
      "pt-BR":
        "É como decidimos que duas memórias estão dizendo a mesma coisa, para que seus agentes não guardem duplicados nem se repitam. A pontuação compara dois embeddings e devolve um valor próximo de 1 quando significam a mesma coisa e próximo de 0 quando não têm relação.",
    },
  },

  rem: {
    short: {
      en: "A background pass that groups related facts into a shorter summary, like sleep does for memories.",
      es: "Una pasada en segundo plano que agrupa hechos relacionados en un resumen más corto, como hace el sueño con los recuerdos.",
      "pt-BR":
        "Uma passada em segundo plano que agrupa fatos relacionados em um resumo mais curto, como o sono faz com as memórias.",
    },
    long: {
      en: "REM consolidation reads recently learned facts, finds the ones that belong together, and merges them into a single cleaner record. The result is faster recall and less noise when the agent looks something up.",
      es: "La consolidación REM lee los hechos recién aprendidos, encuentra los que van juntos y los combina en un único registro más claro. El resultado es una recuperación más rápida y menos ruido cuando el agente busca algo.",
      "pt-BR":
        "A consolidação REM lê os fatos recém-aprendidos, encontra os que pertencem ao mesmo assunto e os combina em um único registro mais limpo. O resultado é uma recuperação mais rápida e menos ruído quando o agente busca alguma coisa.",
    },
  },

  dedup: {
    short: {
      en: "A pass that finds near-duplicate facts and merges them into one.",
      es: "Una pasada que encuentra hechos casi duplicados y los combina en uno solo.",
      "pt-BR": "Uma passada que encontra fatos quase duplicados e os combina em um só.",
    },
    long: {
      en: "Deduplication scans every fact in your memory, compares them in pairs, and merges the ones that say almost the same thing. It keeps the most complete version and removes the rest so your agents do not repeat themselves.",
      es: "La deduplicación recorre todos los hechos de tu memoria, los compara por pares y combina los que dicen casi lo mismo. Conserva la versión más completa y elimina el resto para que tus agentes no se repitan.",
      "pt-BR":
        "A deduplicação percorre todos os fatos da sua memória, compara em pares e combina os que dizem quase a mesma coisa. Mantém a versão mais completa e remove o resto para que seus agentes não se repitam.",
    },
  },

  mcp: {
    short: {
      en: "An open standard that lets agents talk to external tools through a single connection.",
      es: "Un estándar abierto que permite a los agentes hablar con herramientas externas a través de una sola conexión.",
      "pt-BR":
        "Um padrão aberto que permite aos agentes se comunicarem com ferramentas externas por uma única conexão.",
    },
    long: {
      en: "MCP stands for Model Context Protocol. Connecting a tool over MCP is similar to plugging in a USB device: the agent discovers what the tool can do and uses it without custom integration code.",
      es: "MCP significa Model Context Protocol. Conectar una herramienta por MCP es parecido a enchufar un dispositivo USB: el agente descubre qué puede hacer la herramienta y la utiliza sin necesidad de código de integración a medida.",
      "pt-BR":
        "MCP significa Model Context Protocol. Conectar uma ferramenta por MCP é parecido a plugar um dispositivo USB: o agente descobre o que a ferramenta sabe fazer e a utiliza sem precisar de código de integração feito sob medida.",
    },
    href: "https://modelcontextprotocol.io",
  },

  rag: {
    short: {
      en: "A technique that lets agents answer with your own documents instead of relying only on what the model was trained on.",
      es: "Una técnica que permite a los agentes responder con tus propios documentos en lugar de depender solo de lo que el modelo aprendió en su entrenamiento.",
      "pt-BR":
        "Uma técnica que permite aos agentes responderem com base nos seus próprios documentos em vez de depender apenas do que o modelo aprendeu no treinamento.",
    },
    long: {
      en: "RAG stands for Retrieval-Augmented Generation. The agent first searches your documents for relevant passages and then uses them as context for its answer. The result is responses grounded in your information instead of generic knowledge.",
      es: "RAG significa Retrieval-Augmented Generation. El agente primero busca pasajes relevantes en tus documentos y luego los utiliza como contexto para su respuesta. El resultado son respuestas basadas en tu información en lugar de conocimiento genérico.",
      "pt-BR":
        "RAG significa Retrieval-Augmented Generation. O agente primeiro busca trechos relevantes nos seus documentos e depois os usa como contexto para a resposta. O resultado são respostas baseadas nas suas informações em vez de conhecimento genérico.",
    },
  },

  pgvector: {
    short: {
      en: "Keeps your memory and your business data in the same database, instead of behind a second search engine to maintain. It's the Postgres extension that handles search-by-meaning natively.",
      es: "Mantiene tu memoria y tus datos de negocio en la misma base, en vez de detrás de un segundo motor de búsqueda que también tendrías que mantener. Es la extensión de Postgres que resuelve la búsqueda por significado de forma nativa.",
      "pt-BR":
        "Mantém sua memória e seus dados de negócio no mesmo banco, em vez de atrás de um segundo motor de busca que você também teria que manter. É a extensão do Postgres que resolve a busca por significado de forma nativa.",
    },
    long: {
      en: 'Keeps your memory and your business data in the same database, instead of behind a second search engine to maintain. pgvector adds a column type to Postgres for storing the numeric meaning of texts, so the same database can answer "which facts are closest in meaning to this one" directly.',
      es: 'Mantiene tu memoria y tus datos de negocio en la misma base, en vez de detrás de un segundo motor de búsqueda que también tendrías que mantener. pgvector agrega a Postgres un tipo de columna para guardar el significado numérico de los textos, así la misma base responde "qué hechos son los más cercanos en significado a este" de forma directa.',
      "pt-BR":
        'Mantém sua memória e seus dados de negócio no mesmo banco, em vez de atrás de um segundo motor de busca que você também teria que manter. O pgvector adiciona ao Postgres um tipo de coluna para guardar o significado numérico dos textos, então o mesmo banco responde "quais fatos têm significado mais próximo deste" de forma direta.',
    },
  },

  recall: {
    short: {
      en: "Lets agents answer with what they already know about this user, instead of asking again. Triggered automatically by each incoming message.",
      es: "Permite que los agentes respondan con lo que ya saben de este usuario, en vez de volver a preguntar. Se dispara automáticamente con cada mensaje entrante.",
      "pt-BR":
        "Permite que os agentes respondam com o que já sabem sobre este usuário, em vez de perguntar de novo. Disparado automaticamente por cada mensagem recebida.",
    },
    long: {
      en: "Lets agents answer with what they already know about this user, instead of asking again. On each incoming message we score every stored fact for relevance, pull the top matches into the prompt, and log which ones were used so you can see what your agents lean on.",
      es: "Permite que los agentes respondan con lo que ya saben de este usuario, en vez de volver a preguntar. Con cada mensaje entrante calificamos la relevancia de cada hecho guardado, llevamos los mejores al prompt y registramos cuáles se usaron, para que veas en qué se apoyan tus agentes.",
      "pt-BR":
        "Permite que os agentes respondam com o que já sabem sobre este usuário, em vez de perguntar de novo. A cada mensagem recebida pontuamos a relevância de cada fato salvo, levamos os melhores para o prompt e registramos quais foram usados, para que você veja no que seus agentes se apoiam.",
    },
  },

  fact: {
    short: {
      en: "One thing an agent decided is worth remembering. Pulled back into the prompt automatically on the next relevant message.",
      es: "Una cosa que un agente decidió que vale la pena recordar. Vuelve al prompt de forma automática en el próximo mensaje relevante.",
      "pt-BR":
        "Uma coisa que um agente decidiu que vale a pena lembrar. Volta ao prompt automaticamente na próxima mensagem relevante.",
    },
    long: {
      en: "One thing an agent decided is worth remembering across conversations, so it does not have to relearn it. Each fact is a single sentence with one idea plus the source it came from, and gets pulled back into the prompt automatically when the next relevant message arrives.",
      es: "Una cosa que un agente decidió que vale la pena recordar entre conversaciones, para no tener que volver a aprenderla. Cada hecho es una oración única con una idea, junto con la fuente de donde proviene, y vuelve al prompt de forma automática cuando llega el próximo mensaje relevante.",
      "pt-BR":
        "Uma coisa que um agente decidiu que vale a pena lembrar entre conversas, para não precisar aprender de novo. Cada fato é uma frase única com uma ideia, junto com a fonte de onde veio, e volta ao prompt automaticamente quando chega a próxima mensagem relevante.",
    },
  },

  chunk: {
    short: {
      en: "Why an uploaded document returns the right paragraph instead of the whole file. We split each document into pieces small enough to search precisely.",
      es: "Por qué un documento subido devuelve el párrafo correcto y no el archivo entero. Dividimos cada documento en piezas lo bastante pequeñas como para buscar con precisión.",
      "pt-BR":
        "Por que um documento enviado devolve o parágrafo certo em vez do arquivo inteiro. Dividimos cada documento em pedaços pequenos o suficiente para buscar com precisão.",
    },
    long: {
      en: "Why an uploaded document returns the right paragraph instead of the whole file. We split each document into smaller pieces called chunks, and the agent searches across them; pieces too small lose context, pieces too large hide the part that matters.",
      es: "Por qué un documento subido devuelve el párrafo correcto y no el archivo entero. Dividimos cada documento en piezas más pequeñas llamadas chunks, y el agente busca entre ellas; las piezas demasiado chicas pierden contexto, y las demasiado grandes esconden la parte que importa.",
      "pt-BR":
        "Por que um documento enviado devolve o parágrafo certo em vez do arquivo inteiro. Dividimos cada documento em pedaços menores chamados chunks, e o agente busca entre eles; pedaços pequenos demais perdem contexto, e grandes demais escondem a parte que importa.",
    },
  },

  flow: {
    short: {
      en: "A sequence of agents and steps that runs together to complete a task.",
      es: "Una secuencia de agentes y pasos que se ejecutan juntos para completar una tarea.",
      "pt-BR": "Uma sequência de agentes e etapas que rodam juntos para concluir uma tarefa.",
    },
    long: {
      en: "A flow is how you connect agents so they hand work to each other. Define the steps once, then run the flow on demand, on a schedule, or when a message arrives.",
      es: "Un flujo es la forma en que conectas a tus agentes para que se pasen el trabajo entre ellos. Defines los pasos una vez y luego ejecutas el flujo cuando lo necesitas, en un horario o al recibir un mensaje.",
      "pt-BR":
        "Um fluxo é a forma como você conecta os agentes para que eles passem o trabalho entre si. Você define as etapas uma vez e depois executa o fluxo sob demanda, em um horário ou quando uma mensagem chega.",
    },
  },

  channel: {
    short: {
      en: "A place where your agents talk to people, such as a website widget or a messaging app.",
      es: "Un lugar donde tus agentes hablan con personas, como un widget de sitio web o una aplicación de mensajería.",
      "pt-BR":
        "Um lugar onde seus agentes conversam com pessoas, como um widget de site ou um aplicativo de mensagens.",
    },
    long: {
      en: "A channel is the doorway between your agents and your users. Each channel handles a different surface, such as Telegram, WhatsApp, email, or a web widget, and routes messages back to the same agent.",
      es: "Un canal es la puerta de entrada entre tus agentes y tus usuarios. Cada canal gestiona una superficie distinta, como Telegram, WhatsApp, correo electrónico o un widget web, y dirige los mensajes al mismo agente.",
      "pt-BR":
        "Um canal é a porta de entrada entre seus agentes e seus usuários. Cada canal cuida de uma superfície diferente, como Telegram, WhatsApp, e-mail ou um widget web, e direciona as mensagens para o mesmo agente.",
    },
  },

  prompt: {
    short: {
      en: "The instructions you give an agent so it knows how to behave.",
      es: "Las instrucciones que le das a un agente para que sepa cómo comportarse.",
      "pt-BR": "As instruções que você dá a um agente para que ele saiba como se comportar.",
    },
    long: {
      en: "A prompt is the written brief that defines an agent's role, tone, and limits. The clearer the prompt, the more predictable the agent's answers.",
      es: "Un prompt es el resumen escrito que define el papel, el tono y los límites del agente. Cuanto más claro sea el prompt, más predecibles serán las respuestas del agente.",
      "pt-BR":
        "Um prompt é o resumo escrito que define o papel, o tom e os limites do agente. Quanto mais claro o prompt, mais previsíveis serão as respostas do agente.",
    },
  },

  agent: {
    short: {
      en: "A configured assistant that handles a specific task, with its own prompt, model, and tools.",
      es: "Un asistente configurado que se ocupa de una tarea específica, con su propio prompt, modelo y herramientas.",
      "pt-BR":
        "Um assistente configurado para cuidar de uma tarefa específica, com prompt, modelo e ferramentas próprios.",
    },
    long: {
      en: "An agent is a unit of work in Compass. You give it a name, a prompt, a model, and a set of tools, and it handles every conversation that matches that role.",
      es: "Un agente es una unidad de trabajo en Compass. Le das un nombre, un prompt, un modelo y un conjunto de herramientas, y se ocupa de todas las conversaciones que correspondan a ese rol.",
      "pt-BR":
        "Um agente é uma unidade de trabalho no Compass. Você dá um nome, um prompt, um modelo e um conjunto de ferramentas, e ele cuida de todas as conversas que correspondem a esse papel.",
    },
  },

  workspace: {
    short: {
      en: "An isolated area for one team, with its own agents, memory, and billing.",
      es: "Un área aislada para un equipo, con sus propios agentes, memoria y facturación.",
      "pt-BR": "Uma área isolada para uma equipe, com agentes, memória e cobrança próprios.",
    },
    long: {
      en: "A workspace is the boundary that keeps each team's data separate. Members of one workspace cannot see the agents, channels, or memory of another, even on the same account.",
      es: "Un espacio de trabajo es el límite que mantiene separados los datos de cada equipo. Los miembros de un espacio no pueden ver los agentes, canales ni memoria de otro, aunque pertenezcan a la misma cuenta.",
      "pt-BR":
        "Um workspace é o limite que mantém os dados de cada equipe separados. Membros de um workspace não conseguem ver os agentes, canais ou memória de outro, mesmo na mesma conta.",
    },
  },

  provider: {
    short: {
      en: "The company that supplies the AI model your agents use, such as OpenAI or Anthropic.",
      es: "La empresa que provee el modelo de IA que usan tus agentes, como OpenAI o Anthropic.",
      "pt-BR":
        "A empresa que fornece o modelo de IA que seus agentes usam, como OpenAI ou Anthropic.",
    },
    long: {
      en: "A provider is the source of the model that powers an agent's answers. You connect a provider once with your own API key, and every agent in the workspace can then choose any model the provider offers.",
      es: "Un proveedor es la fuente del modelo que genera las respuestas del agente. Conectas un proveedor una vez con tu propia clave de API, y cualquier agente del espacio de trabajo puede luego elegir alguno de los modelos que ofrece.",
      "pt-BR":
        "Um provedor é a origem do modelo que gera as respostas do agente. Você conecta um provedor uma vez com sua própria chave de API, e qualquer agente do workspace pode então escolher um dos modelos que ele oferece.",
    },
  },
};

/**
 * Resolve a term's short definition in the active locale.
 * Falls back to English when the requested locale is missing.
 */
export function getTermShort(key: CompassTermKey, locale: CompassLocale): string {
  const entry = COMPASS_TERMS[key];
  return entry.short[locale] ?? entry.short.en;
}

/**
 * Resolve a term's long definition in the active locale.
 * Returns `undefined` if the term has no long form.
 */
export function getTermLong(key: CompassTermKey, locale: CompassLocale): string | undefined {
  const entry = COMPASS_TERMS[key];
  if (!entry.long) return undefined;
  return entry.long[locale] ?? entry.long.en;
}
