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
        "Mostra o que seus agentes de fato aprenderam, para que voce possa auditar antes de publicar mudanças que dependem do contexto salvo. A página Brain lista cada fato armazenado, quando foi aprendido, e permite manter ou remover itens um a um.",
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
      en: "Lets agents answer with what they already know about this user, instead of asking again. Triggered automatically by each incoming message.",
      es: "Permite que los agentes respondan con lo que ya saben de este usuario, en vez de volver a preguntar. Se dispara automáticamente con cada mensaje entrante.",
      "pt-BR":
        "Permite que os agentes respondam com o que já sabem sobre este usuário, em vez de perguntar de novo. Disparado automaticamente por cada mensagem recebida.",
    },
    long: {
      en: "Lets agents answer with what they already know about this user, instead of asking again. On each incoming message we score every stored fact for relevance, pull the top matches into the prompt, and log which ones were used so you can see what your agents lean on.",
      es: "Permite que los agentes respondan con lo que ya saben de este usuario, en vez de volver a preguntar. Con cada mensaje entrante calificamos la relevancia de cada hecho guardado, llevamos los mejores al prompt y registramos cuáles se usaron, para que veas en qué se apoyan tus agentes.",
      "pt-BR":
        "Permite que os agentes respondam com o que já sabem sobre este usuário, em vez de perguntar de novo. A cada mensagem recebida pontuamos a relevância de cada fato salvo, levamos os melhores para o prompt e registramos quais foram usados, para que voce veja no que seus agentes se apoiam.",
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
