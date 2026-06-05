export default function TermsPage() {
  return (
    <div className="min-h-screen bg-black px-6 py-16 text-zinc-200">
      <div className="mx-auto max-w-3xl space-y-5 text-sm leading-relaxed">
        <h1 className="font-display text-3xl font-bold text-zinc-100">Terms of Service</h1>
        <p className="text-zinc-500">Last updated: {new Date().toISOString().slice(0, 10)}</p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">1. Acceptance</h2>
        <p>
          By using Orchester you accept these terms. If you use the service on behalf of an
          organization, you represent that you have authority to bind it.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">2. Your account</h2>
        <p>
          You are responsible for actions taken with your account. Keep your credentials secure.
          Notify us of any unauthorized access.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">3. Acceptable use</h2>
        <p>
          Prohibited uses include: spam, fraud, malware, illegal content, intellectual-property
          infringement, and designing agents that impersonate humans without consent.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">4. Plans and payment</h2>
        <p>
          Paid plans renew automatically at the then-current price. You can cancel at any time from
          Settings → Billing; access continues through the end of the paid period. We don&apos;t
          offer partial refunds for unused periods.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">5. LLM providers</h2>
        <p>
          You configure your own providers (Anthropic, OpenAI, Google, Azure). Token costs are on
          your account and governed by the provider&apos;s terms.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">6. Warranties and liability</h2>
        <p>
          The service is provided &quot;as is&quot;. We don&apos;t guarantee uninterrupted
          availability. Our maximum liability is limited to the amount you paid in the past 12
          months.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">7. Changes</h2>
        <p>We may update these terms. We&apos;ll notify you by email of material changes.</p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">8. Contact</h2>
        <p>
          <a href="mailto:legal@orchester.io" className="text-violet-400 underline">
            legal@orchester.io
          </a>
        </p>
      </div>
    </div>
  );
}
