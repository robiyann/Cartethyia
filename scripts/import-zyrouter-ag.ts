import { readFileSync } from "node:fs";
import { getDb, closeDb } from "../src/persistence/postgres";
import { providerAccounts, providerOauthStates, tenants, modelAliases } from "../src/persistence/schema";
import { encryptCredential, hashSecret } from "../src/security/crypto";
import { eq, and } from "drizzle-orm";

async function main() {
  const db = getDb();
  
  // 1. Get default tenant
  const tenantRows = await db.select().from(tenants).limit(1);
  const tenantId = tenantRows[0]?.id;
  if (!tenantId) {
    console.error("No tenant found");
    process.exit(1);
  }
  console.log(`Using tenant: ${tenantId}`);

  // 2. Read json
  const raw = readFileSync("/tmp/zyrouter_ag_accounts.json", "utf8");
  const list = JSON.parse(raw);

  let insertedCount = 0;
  let updatedCount = 0;

  for (const item of list) {
    const d = JSON.parse(item.data);
    const email = d.email || item.name;
    const refreshToken = d.refreshToken;
    const accessToken = d.accessToken || d.apiKey;
    const expiresAtStr = d.expiresAt;
    const expiresAt = expiresAtStr ? new Date(expiresAtStr) : new Date(Date.now() + 3600 * 1000);

    if (!refreshToken) {
      console.log(`Skipping ${email}: no refresh token`);
      continue;
    }

    const fingerprint = hashSecret(refreshToken);

    // Check if account already exists
    const existing = await db
      .select()
      .from(providerAccounts)
      .where(
        and(
          eq(providerAccounts.providerId, "antigravity"),
          eq(providerAccounts.credentialFingerprint, fingerprint)
        )
      );

    let accountId: string;

    if (existing.length > 0) {
      accountId = existing[0].id;
      console.log(`Updating existing account: ${email} (${accountId})`);
      await db
        .update(providerAccounts)
        .set({
          label: email,
          status: item.isActive ? "active" : "disabled",
          credentialCiphertext: accessToken ? encryptCredential(accessToken) : undefined,
        })
        .where(eq(providerAccounts.id, accountId));

      await db
        .insert(providerOauthStates)
        .values({
          providerAccountId: accountId,
          refreshCiphertext: encryptCredential(refreshToken),
          expiresAt: expiresAt,
        })
        .onConflictDoUpdate({
          target: providerOauthStates.providerAccountId,
          set: {
            refreshCiphertext: encryptCredential(refreshToken),
            expiresAt: expiresAt,
          },
        });
      updatedCount++;
    } else {
      console.log(`Inserting new account: ${email}`);
      const [acc] = await db
        .insert(providerAccounts)
        .values({
          providerId: "antigravity",
          tenantId: tenantId,
          label: email,
          credentialKind: "oauth",
          credentialCiphertext: accessToken ? encryptCredential(accessToken) : encryptCredential(""),
          credentialFingerprint: fingerprint,
          status: item.isActive ? "active" : "disabled",
        })
        .returning({ id: providerAccounts.id });

      accountId = acc.id;

      await db.insert(providerOauthStates).values({
        providerAccountId: accountId,
        refreshCiphertext: encryptCredential(refreshToken),
        expiresAt: expiresAt,
      });
      insertedCount++;
    }
  }

  // Model aliases for convenient routing
  const aliases = [
    { alias: "gemini-3.7-flash-medium", target: "antigravity/gemini-3.7-flash" },
    { alias: "gemini-3.7-flash-high", target: "antigravity/gemini-3.7-flash" },
    { alias: "gemini-3.7-flash-low", target: "antigravity/gemini-3.7-flash" },
    { alias: "gemini-3.8-flash-medium", target: "antigravity/gemini-3.8-flash" },
    { alias: "gemini-3.8-flash-high", target: "antigravity/gemini-3.8-flash" },
    { alias: "gemini-3.8-flash-low", target: "antigravity/gemini-3.8-flash" },
    { alias: "ag/gemini-3.7-flash", target: "antigravity/gemini-3.7-flash" },
    { alias: "ag/gemini-3.7-flash-medium", target: "antigravity/gemini-3.7-flash" },
    { alias: "ag/gemini-3.7-flash-high", target: "antigravity/gemini-3.7-flash" },
    { alias: "ag/gemini-3.8-flash", target: "antigravity/gemini-3.8-flash" },
    { alias: "ag/gemini-3.8-flash-medium", target: "antigravity/gemini-3.8-flash" },
    { alias: "ag/claude-sonnet-4-5", target: "antigravity/claude-sonnet-4-5" },
    { alias: "ag/claude-opus-4-5", target: "antigravity/claude-opus-4-5" },
  ];

  for (const { alias, target } of aliases) {
    const existingAlias = await db
      .select()
      .from(modelAliases)
      .where(and(eq(modelAliases.tenantId, tenantId), eq(modelAliases.alias, alias)));

    if (existingAlias.length > 0) {
      await db
        .update(modelAliases)
        .set({ targetModel: target, updatedAt: new Date() })
        .where(eq(modelAliases.id, existingAlias[0].id));
    } else {
      await db.insert(modelAliases).values({
        tenantId,
        alias,
        targetModel: target,
      });
    }
  }

  console.log(`\nDone! Inserted: ${insertedCount}, Updated: ${updatedCount}, Aliases configured: ${aliases.length}`);
  await closeDb();
}

main().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
