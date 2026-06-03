import { getTranslations } from "next-intl/server";
import { Star, GitFork, Cpu, Globe, Code2 } from "lucide-react";
import { AnimatedNumber } from "./AnimatedNumber";

async function fetchGitHubStats() {
  try {
    const res = await fetch("https://api.github.com/repos/lucasmailland/orchester", {
      next: { revalidate: 3600 },
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return { stars: 0, forks: 0 };
    const data = (await res.json()) as { stargazers_count?: number; forks_count?: number };
    return { stars: data.stargazers_count ?? 0, forks: data.forks_count ?? 0 };
  } catch {
    return { stars: 0, forks: 0 };
  }
}

export async function StatsBar() {
  const t = await getTranslations("marketing.stats");
  const { stars, forks } = await fetchGitHubStats();

  // For animation: pass numbers where we can animate, strings for "–" fallback.
  // Stars >= 1000 → divide by 1000 and show with 1 decimal + "k" suffix.
  const starsValue: number | string = stars >= 1000 ? stars / 1000 : stars > 0 ? stars : "–";
  const starsDecimals = stars >= 1000 ? 1 : 0;
  const starsSuffix = stars >= 1000 ? "k" : "";

  const forksValue: number | string = forks > 0 ? forks : "–";

  const items: {
    icon: typeof Star;
    value: number | string;
    suffix?: string;
    decimals?: number;
    label: string;
  }[] = [
    {
      icon: Star,
      value: starsValue,
      suffix: starsSuffix,
      decimals: starsDecimals,
      label: "GitHub stars",
    },
    { icon: GitFork, value: forksValue, suffix: "", decimals: 0, label: "forks" },
    { icon: Cpu, value: 80, suffix: "+", decimals: 0, label: t("providers") },
    { icon: Globe, value: 3, suffix: "", decimals: 0, label: t("locales") },
    { icon: Code2, value: 100, suffix: "%", decimals: 0, label: t("openSource") },
  ];

  return (
    <div className="border-y border-zinc-800/60 bg-zinc-900/20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-center gap-6 py-4 sm:gap-10">
          {items.map(({ icon: Icon, value, suffix, decimals, label }) => (
            <div key={label} className="flex items-center gap-2 text-zinc-500">
              <Icon size={13} className="shrink-0 text-zinc-700" />
              <AnimatedNumber
                value={value}
                suffix={suffix ?? ""}
                decimals={decimals ?? 0}
                className="text-sm font-semibold text-zinc-300"
              />
              <span className="text-xs text-zinc-600">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
