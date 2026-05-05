const {
  createClient,
  ensureMetaTable,
  getAppliedMap,
  listMigrationFiles,
  readMigration
} = require("./_shared.cjs");

async function run() {
  const client = createClient();
  await client.connect();

  try {
    await ensureMetaTable(client);
    const files = listMigrationFiles();
    const applied = await getAppliedMap(client);

    if (files.length === 0) {
      console.log("Nenhuma migracao encontrada em db/migrations.");
      return;
    }

    let appliedCount = 0;

    for (const file of files) {
      const migration = readMigration(file);
      const previous = applied.get(migration.fileName);

      if (previous) {
        if (previous.checksum !== migration.checksum) {
          throw new Error(
            `Checksum divergente para ${migration.fileName}. ` +
              "A migracao ja aplicada foi alterada, crie uma nova migracao."
          );
        }
        console.log(`SKIP ${migration.fileName}`);
        continue;
      }

      console.log(`APPLY ${migration.fileName}`);
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2);",
          [migration.fileName, migration.checksum]
        );
        await client.query("COMMIT");
        appliedCount += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log(`Concluido. Migracoes aplicadas nesta execucao: ${appliedCount}.`);
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error("Falha ao migrar banco:", error.message);
  process.exit(1);
});

