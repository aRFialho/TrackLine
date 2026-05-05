const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");
const dotenv = require("dotenv");

dotenv.config();

const migrationsDir = path.resolve(process.cwd(), "db", "migrations");

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL nao encontrada no ambiente.");
  }
  return url;
}

function createClient() {
  return new Client({
    connectionString: getDatabaseUrl()
  });
}

function ensureMigrationsDir() {
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }
}

function listMigrationFiles() {
  ensureMigrationsDir();
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

function readMigration(fileName) {
  const fullPath = path.join(migrationsDir, fileName);
  const sql = fs.readFileSync(fullPath, "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  return { fileName, fullPath, sql, checksum };
}

async function ensureMetaTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMap(client) {
  const result = await client.query(
    "SELECT name, checksum, applied_at FROM public.schema_migrations ORDER BY name ASC;"
  );
  return new Map(result.rows.map((row) => [row.name, row]));
}

module.exports = {
  createClient,
  ensureMetaTable,
  getAppliedMap,
  listMigrationFiles,
  readMigration
};

