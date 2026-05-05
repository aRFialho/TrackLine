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

    let pending = 0;
    for (const file of files) {
      const migration = readMigration(file);
      const previous = applied.get(file);
      if (!previous) {
        console.log(`PENDING ${file}`);
        pending += 1;
        continue;
      }
      const sameChecksum = previous.checksum === migration.checksum;
      console.log(`${sameChecksum ? "APPLIED" : "MISMATCH"} ${file}`);
    }

    console.log(`Total: ${files.length} | Pendentes: ${pending}`);
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error("Falha ao consultar status:", error.message);
  process.exit(1);
});

