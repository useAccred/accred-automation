import { z } from "zod";
import { getUser } from "../auth";
import type { User } from "../db";

/** Helpers shared by the bot API routes. */

export async function requireApiUser(): Promise<User | Response> {
  const user = await getUser();
  return user ?? Response.json({ error: "Sign in first." }, { status: 401 });
}

export async function readJson<Schema extends z.ZodType>(request: Request, schema: Schema): Promise<z.infer<Schema> | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
    return Response.json({ error: problems }, { status: 400 });
  }
  return parsed.data;
}

export const isUuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
