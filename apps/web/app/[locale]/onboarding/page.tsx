import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { getCurrentSession } from "@/lib/workspace";

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await getCurrentSession();

  if (!session) {
    redirect(`/${locale}/login`);
  }

  return <OnboardingWizard locale={locale} />;
}
