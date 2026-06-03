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
      en: "The system that keeps your agents' long-term memory healthy and organized.",
      es: "El sistema que mantiene ordenada y saludable la memoria de largo plazo de tus agentes.",
      "pt-BR":
        "O sistema que mantém a memória de longo prazo dos seus agentes organizada e saudável.",
    },
    long: {
      en: "Mnemosyne is the background service that saves, combines, and removes the information your agents learn. It runs on a schedule so your agents stay accurate over time without manual cleanup.",
      es: "Mnemosyne es el servicio en segundo plano que guarda, combina y elimina la información que tus agentes aprenden. Se ejecuta de forma programada para que tus agentes mantengan su precisión con el tiempo sin necesidad de limpieza manual.",
      "pt-BR":
        "O Mnemosyne é o serviço em segundo plano que salva, combina e remove as informações que seus agentes aprendem. Ele roda de forma programada para que seus agentes mantenham a precisão ao longo do tempo sem limpeza manual.",
    },
  },

  brain: {
    short: {
      en: "The page where you inspect everything your agents have learned.",
      es: "La página donde puedes inspeccionar todo lo que tus agentes aprendieron.",
      "pt-BR": "A página onde você inspeciona tudo o que seus agentes aprenderam.",
    },
    long: {
      en: "Brain is the view of your agents' long-term memory. You can review individual facts, see when they were learned, and decide which ones to keep or remove.",
      es: "Brain es la vista de la memoria de largo plazo de tus agentes. Puedes revisar cada hecho, ver cuándo se aprendió y decidir cuáles conservar o eliminar.",
      "pt-BR":
        "O Brain é a visão da memória de longo prazo dos seus agentes. Você pode revisar cada fato, ver quando ele foi aprendido e decidir o que manter ou remover.",
    },
  },

  embedding: {
    short: {
      en: "The numeric representation of a text that lets agents find similar information, not only identical matches.",
      es: "La representación numérica de un texto que permite a los agentes encontrar información parecida, no solo coincidencias exactas.",
      "pt-BR":
        "A representação numérica de um texto que permite aos agentes encontrar informações parecidas, não apenas correspondências exatas.",
    },
    long: {
      en: "An embedding turns a sentence into a list of numbers that captures its meaning. Two sentences with similar meaning produce similar numbers, so the agent can recall information even when the user phrases the question differently.",
      es: "Un embedding convierte una oración en una lista de números que captura su significado. Dos oraciones con significado parecido producen números parecidos, por lo que el agente puede recordar información aunque la pregunta esté redactada de otra forma.",
      "pt-BR":
        "Um embedding transforma uma frase em uma lista de números que captura o significado dela. Duas frases com significado parecido produzem números parecidos, então o agente consegue recordar a informação mesmo quando a pergunta é feita de outro jeito.",
    },
  },

  cosine: {
    short: {
      en: "A score from 0 to 1 that measures how close two texts are in meaning.",
      es: "Una puntuación entre 0 y 1 que mide qué tan cercanos son dos textos en significado.",
      "pt-BR": "Uma pontuação de 0 a 1 que mede o quanto dois textos são próximos em significado.",
    },
    long: {
      en: "Cosine similarity compares two embeddings and returns a value close to 1 when they mean the same thing, and close to 0 when they are unrelated. We use it to decide when two facts are duplicates of each other.",
      es: "La similitud coseno compara dos embeddings y devuelve un valor cercano a 1 cuando significan lo mismo, y cercano a 0 cuando no tienen relación. La usamos para decidir cuándo dos hechos son duplicados.",
      "pt-BR":
        "A similaridade de cosseno compara dois embeddings e retorna um valor próximo de 1 quando eles significam a mesma coisa e próximo de 0 quando não têm relação. Usamos isso para decidir quando dois fatos são duplicados.",
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
      en: "The Postgres extension we use to store embeddings and search by meaning.",
      es: "La extensión de Postgres que usamos para guardar embeddings y buscar por significado.",
      "pt-BR":
        "A extensão do Postgres que usamos para armazenar embeddings e buscar por significado.",
    },
    long: {
      en: 'pgvector adds a new column type to Postgres for storing the numeric representation of texts. It lets the database answer questions like "which facts are closest in meaning to this one" directly, without a separate search engine.',
      es: 'pgvector agrega a Postgres un nuevo tipo de columna para guardar la representación numérica de los textos. Permite que la base de datos responda preguntas como "qué hechos son más cercanos en significado a este" directamente, sin un motor de búsqueda aparte.',
      "pt-BR":
        'O pgvector adiciona ao Postgres um novo tipo de coluna para guardar a representação numérica dos textos. Ele permite que o banco responda perguntas como "quais fatos têm significado mais próximo deste" diretamente, sem um motor de busca separado.',
    },
  },

  recall: {
    short: {
      en: "The moment an agent pulls a fact from memory to answer a question.",
      es: "El momento en que un agente recupera un hecho de la memoria para responder una pregunta.",
      "pt-BR":
        "O momento em que um agente recupera um fato da memória para responder a uma pergunta.",
    },
    long: {
      en: "Recall is how the agent decides which saved information is relevant to the current message. We track how often each fact is recalled so you can see what your agents actually rely on.",
      es: "La recuperación es la forma en que el agente decide qué información guardada es relevante para el mensaje actual. Registramos cuántas veces se recupera cada hecho para que puedas ver en qué se apoyan realmente tus agentes.",
      "pt-BR":
        "A recuperação é como o agente decide qual informação salva é relevante para a mensagem atual. Registramos quantas vezes cada fato é recuperado para que você veja no que seus agentes realmente se apoiam.",
    },
  },

  fact: {
    short: {
      en: "A single piece of information that an agent learned and can use later.",
      es: "Una unidad de información que un agente aprendió y puede usar después.",
      "pt-BR": "Uma unidade de informação que um agente aprendeu e pode usar depois.",
    },
    long: {
      en: "A fact is the smallest unit of memory: one sentence with one idea, plus the source it came from. Agents combine many facts to answer a question.",
      es: "Un hecho es la unidad mínima de memoria: una oración con una idea, junto con la fuente de donde proviene. Los agentes combinan varios hechos para responder una pregunta.",
      "pt-BR":
        "Um fato é a menor unidade de memória: uma frase com uma ideia, junto com a fonte de onde veio. Os agentes combinam vários fatos para responder a uma pergunta.",
    },
  },

  chunk: {
    short: {
      en: "A short piece of a longer document that the agent can read on its own.",
      es: "Un fragmento corto de un documento más largo que el agente puede leer de forma independiente.",
      "pt-BR":
        "Um trecho curto de um documento maior que o agente consegue ler de forma independente.",
    },
    long: {
      en: "When you upload a document, we split it into smaller pieces called chunks. The agent searches across chunks so it can find the right paragraph without re-reading the whole file every time.",
      es: "Cuando subes un documento, lo dividimos en fragmentos más pequeños llamados chunks. El agente busca entre esos fragmentos para encontrar el párrafo correcto sin tener que releer el archivo completo cada vez.",
      "pt-BR":
        "Quando você envia um documento, nós o dividimos em pedaços menores chamados chunks. O agente busca entre esses pedaços para encontrar o parágrafo certo sem precisar reler o arquivo inteiro toda vez.",
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
