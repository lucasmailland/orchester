import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { HeroSection } from "@/components/marketing/HeroSection";
import { ModelMarquee } from "@/components/marketing/ModelMarquee";
import { ProblemSection } from "@/components/marketing/ProblemSection";
import { TwoPatternsSection } from "@/components/marketing/TwoPatternsSection";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { PlatformTourSection } from "@/components/marketing/PlatformTourSection";
import { BrainSection } from "@/components/marketing/BrainSection";
import { FlowBuilderSection } from "@/components/marketing/FlowBuilderSection";
import { ComparisonSection } from "@/components/marketing/ComparisonSection";
import { TechStackSection } from "@/components/marketing/TechStackSection";
import { TestimonialsSection } from "@/components/marketing/TestimonialsSection";
import { FaqSection } from "@/components/marketing/FaqSection";
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
      <ProblemSection />
      <TwoPatternsSection />
      <HowItWorks />
      <PlatformTourSection />
      <BrainSection />
      <FlowBuilderSection />
      <ComparisonSection />
      <TechStackSection />
      <TestimonialsSection />
      <FaqSection />
      <OpenSourceCTA />
    </>
  );
}
