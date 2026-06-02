import { getTranslations } from "next-intl/server";
import { Star, GitFork, Cpu, Globe, Code2 } from "lucide-react";

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

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n > 0 ? String(n) : "–";
}

export async function StatsBar() {
  const t = await getTranslations("marketing.stats");
  const { stars, forks } = await fetchGitHubStats();

  const items = [
    { icon: Star, value: fmt(stars), label: "GitHub stars" },
    { icon: GitFork, value: fmt(forks), label: "forks" },
    { icon: Cpu, value: "80+", label: t("providers") },
    { icon: Globe, value: "3", label: t("locales") },
    { icon: Code2, value: "100%", label: t("openSource") },
  ];

  return (
    <div className="border-y border-zinc-800/60 bg-zinc-900/20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-center gap-6 py-4 sm:gap-10">
          {items.map(({ icon: Icon, value, label }) => (
            <div key={label} className="flex items-center gap-2 text-zinc-500">
              <Icon size={13} className="shrink-0 text-zinc-700" />
              <span className="text-sm font-semibold text-zinc-300">{value}</span>
              <span className="text-xs text-zinc-600">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
