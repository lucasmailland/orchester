// Load test del endpoint /api/agents/[id]/test-chat con k6.
//
// Uso:
//   k6 run --env BASE_URL=http://localhost:3000 \
//          --env COOKIE='better-auth.session_token=...' \
//          --env AGENT_ID=xxx \
//          --vus 50 --duration 5m \
//          scripts/loadtest-test-chat.js
//
// Mide:
//   - Latencia P50/P95/P99 del endpoint
//   - Tasa de errores (status != 200)
//   - Hits del rate-limit (429)
//
// Objetivo de SLA sugerido (1 réplica web + Postgres local):
//   - 50 RPS sostenido → P95 < 800ms (incluye llamada al provider)
//   - 0% errores 5xx
//   - <5% de 429 (significaría que estamos saturando rate-limit por user)

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const errors = new Counter("errors");
const rateLimited = new Counter("rate_limited");
const replyTime = new Trend("reply_time_ms");

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const COOKIE = __ENV.COOKIE || "";
const AGENT_ID = __ENV.AGENT_ID || "";

if (!AGENT_ID || !COOKIE) {
  throw new Error(
    "Set AGENT_ID and COOKIE env vars. Get cookie from a logged-in browser session."
  );
}

export const options = {
  thresholds: {
    "reply_time_ms{ok:true}": ["p(95)<800", "p(99)<2000"],
    errors: ["count<10"],
  },
  scenarios: {
    sustained: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "30s", target: 10 },
        { duration: "2m", target: 50 },
        { duration: "1m", target: 50 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "20s",
    },
  },
};

const PROMPTS = [
  "Hola, ¿qué es el horario de oficina?",
  "Necesito tomar 2 días de vacaciones",
  "¿Cuál es la política de home office?",
  "¿A quién contacto para problemas de IT?",
  "Calculame 15% de 240",
];

export default function () {
  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  const payload = JSON.stringify({
    messages: [{ role: "user", content: prompt }],
    systemPrompt: "Sos un asistente que responde corto y útil.",
    model: "claude-haiku-4-5",
    temperature: 0.7,
  });

  const start = Date.now();
  const r = http.post(`${BASE}/api/agents/${AGENT_ID}/test-chat`, payload, {
    headers: {
      "content-type": "application/json",
      cookie: COOKIE,
    },
    timeout: "30s",
  });
  const elapsed = Date.now() - start;

  const ok = check(r, {
    "status 200": (res) => res.status === 200,
  });
  if (!ok) {
    errors.add(1);
    if (r.status === 429) rateLimited.add(1);
  }
  replyTime.add(elapsed, { ok: String(ok) });
  sleep(Math.random() * 2);
}
