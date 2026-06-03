import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { HeroSection } from "@/components/marketing/HeroSection";
import { ModelMarquee } from "@/components/marketing/ModelMarquee";
import { StatsBar } from "@/components/marketing/StatsBar";
import { FeaturesGrid } from "@/components/marketing/FeaturesGrid";
import { ProductShowcase } from "@/components/marketing/ProductShowcase";
import { ChannelsSection } from "@/components/marketing/ChannelsSection";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { TechStackSection } from "@/components/marketing/TechStackSection";
import { IntegrationsGrid } from "@/components/marketing/IntegrationsGrid";
import { OpenSourceCTA } from "@/components/marketing/OpenSourceCTA";

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function LandingPage({ params }: Props) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  if (session?.user) {
    redirect(`/${locale}/workspaces`);
  }

  return (
    <>
      <HeroSection />
      <ModelMarquee />
      <StatsBar />
      <FeaturesGrid />
      <ProductShowcase />
      <ChannelsSection />
      <HowItWorks />
      <TechStackSection />
      <IntegrationsGrid />
      <OpenSourceCTA />
    </>
  );
}
