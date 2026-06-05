// /[locale]/[workspaceSlug]/brain/recall-debug — Inspector UI v2.
//
// Server entry for the recall pipeline visualizer. All UI logic lives
// in the client component; this file exists so Next's App Router
// resolves the route without falling through to the dynamic
// /[factId] sibling.
import { RecallDebugClient } from "./RecallDebugClient";

export default function RecallDebugPage() {
  return <RecallDebugClient />;
}
