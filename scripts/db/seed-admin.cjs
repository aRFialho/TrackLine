const bcrypt = require("bcryptjs");
const { createClient } = require("./_shared.cjs");

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "dmov@trackline.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Alfenas@172839";
const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL || "dmov@op.com";
const OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD || "Dmov@321";

async function run() {
  const client = createClient();
  await client.connect();
  try {
    const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await client.query(
      `
      INSERT INTO public.app_users (email, password_hash, role, is_active, updated_at)
      VALUES ($1, $2, 'admin', TRUE, NOW())
      ON CONFLICT (email)
      DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        is_active = EXCLUDED.is_active,
        updated_at = NOW();
      `,
      [ADMIN_EMAIL, adminHash]
    );
    console.log(`Admin pronto: ${ADMIN_EMAIL}`);

    const operatorHash = await bcrypt.hash(OPERATOR_PASSWORD, 12);
    await client.query(
      `
      INSERT INTO public.app_users (email, password_hash, role, is_active, updated_at)
      VALUES ($1, $2, 'operator', TRUE, NOW())
      ON CONFLICT (email)
      DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        is_active = EXCLUDED.is_active,
        updated_at = NOW();
      `,
      [OPERATOR_EMAIL, operatorHash]
    );
    console.log(`Operador pronto: ${OPERATOR_EMAIL}`);
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error("Falha ao criar admin:", error.message);
  process.exit(1);
});
