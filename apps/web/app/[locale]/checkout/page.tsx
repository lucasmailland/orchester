import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/workspace";
import { CheckoutLauncher } from "@/components/billing/CheckoutLauncher";

/**
 * Launcher de checkout post-onboarding.
 *
 * Flujo real: el usuario eligió un plan pago en /pricing → /signup?plan=X →
 * onboarding → acá. Disparamos /api/billing/checkout y lo mandamos a Stripe.
 * Si Stripe está off (self-host), el componente lo manda al dashboard.
 */
export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ plan?: string }>;
}) {
  const { locale } = await params;
  const { plan } = await searchParams;
  const session = await getCurrentSession();
  if (!session) redirect(`/${locale}/login`);

  const validPlans = ["starter", "pro", "business"];
  if (!plan || !validPlans.includes(plan)) {
    redirect(`/${locale}`);
  }

  return <CheckoutLauncher locale={locale} plan={plan!} />;
}
