/**
 * Gate de seguridad para la ejecución de código/fórmulas arbitrarias.
 *
 * `node:vm` NO es una frontera de seguridad: desde adentro, `({}).constructor.
 * constructor("return process")()` escapa a Node completo (process.env con todos
 * los secretos, fs, red). Por eso la ejecución de código de usuario está
 * **deshabilitada por defecto** (fail-closed) y sólo se habilita explícitamente
 * en entornos que corren los flujos en un aislamiento real (proceso/worker
 * separado sin secretos en el env). Ver docs/superpowers/audits para el
 * follow-up de aislamiento out-of-process (atado a la cola de jobs).
 *
 * El chequeo vive en la ejecución y no sólo en la ruta API, para cubrir
 * TODOS los disparadores: manual, webhook y schedule. Las planillas también
 * evalúan en `node:vm`, así que pasan por el mismo gate.
 */
export function assertCodeExecutionAllowed(kind: "código JavaScript" | "fórmulas"): void {
  if (process.env.FLOW_CODE_EXECUTION !== "1") {
    throw new Error(
      `La ejecución de ${kind} está deshabilitada en este entorno por seguridad. ` +
        `Un administrador debe habilitar FLOW_CODE_EXECUTION=1, y sólo en un entorno ` +
        `con aislamiento de procesos (sin secretos en el environment).`
    );
  }
}
