import "server-only";

/**
 * Helpers compartidos para fetch a servicios externos: timeout obligatorio y
 * retry con backoff exponencial + jitter para errores transitorios.
 *
 * Convención de errores: un error "retryable" es:
 *   - un timeout de `fetchWithTimeout` (lleva `name === "TimeoutError"`)
 *   - un error de red (TypeError de fetch, ECONNRESET, etc.)
 *   - un error que lleve un `status` numérico 429 o 5xx. Para que `withRetry`
 *     pueda decidir reintentar respuestas HTTP no-ok, lanzá un error con la
 *     propiedad `status` seteada (ver `HttpError`).
 */

/** Error que transporta el status HTTP para que `withRetry` decida reintentar. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Error lanzado cuando `fetchWithTimeout` aborta por exceder el timeout. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * `fetch` con timeout via AbortController. Si la request supera `timeoutMs`,
 * aborta y lanza un `TimeoutError` claro. El timer se limpia siempre (finally).
 *
 * Si el caller pasa su propio `signal`, lo respetamos combinándolo con el de
 * timeout via AbortSignal.any cuando está disponible.
 */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 30_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* keep raw url */
  }

  // Si el caller ya pasó un signal, combinarlo con el de timeout.
  let signal: AbortSignal = controller.signal;
  const callerSignal = init?.signal;
  if (callerSignal) {
    const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
    if (typeof anyFn === "function") {
      signal = anyFn([controller.signal, callerSignal]);
    }
  }

  try {
    return await fetch(url, { ...init, signal });
  } catch (e) {
    // Distinguir abort por timeout de un abort del caller.
    if (controller.signal.aborted && !callerSignal?.aborted) {
      throw new TimeoutError(`Request to ${host} timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Variante para streaming (SSE): aplica `connectTimeoutMs` SÓLO al
 * establecimiento de la conexión. Apenas llegan los headers de respuesta, el
 * timer se cancela para no abortar el body mientras se streamea. El abort
 * controller NO se asocia al body, así que leer el stream nunca dispara timeout.
 */
export async function fetchStreamWithConnectTimeout(
  url: string,
  init?: RequestInit,
  connectTimeoutMs = 120_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), connectTimeoutMs);
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* keep raw url */
  }
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // Headers llegaron: cancelar el timeout, el body se lee aparte.
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new TimeoutError(`Connection to ${host} timed out after ${connectTimeoutMs}ms`);
    }
    throw e;
  }
}

/** Default: reintenta en errores de red, timeouts, HTTP 429 y 5xx. */
export function defaultIsRetryable(e: unknown): boolean {
  if (e instanceof TimeoutError) return true;
  if (e instanceof HttpError) return e.status === 429 || (e.status >= 500 && e.status <= 599);
  // Errores de red de fetch (TypeError "fetch failed", ECONNRESET, etc.)
  if (e instanceof TypeError) return true;
  const code = (e as { code?: string })?.code;
  if (code && ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND"].includes(code))
    return true;
  // Errores que llevan un status colgado (sin ser HttpError).
  const status = (e as { status?: number })?.status;
  if (typeof status === "number") return status === 429 || (status >= 500 && status <= 599);
  return false;
}

export interface RetryOpts {
  retries?: number;
  baseMs?: number;
  isRetryable?: (e: unknown) => boolean;
}

/**
 * Ejecuta `fn` reintentando en errores transitorios con backoff exponencial +
 * jitter. Default: 2 reintentos (3 intentos totales), base 500ms.
 *
 * Usar SOLO para operaciones idempotentes / seguras de repetir (lecturas, o
 * completions de LLM que no tienen side-effects). NO envolver POSTs que crean
 * recursos no-deduplicables.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts?: RetryOpts): Promise<T> {
  const retries = opts?.retries ?? 2;
  const baseMs = opts?.baseMs ?? 500;
  const isRetryable = opts?.isRetryable ?? defaultIsRetryable;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === retries || !isRetryable(e)) throw e;
      const backoff = baseMs * 2 ** attempt;
      const jitter = Math.random() * backoff;
      await new Promise((res) => setTimeout(res, backoff + jitter));
    }
  }
  throw lastErr;
}
