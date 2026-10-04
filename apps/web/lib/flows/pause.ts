import { createId } from "@paralleldrive/cuid2";

/**
 * Señal de que un run llegó a un `wait_human` y debe quedar esperando a una
 * persona.
 *
 * Por qué una excepción y no un valor de retorno. El recorrido de nodos
 * (`runFromNode`) es **recursivo**: la posición del flow vive en la pila de
 * JavaScript, no en un contador. Devolver "pausá" obligaría a que cada nivel de
 * la recursión lo propague a mano, y bastaría olvidarse en uno para que el flow
 * siguiera de largo — que es exactamente el bug que estamos arreglando.
 * Lanzando, el desenrollado es automático y no se puede olvidar.
 *
 * Sigue el mismo camino que `AbortError`, que el motor ya trata aparte para
 * catalogar un run como `cancelled` en vez de `failed`.
 */
export class PauseRequested extends Error {
  readonly nodeId: string;
  readonly mensaje: string;
  readonly aviso: Aviso | undefined;

  constructor(nodeId: string, mensaje: string, aviso?: Aviso) {
    super(`wait_human: ${mensaje}`);
    this.name = "PauseRequested";
    this.nodeId = nodeId;
    this.mensaje = mensaje;
    this.aviso = aviso;
  }
}

/**
 * A quién avisarle que hay algo esperando. Una pausa que nadie ve es tan
 * inútil como no pausar: el run queda detenido y nadie se entera hasta que
 * alguien revisa a mano.
 */
export interface Aviso {
  /** `telegram::send_message`, `discord::send_message`, … */
  integrationId: string;
  /** Config del destino, tal como la espera esa integración. */
  input: Record<string, unknown>;
}

/**
 * El secreto que viaja en el enlace de aprobación.
 *
 * Sin él, aprobar dependería de adivinar un `runId` — y lo que está del otro
 * lado de esa decisión puede ser un merge a producción. Es de un solo uso: al
 * resolverse la pausa se borra, así que un enlace reenviado por mail no sirve
 * dos veces.
 */
export function nuevoTokenDeAprobacion(): string {
  return `apr_${createId()}${createId()}`;
}

/** Las dos únicas respuestas que el motor entiende. */
export type Decision = "aprobado" | "rechazado";

export function esDecision(v: unknown): v is Decision {
  return v === "aprobado" || v === "rechazado";
}
