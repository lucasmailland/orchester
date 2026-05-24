// apps/web/tests/factories/index.ts
//
// Lightweight builders for in-memory test objects. Each builder returns
// a fully populated record with sensible defaults so tests only need to
// specify the field(s) under test.
import { faker } from "@faker-js/faker";
import { createId } from "@paralleldrive/cuid2";

export interface WorkspaceFactoryShape {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: "active" | "suspended" | "deleted";
}

export interface UserFactoryShape {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export interface AgentFactoryShape {
  id: string;
  workspaceId: string;
  name: string;
  role: string;
  systemPrompt: string;
  status: "active" | "inactive";
}

export const factory = {
  workspace: (overrides: Partial<WorkspaceFactoryShape> = {}): WorkspaceFactoryShape => ({
    id: `ws_${createId()}`,
    name: faker.company.name(),
    slug: faker.helpers.slugify(faker.company.name()).toLowerCase().slice(0, 30),
    timezone: "UTC",
    status: "active",
    ...overrides,
  }),

  user: (overrides: Partial<UserFactoryShape> = {}): UserFactoryShape => ({
    id: `usr_${createId()}`,
    email: faker.internet.email(),
    name: faker.person.fullName(),
    emailVerified: true,
    ...overrides,
  }),

  agent: (workspaceId: string, overrides: Partial<AgentFactoryShape> = {}): AgentFactoryShape => ({
    id: `agt_${createId()}`,
    workspaceId,
    name: faker.person.firstName() + " Bot",
    role: faker.person.jobTitle(),
    systemPrompt: faker.lorem.paragraph(),
    status: "active",
    ...overrides,
  }),
};
