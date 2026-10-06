import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

function connect() {
  const client = postgres(env.databaseUrl, { max: 10, onnotice: () => {} });
  return drizzle(client, { schema });
}

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { __accredDb?: ReturnType<typeof connect> };

export const db = new Proxy({} as ReturnType<typeof connect>, {
  get(_target, property) {
    const instance = (globalForDb.__accredDb ??= connect());
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export * from "./schema";
