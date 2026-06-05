import "@testing-library/jest-dom";
import { vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn(() => new Map()) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(() => null) } },
}));
vi.mock("@orchester/db", () => ({
  getDb: vi.fn(() => ({})),
  schema: {},
  createDbClient: vi.fn(() => ({})),
}));
