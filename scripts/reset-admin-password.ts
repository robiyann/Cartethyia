import { ConsoleCredentialService } from "../src/console/auth/service";
import { getDb } from "../src/persistence/postgres";
import { consoleUsers } from "../src/persistence/schema";
import { eq } from "drizzle-orm";

const newPassword = process.argv[2] || "admin123";
const username = process.argv[3] || "admin";

const credentialService = new ConsoleCredentialService();
const passwordHash = await credentialService.hashPassword(newPassword);

const db = getDb();
await db
  .update(consoleUsers)
  .set({ passwordHash, updatedAt: new Date() })
  .where(eq(consoleUsers.username, username));

console.log(`✓ Password for user '${username}' successfully updated to: ${newPassword}`);
process.exit(0);
