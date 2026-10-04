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

/** Separa el workspace del secreto. No aparece en un cuid2 (alfanumérico). */
const SEPARADOR = ".";

/**
 * El secreto que viaja en el enlace de aprobación.
 *
 * Sin él, aprobar dependería de adivinar un `runId` — y lo que está del otro
 * lado de esa decisión puede ser un merge a producción. Es de un solo uso: al
 * resolverse la pausa se borra, así que un enlace reenviado por mail no sirve
 * dos veces.
 *
 * **Por qué lleva el workspace adelante.** Quien aprueba no tiene sesión: el
 * token es todo lo que trae. Pero para buscar el run hay que consultar
 * `flow_run`, y con FORCE RLS una consulta sin `app.workspace_id` no devuelve
 * filas — la primera versión guardaba un token opaco y buscaba con un `getDb()`
 * pelado, así que en cualquier deploy con RLS encendido TODA aprobación habría
 * contestado "este enlace no es válido", sin error y sin rastro. Con el
 * workspace adelante, la ruta establece el contexto antes de tocar la base.
 *
 * El workspace no es el permiso: la búsqueda sigue comparando el token
 * completo, así que conocer un workspaceId —que aparece en cualquier URL de la
 * aplicación— no acerca a nadie a adivinar los dos cuid2 del secreto.
 */
export function nuevoTokenDeAprobacion(workspaceId: string): string {
  return `apr_${workspaceId}${SEPARADOR}${createId()}${createId()}`;
}

/**
 * De qué workspace es este token, para poder consultar la base con contexto.
 *
 * Devuelve `undefined` si el token no tiene la forma esperada — un enlace
 * recortado por un cliente de mail, o inventado. Quien llama trata ese caso
 * igual que "no existe": nunca consulta sin workspace.
 */
export function workspaceDelToken(token: string): string | undefined {
  if (!token.startsWith("apr_")) return undefined;
  const corte = token.indexOf(SEPARADOR);
  if (corte <= "apr_".length) return undefined;
  const ws = token.slice("apr_".length, corte);
  // Un secreto sin workspace, o un workspace sin secreto, no sirven.
  return ws && token.length > corte + 1 ? ws : undefined;
}

/** Las dos únicas respuestas que el motor entiende. */
export type Decision = "aprobado" | "rechazado";

export function esDecision(v: unknown): v is Decision {
  return v === "aprobado" || v === "rechazado";
}
