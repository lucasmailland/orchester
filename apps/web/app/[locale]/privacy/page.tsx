export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black px-6 py-16 text-zinc-200">
      <div className="mx-auto max-w-3xl space-y-5 text-sm leading-relaxed">
        <h1 className="font-display text-3xl font-bold text-zinc-100">Privacy Policy</h1>
        <p className="text-zinc-500">Last updated: {new Date().toISOString().slice(0, 10)}</p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">1. What data we collect</h2>
        <p>
          We collect: (a) account data (email, name); (b) workspace data (agents, flows,
          conversations, documents uploaded to knowledge bases); (c) technical metadata (logs, IP,
          user-agent) for security and debugging purposes.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">2. How we use your data</h2>
        <p>
          To operate the service, show you your workspace, bill you (if you&apos;re on a paid plan),
          and maintain security. <strong>We do not sell your data to third parties.</strong> Your
          agents&apos; prompts and responses are sent exclusively to the LLM providers you configure
          (Anthropic, OpenAI, Google, Azure) under their respective policies.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">3. Encryption</h2>
        <p>
          Provider API keys are stored encrypted with AES-256-GCM. Data in transit uses TLS 1.2+.
          Passwords are hashed with argon2/bcrypt via better-auth.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">4. Your rights (GDPR)</h2>
        <p>
          You can export all your data from Settings → Export (JSON). You can delete your account
          and all its content from Settings → Account → Delete. We comply with GDPR, CCPA, and
          LFPDPPP.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">5. Subprocessors</h2>
        <p>
          Vercel (hosting), Postgres on Railway/Fly (DB), Resend (transactional email), Stripe
          (payments), Anthropic/OpenAI/Google (LLMs you configure), Sentry (error tracking).
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">6. Contact</h2>
        <p>
          For privacy questions:{" "}
          <a href="mailto:privacy@orchester.io" className="text-violet-400 underline">
            privacy@orchester.io
          </a>
          .
        </p>
      </div>
    </div>
  );
}
