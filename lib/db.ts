import { createClient, type Client } from "@libsql/client";

// A single shared libSQL client per server process/lambda instance.
// Never import this file from client components — it reads the auth
// token from a server-only environment variable.
let client: Client | null = null;

export function getDb(): Client {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error("TURSO_DATABASE_URL is not set");
  }

  client = createClient({
    url,
    authToken,
  });

  return client;
}
