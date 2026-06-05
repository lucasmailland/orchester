import { NextResponse } from "next/server";

/**
 * Helpers de respuesta API uniformes (audit A5).
 *
 * Histórico: cada ruta arma su `NextResponse.json` a mano. El shape de error ya
 * es mayormente uniforme (`{ error: string }`), pero las listas tenían 3 formas
 * distintas (`{ data }`, array suelto, `{ rows, hasMore, nextOffset }`). Estos
 * helpers fijan UNA forma para código nuevo y migraciones futuras, sin romper a
 * los consumidores existentes del frontend (que se migran de a uno).
 *
 * Convención:
 *   - Éxito puntual:   apiOk(data)                      → 200 { ...data } | data
 *   - Lista paginada:  apiList(items, { nextOffset })   → 200 { items, nextOffset?, hasMore }
 *   - Error:           apiError("mensaje", 400)         → { error: "mensaje" }
 */

export function apiOk<T>(data: T, init?: { status?: number; headers?: HeadersInit }): NextResponse {
  return NextResponse.json(data as object, {
    status: init?.status ?? 200,
    ...(init?.headers ? { headers: init.headers } : {}),
  });
}

export interface ListMeta {
  /** Offset para la próxima página (cursor simple). */
  nextOffset?: number;
}

export function apiList<T>(items: T[], meta?: ListMeta): NextResponse {
  return NextResponse.json({
    items,
    ...(meta?.nextOffset != null
      ? { nextOffset: meta.nextOffset, hasMore: true }
      : { hasMore: false }),
  });
}

export function apiError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
