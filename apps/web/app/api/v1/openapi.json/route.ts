import { NextResponse } from "next/server";

const OPENAPI_DOC = {
  openapi: "3.1.0",
  info: {
    title: "Orchester Public API",
    version: "1",
    description: "REST API for managing agents, flows, and conversations via API key.",
  },
  servers: [{ url: "/api/v1", description: "Current version" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "API key (ok_live_…)" },
    },
    schemas: {
      Agent: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          role: { type: "string" },
          kind: { type: "string" },
          model: { type: "string" },
          status: { type: "string", enum: ["draft", "active", "inactive"] },
        },
      },
      Flow: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string", nullable: true },
          status: { type: "string" },
          version: { type: "integer" },
        },
      },
      PaginatedAgents: {
        type: "object",
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/Agent" } },
          nextCursor: { type: "string", nullable: true },
        },
      },
      PaginatedFlows: {
        type: "object",
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/Flow" } },
          nextCursor: { type: "string", nullable: true },
        },
      },
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
      },
    },
  },
  paths: {
    "/v1/agents": {
      get: {
        summary: "List agents",
        operationId: "listAgents",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 25, maximum: 100 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/PaginatedAgents" } },
            },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "403": {
            description: "Forbidden — insufficient scope",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "429": { description: "Rate limited" },
        },
      },
      post: {
        summary: "Create agent",
        operationId: "createAgent",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "role", "systemPrompt"],
                properties: {
                  name: { type: "string" },
                  role: { type: "string" },
                  systemPrompt: { type: "string" },
                  model: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { data: { $ref: "#/components/schemas/Agent" } },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
          "403": { description: "Forbidden — insufficient scope (agents:write required)" },
          "422": { description: "Validation error" },
        },
      },
    },
    "/v1/agents/{id}": {
      get: {
        summary: "Get agent",
        operationId: "getAgent",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { data: { $ref: "#/components/schemas/Agent" } },
                },
              },
            },
          },
          "404": { description: "Not found" },
        },
      },
      patch: {
        summary: "Update agent",
        operationId: "updateAgent",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  role: { type: "string" },
                  systemPrompt: { type: "string" },
                  model: { type: "string" },
                  status: { type: "string", enum: ["draft", "active", "inactive"] },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "OK" },
          "404": { description: "Not found" },
        },
      },
    },
    "/v1/flows": {
      get: {
        summary: "List flows",
        operationId: "listFlows",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 25, maximum: 100 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/PaginatedFlows" } },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
    },
  },
} as const;

export function GET() {
  return NextResponse.json(OPENAPI_DOC);
}
