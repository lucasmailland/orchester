// Memory Inspector — list view.
// Consumes D1's `/api/mnemo/*` surface. Defensive: handles 404 from
// not-yet-shipped routes by falling back to the empty state.
import { BrainInspectorClient } from "./BrainInspectorClient";

export default function BrainPage() {
  return <BrainInspectorClient />;
}
