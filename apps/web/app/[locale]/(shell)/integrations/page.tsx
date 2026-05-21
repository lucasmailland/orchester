import { IntegrationsClient } from "@/components/integrations/IntegrationsClient";

export default async function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
          Integraciones
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Conectá Orchester con las herramientas que ya usás. Las credenciales se guardan
          encriptadas y cada integración expone acciones que tus agentes pueden ejecutar.
        </p>
      </div>
      <IntegrationsClient />
    </div>
  );
}
