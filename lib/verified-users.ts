import { getDb } from "@/lib/db";

let schemaReady: Promise<void> | null = null;

/** Add the verified flag safely for existing Core databases. */
export function ensureVerifiedUserSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = getDb();
      let addedColumn = false;
      try {
        await db.execute(
          "ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0"
        );
        addedColumn = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes("duplicate column")) {
          throw error;
        }
      }

      if (addedColumn) {
        await db.execute({
          sql: `
            UPDATE users
            SET is_verified = 1
            WHERE username = ? COLLATE NOCASE
          `,
          args: ["Jishal"],
        });
      }
    })().catch((error: unknown) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}
