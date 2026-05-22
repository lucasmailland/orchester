/**
 * Next.js Instrumentation hook — corre 1 vez en el server arranque.
 *
 * Acá:
 *   - (opcional) wireamos el adapter Redis del rate-limit si REDIS_URL existe
 *   - registramos handlers de SIGTERM/SIGINT para graceful shutdown
 *   - emitimos a observability cualquier crash
 *
 * Doc: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register(): Promise<void> {
  // Solo Node.js runtime (no Edge).
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;

  // ── Boot-time env validation (audit A6-1) ──────────────────────────
  // Fail fast at boot on a misconfigured deploy instead of 500ing on the
  // first request. Lazy import keeps this node-only module out of edge.
  try {
    const { validateEnv } = await import("./lib/env");
    validateEnv();
    console.log("[instrumentation] env validation OK");
  } catch (e) {
    console.error(
      "[instrumentation] FATAL: environment validation failed.\n" +
        (e instanceof Error ? e.message : String(e))
    );
    // Misconfigured env is unrecoverable — abort boot.
    process.exit(1);
  }

  // ── Redis rate-limit adapter (multi-node) ──────────────────────────
  // Activado solo si REDIS_URL está setteado. Sin Redis instalado se
  // mantiene el adapter in-memory default.
  const redisUrl = process.env["REDIS_URL"];
  if (redisUrl) {
    try {
      // Dynamic imports para que el bundle web no incluya redis si no se usa.
      const [{ setRateLimitAdapter }, { createRedisAdapter }, redisModule] =
        await Promise.all([
          import("./lib/rate-limit"),
          import("./lib/rate-limit-redis"),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          import("redis" as any).catch(() => null as any),
        ]);
      if (redisModule?.createClient) {
        const client = redisModule.createClient({ url: redisUrl });
        await client.connect();
        setRateLimitAdapter(createRedisAdapter(client));
        console.log("[instrumentation] Redis rate-limit adapter active");
      } else {
        console.warn(
          "[instrumentation] REDIS_URL set but `redis` package not installed. Run: pnpm add redis"
        );
      }
    } catch (e) {
      console.error("[instrumentation] failed to wire Redis adapter:", e);
    }
  }

  // ── Graceful shutdown ──────────────────────────────────────────────
  // Cuando el container recibe SIGTERM (docker stop, k8s pod terminate,
  // fly machine stop), Next.js cierra el HTTP server pero los in-flight
  // requests pueden seguir. Le damos 10s para que terminen antes de exit.
  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] received ${signal}, draining in-flight requests…`);
    // No hay un hook nativo de Next.js para "esperá los requests pendientes".
    // En la práctica, Node sale solo cuando el event loop queda vacío, así
    // que un setTimeout de 10s da margen. Para algo más robusto se necesita
    // un custom server.
    setTimeout(() => {
      console.log(`[shutdown] timeout reached, exiting`);
      process.exit(0);
    }, 10_000).unref();
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // ── Crash reporting ────────────────────────────────────────────────
  process.on("unhandledRejection", async (reason) => {
    const { safeLogError } = await import("./lib/safe-log");
    safeLogError("[unhandledRejection]", reason);
    const { captureException } = await import("./lib/observability");
    captureException(reason instanceof Error ? reason : new Error(String(reason)));
  });
  process.on("uncaughtException", async (err) => {
    const { safeLogError } = await import("./lib/safe-log");
    safeLogError("[uncaughtException]", err);
    const { captureException } = await import("./lib/observability");
    captureException(err);
  });
}
