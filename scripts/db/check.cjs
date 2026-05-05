const { createClient } = require("./_shared.cjs");

async function run() {
  const client = createClient();
  await client.connect();
  try {
    const result = await client.query("SELECT NOW() AS now_utc;");
    console.log("Conexao OK. Horario do banco:", result.rows[0].now_utc);
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error("Falha na conexao:", error.message);
  process.exit(1);
});

