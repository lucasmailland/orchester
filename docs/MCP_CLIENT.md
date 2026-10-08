# Connect an MCP server

Create an **MCP server** integration in the workspace integrations screen. Orchester uses the official TypeScript SDK (pinned to 1.32.1) with Streamable HTTP. No database migration is required.

- `url`: HTTPS endpoint, for example `https://mcp.example.com/mcp`.
- `authHeader`: optional complete Authorization header value. Configuration is encrypted using the existing AES-256-GCM integration store. The integration API never returns configuration or ciphertext. Connection errors expose a generic message, not remote response bodies.
- `toolAllowlist`: optional JSON array of exact remote tool names, for example `["search", "read_document"]`. Omitted/blank means annotation-based discovery; `[]` disables every tool.
- `timeoutMs`: positive integer, default `20000`, maximum `60000`. One deadline covers initialization, the operation and session cleanup.

## Private servers

Set `MCP_ALLOWED_PRIVATE_HOSTS` in the server/worker environment to a comma-separated list of exact hostnames or `host:port` pairs. For example, `localhost:8080` permits a local service on that port; a hostname without a port permits that host on any port. IPv6 literals use URL bracket notation. Entries are case insensitive; wildcards, schemes and paths are not supported.

Outside this allowlist, URLs must use HTTPS and pass the existing `assertPublicUrl` guard. Allowlisted endpoints may use HTTP for private deployments. URL credentials and redirects are rejected. This follows the existing guard's hostname checks; it does not add DNS resolution or DNS rebinding protection. Restrict deployment egress as appropriate for the environment.

## Discovery and agent access

Without an allowlist, only tools annotated `readOnlyHint: true` and without `destructiveHint: true` are offered. With an allowlist, only named tools are offered, including explicitly approved write/destructive tools. Annotations are server declarations, not proof of read-only behavior; use a read-only service credential when that guarantee is required.

Each remote definition records `effect: read | write`. Missing/false read-only annotations or a destructive annotation are classified as `write`, including explicitly allowed tools.

Tools appear under the integration name in the agent Advanced tab. Selected provider names are stored in `agent.tools`. Names follow `mcp__<integrationKey>__<toolName>`, where the key is the stable integration row ID. Both segments are sanitized to `[a-zA-Z0-9_-]` and truncated to 20 characters; a 16-character SHA-256 suffix over the original pair disambiguates sanitation/truncation collisions independently of discovery order. Total length is at most 64 characters. Duplicate resulting names fail closed.

Discovery is cached per workspace/integration for five minutes (up to 100 entries per process), without credentials in the cache. Updating an integration invalidates its local entry; a configuration fingerprint also prevents other processes from reusing discovery after configuration changes. Definitions from an unavailable server are omitted; healthy integrations and builtins remain usable. Execution rechecks workspace ownership, enabled status and current offering policy.

Calls return joined text parts and `[non-text content omitted]` for other content. The agent runtime and channel router retain their existing untrusted-output wrappers. Remote failures become ordinary tool errors. Structured observability records workspace/integration, remote tool, duration, success/error and argument keys only.

## Flow agent follow-up

The flow `agent` node is intentionally unchanged. In its upcoming tool-capable rewrite, resolve definitions inside its workspace transaction:

```ts
const toolDefs = await resolveToolDefinitions(
  workspaceId,
  agent.tools ?? [],
  tx
);
```

Import `resolveToolDefinitions` from `@/lib/tools` and retain the same untrusted-output handling when executing tools.
