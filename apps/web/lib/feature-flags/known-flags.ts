// apps/web/lib/feature-flags/known-flags.ts
//
// SET-3: typed catalog of the experimental flags the product checks.
// The admin panel reads this to render toggles with human labels;
// `isEnabled(ws, key)` consumers reference these constants so a typo
// is a compile error.

export interface KnownFlag {
  key: string;
  label: string;
  description: string;
  /** Default when no row exists — always false for experimental features. */
  defaultOn: false;
}

export const KNOWN_FLAGS: readonly KnownFlag[] = [
  {
    key: "brain_graph_3d",
    label: "Brain graph — vista 3D",
    description: "Renderizado 3D experimental del grafo de memoria (react-force-graph-3d).",
    defaultOn: false,
  },
  {
    key: "recall_hyde",
    label: "Recall — HyDE",
    description: "Expansión de consulta HyDE en el recall semántico (experimental).",
    defaultOn: false,
  },
] as const;

export type KnownFlagKey = (typeof KNOWN_FLAGS)[number]["key"];
