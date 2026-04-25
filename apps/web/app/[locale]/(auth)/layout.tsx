export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Left: form area */}
      <div className="flex w-full flex-col items-center justify-center bg-background px-8 md:w-[480px] md:shrink-0">
        {children}
      </div>

      {/* Right: decorative gradient panel */}
      <div className="relative hidden flex-1 md:flex md:flex-col md:items-center md:justify-center overflow-hidden bg-gradient-to-br from-[#3B3BFF] via-[#4040E8] to-[#7C3AED]">
        {/* Glow orbs */}
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />

        <div className="relative z-10 px-12 text-center text-white">
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <span className="text-2xl font-bold">O</span>
            </div>
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Orchester</h2>
          <p className="mt-3 text-lg text-white/80">
            Build AI agent teams for your enterprise in minutes.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4 text-center">
            {[
              { label: "Templates", value: "6+" },
              { label: "AI Models", value: "12+" },
              { label: "Channels", value: "3" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm"
              >
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className="text-xs text-white/70">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
