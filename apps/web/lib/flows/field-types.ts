/**
 * Tipos de campo del inspector de flujos.
 *
 * Cada nodo del `node-registry` declara una lista de `FieldDef`. El
 * `InspectorForm` se auto-genera a partir de esa lista: por cada campo renderiza
 * el control correcto + su label + ayuda + ejemplo. Así, agregar/editar un campo
 * de configuración es declarativo (no se toca la UI).
 */

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "key-value"
  | "json"
  | "code"
  | "agent-picker"
  | "kb-picker"
  | "integration-action"
  | "channel-picker"
  | "variable"
  | "duration"
  | "cron";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  /** Path dentro de `node.config` (ej. "url", "op"). */
  key: string;
  /** Copy humano del label. */
  label: string;
  type: FieldType;
  placeholder?: string;
  /** Instrucción/explicación en lenguaje simple (clave para la intuitividad). */
  help?: string;
  /** Ejemplo concreto que se muestra inline. */
  example?: string;
  required?: boolean;
  /** Si true, se esconde bajo "Avanzado" (para no-técnicos). */
  advanced?: boolean;
  /** Opciones para `select`. */
  options?: FieldOption[];
  /** Mostrar este campo sólo si otro campo tiene cierto valor. */
  dependsOn?: { key: string; value: string };
}
