export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black px-6 py-16 text-zinc-200">
      <div className="mx-auto max-w-3xl space-y-5 text-sm leading-relaxed">
        <h1 className="font-display text-3xl font-bold text-zinc-100">Política de Privacidad</h1>
        <p className="text-zinc-500">Última actualización: {new Date().toISOString().slice(0, 10)}</p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">1. Qué datos recolectamos</h2>
        <p>
          Recolectamos: (a) datos de cuenta (email, nombre); (b) datos del workspace (agentes,
          flujos, conversaciones, documentos subidos a knowledge bases); (c) metadata técnica (logs,
          IP, user-agent) con fines de seguridad y debugging.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">2. Cómo usamos tus datos</h2>
        <p>
          Para operar el servicio, mostrarte tu workspace, cobrarte (si tenés plan pago), y mantener
          la seguridad. <strong>No vendemos tus datos a terceros.</strong> Los prompts y respuestas
          de tus agentes se envían exclusivamente a los proveedores de LLM que vos configurás
          (Anthropic, OpenAI, Google, Azure) bajo sus respectivas políticas.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">3. Encriptación</h2>
        <p>
          Las API keys de proveedores se almacenan encriptadas con AES-256-GCM. Los datos en
          tránsito viajan sobre TLS 1.2+. Las contraseñas se hashean con argon2/bcrypt vía
          better-auth.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">4. Tus derechos (GDPR)</h2>
        <p>
          Podés exportar todos tus datos desde Ajustes → Exportar (JSON). Podés eliminar tu cuenta y
          todo su contenido en Ajustes → Cuenta → Eliminar. Cumplimos con GDPR, CCPA y LFPDPPP.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">5. Subprocesadores</h2>
        <p>
          Vercel (hosting), Postgres en Railway/Fly (DB), Resend (email transaccional), Stripe
          (cobros), Anthropic/OpenAI/Google (LLMs configurados por vos), Sentry (error tracking).
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">6. Contacto</h2>
        <p>
          Para preguntas de privacidad: <a href="mailto:privacy@orchester.io" className="text-violet-400 underline">privacy@orchester.io</a>.
        </p>
      </div>
    </div>
  );
}
