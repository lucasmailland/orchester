// /[locale]/[workspaceSlug]/brain/review — v1.3 active-learning queue.
//
// Without this page, /brain/review fell through to the [factId] dynamic
// route which then tried to fetch a fact with id "review" and 500'd.
// The Inspector's header "Review queue" CTA was therefore dead.
import { ReviewClient } from "./ReviewClient";

export default function BrainReviewPage() {
  return <ReviewClient />;
}
