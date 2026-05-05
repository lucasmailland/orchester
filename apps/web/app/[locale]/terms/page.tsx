export default function TermsPage() {
  return (
    <div className="min-h-screen bg-black px-6 py-16 text-zinc-200">
      <div className="mx-auto max-w-3xl space-y-5 text-sm leading-relaxed">
        <h1 className="font-display text-3xl font-bold text-zinc-100">Términos del Servicio</h1>
        <p className="text-zinc-500">Última actualización: {new Date().toISOString().slice(0, 10)}</p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">1. Aceptación</h2>
        <p>
          Al usar Orchester aceptás estos términos. Si los usás en nombre de una organización,
          declarás tener autoridad para vincularla.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">2. Tu cuenta</h2>
        <p>
          Sos responsable de las acciones realizadas con tu cuenta. Mantené tus credenciales
          seguras. Notificanos sobre cualquier acceso no autorizado.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">3. Uso aceptable</h2>
        <p>
          Está prohibido: usar el servicio para spam, fraude, malware, contenido ilegal, infracción
          de propiedad intelectual, o para diseñar agentes que se hagan pasar por humanos sin
          consentimiento.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">4. Planes y pago</h2>
        <p>
          Los planes pagos se renuevan automáticamente al precio vigente. Podés cancelar cuando
          quieras desde Ajustes → Billing; el acceso se mantiene hasta el fin del período pagado.
          No hay reembolsos parciales por períodos no consumidos.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">5. Proveedores de LLM</h2>
        <p>
          Vos configurás tus propios providers (Anthropic, OpenAI, Google, Azure). Los costos de
          tokens corren por tu cuenta y se rigen por los términos del proveedor.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">6. Garantías y limitación</h2>
        <p>
          El servicio se provee &quot;tal cual&quot;. No garantizamos disponibilidad ininterrumpida.
          Nuestra responsabilidad máxima se limita al monto pagado por vos en los últimos 12 meses.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">7. Cambios</h2>
        <p>
          Podemos actualizar estos términos. Te avisaremos por email cambios materiales.
        </p>

        <h2 className="mt-6 text-lg font-semibold text-zinc-100">8. Contacto</h2>
        <p>
          <a href="mailto:legal@orchester.io" className="text-violet-400 underline">legal@orchester.io</a>
        </p>
      </div>
    </div>
  );
}
