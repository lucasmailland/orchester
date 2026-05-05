# API Routes Reference

> Every endpoint in `apps/web/app/api/`. Update when adding/changing routes.

## Conventions
- All `/api/*` routes are auth-gated unless explicitly marked **public**.
- Auth: cookie `better-auth.session_token` for the UI. Bearer
  `Authorization: Bearer ok_live_...` for `/api/v1/*`.
- Response: JSON with `{ error }` on failures.
- Workspace scoping: every query filters by `workspaceId` derived from the
  current session.

## Health
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | none | DB ping + uptime |

## Auth (better-auth)
| Method | Path | Auth | Notes |
|---|---|---|---|
| ALL | `/api/auth/[...all]` | varies | better-auth catch-all |

## Agents
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/agents` | session | List for workspace |
| POST | `/api/agents` | session | Quick create |
| GET | `/api/agents/[id]` | session | Full agent |
| PATCH | `/api/agents/[id]` | session | Update (any field) |
| DELETE | `/api/agents/[id]` | session | Delete |
| POST | `/api/agents/[id]/test-chat` | session | Live test, supports tools |
| POST | `/api/agents/[id]/generate-prompt` | session | 3 AI variations |
| GET | `/api/agents/[id]/versions` | session | Snapshots |
| POST | `/api/agents/[id]/versions` | session | Snapshot current state |
| POST | `/api/agents/[id]/versions/[vid]/restore` | session | Restore |

## Flows
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET / POST | `/api/flows` | session | List + create (optional `templateId`) |
| GET / PATCH / DELETE | `/api/flows/[id]` | session | |
| POST | `/api/flows/[id]/run` | session | Manual trigger |
| GET | `/api/flows/[id]/runs` | session | Last 50 runs |
| GET | `/api/flow-runs/[id]` | session | Run + steps |
| GET / POST | `/api/flows/[id]/webhooks` | session | Manage webhook secrets |
| PATCH / DELETE | `/api/flows/[id]/webhooks/[wid]` | session | |
| GET / POST | `/api/flows/[id]/schedules` | session | Cron schedules |
| PATCH / DELETE | `/api/flows/[id]/schedules/[wid]` | session | |
| GET / POST | `/api/flows/[id]/versions` | session | |
| POST | `/api/flows/[id]/versions/[vid]/restore` | session | |
| GET | `/api/flow-templates` | session | Public + workspace templates |
| POST / GET | `/api/webhooks/[secret]` | **public + HMAC opt** | Trigger flow |

## Knowledge
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET / POST | `/api/knowledge-bases` | session | |
| GET / PATCH / DELETE | `/api/knowledge-bases/[id]` | session | |
| GET / POST | `/api/knowledge-bases/[id]/docs` | session | Synchronous ingest |
| DELETE | `/api/knowledge-bases/[id]/docs/[did]` | session | |
| POST | `/api/knowledge-bases/[id]/search` | session | pgvector cosine |

## Channels
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET / POST | `/api/channels` | session | |
| GET / PATCH / DELETE | `/api/channels/[id]` | session | Update credentials → auto-config Telegram |
| POST | `/api/channels/telegram/webhook/[secret]` | **public** | Telegram inbound |

## Widget (public)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/embed?c=<channelId>` | **public** | Returns embed.js |
| POST / OPTIONS | `/api/widget/[channelId]/messages` | **public + CORS** | Visitor messages |

## Conversations
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/conversations` | session | Filters: status, channel, agentId, tag, search, from |
| GET / PATCH | `/api/conversations/[id]` | session | Includes messages on GET |
| POST / DELETE | `/api/conversations/[id]/takeover` | session | Operator take-over / release |
| POST | `/api/conversations/[id]/reply` | session | Manual operator reply |
| GET / POST | `/api/conversation-labels` | session | |
| DELETE | `/api/conversation-labels/[id]` | session | |

## Teams / Employees / Org
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET / POST | `/api/teams` | session | |
| GET / PATCH / DELETE | `/api/teams/[id]` | session | |
| PUT | `/api/employees/[id]/agents` | session | Set assignedAgentIds |
| GET | `/api/org-graph` | session | Workspace + teams + agents + agent-agent edges |

## AI Providers
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET / POST | `/api/providers` | session | |
| DELETE | `/api/providers/[id]` | session | |
| POST | `/api/providers/[id]/test` | session | Connection test + model discovery |

## Production / Developer
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET / POST | `/api/api-keys` | session | POST returns plain key ONCE |
| DELETE | `/api/api-keys/[id]` | session | Revoke (soft) |
| GET / POST | `/api/invites` | session | Invite by email |
| POST | `/api/invites/accept` | session | Body `{ token }` |
| GET / POST | `/api/webhooks-out` | session | Outbound subscriptions |
| PATCH / DELETE | `/api/webhooks-out/[id]` | session | |
| GET | `/api/audit-logs` | session | Last 500 |

## Billing
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/billing/checkout` | session | Body `{ plan }` → Stripe URL |
| POST | `/api/billing/portal` | session | Customer Portal URL |
| POST | `/api/billing/webhook` | **public + Stripe sig** | Subscription events |
| GET | `/api/billing/usage` | session | Plan + usage + limits |

## Public API v1
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/v1/agents` | Bearer + rate limit 60/min | Read |
| GET | `/api/v1/flows` | Bearer + rate limit 60/min | Read |

## Adding a new route
1. Create the file under `apps/web/app/api/...`.
2. Add an `assertCan(role, action)` check if it mutates.
3. **Add a row to this file** in the same commit.
4. If it's a new public endpoint, document the auth scheme explicitly.
