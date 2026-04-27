import { NeuralBackground } from "@/components/auth/NeuralBackground";
import { AgentOrgChart } from "@/components/auth/AgentOrgChart";
import { Syne, JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

const syne = Syne({ subsets: ["latin"], variable: "--font-syne", display: "swap" });
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-auth-mono",
  weight: ["400", "500"],
  display: "swap",
});

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn("flex min-h-screen bg-[#09090B]", syne.variable, mono.variable)}>
      {/* Left: form area */}
      <div className="relative flex w-full flex-col items-center justify-center px-8 md:w-[520px] md:shrink-0">
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: "radial-gradient(circle, #8b5cf6 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="absolute right-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-violet-500/15 to-transparent" />
        <div className="relative z-10 w-full max-w-[380px]">{children}</div>
      </div>

      {/* Right: neural brand panel */}
      <div className="relative hidden flex-1 overflow-hidden bg-[#060608] md:flex">
        <NeuralBackground />
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[#09090B] to-transparent" />

        <div className="relative z-20 flex w-full flex-col items-center justify-center gap-8 px-8">
          {/* Brand */}
          <div className="text-center">
            <div className="mb-4 flex justify-center">
              <div className="relative">
                <div className="absolute -inset-3 rounded-2xl bg-violet-500/8 blur-2xl" />
                <div className="relative flex h-14 w-14 items-center justify-center rounded-xl border border-violet-500/20 bg-zinc-900/90 shadow-xl shadow-violet-500/10">
                  <span
                    className="text-2xl font-bold text-white"
                    style={{ fontFamily: "var(--font-syne), system-ui" }}
                  >
                    O
                  </span>
                </div>
              </div>
            </div>
            <h2
              className="text-3xl font-bold tracking-tight text-white"
              style={{ fontFamily: "var(--font-syne), system-ui" }}
            >
              Orchester
            </h2>
            <p className="mx-auto mt-2 max-w-[200px] text-sm text-zinc-600">
              AI agent teams for your enterprise
            </p>
          </div>

          {/* Live label */}
          <div
            className="flex items-center gap-2"
            style={{ fontFamily: "var(--font-auth-mono), monospace" }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
            <span className="text-[10px] uppercase tracking-widest text-zinc-600">
              Live Agent Network
            </span>
          </div>

          <AgentOrgChart />
        </div>
      </div>
    </div>
  );
}
