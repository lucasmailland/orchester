// Fact detail / edit page.
import { FactDetailClient } from "../FactDetailClient";

export default async function FactDetailPage({ params }: { params: Promise<{ factId: string }> }) {
  const { factId } = await params;
  return <FactDetailClient factId={factId} />;
}
