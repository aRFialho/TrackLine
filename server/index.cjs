const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const dayjs = require("dayjs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const envCandidates = [
  process.resourcesPath ? path.join(process.resourcesPath, ".env") : undefined,
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "..", ".env")
].filter(Boolean);

const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const app = express();
const port = Number(process.env.API_PORT || 8787);
const jwtSecret = process.env.JWT_SECRET || "trackline-dev-secret";

app.use(cors());
app.use(express.json({ limit: "4mb" }));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL nao encontrada no .env");
}

const pool = new Pool({
  connectionString: databaseUrl
});

const sseClients = new Set();

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role
    },
    jwtSecret,
    { expiresIn: "12h" }
  );
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ message: "Nao autenticado." });
    return;
  }
  const token = auth.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, jwtSecret);
    req.auth = payload;
    next();
  } catch (_error) {
    res.status(401).json({ message: "Token invalido ou expirado." });
  }
}

function requireAdmin(req, res, next) {
  if (req.auth?.role !== "admin") {
    res.status(403).json({ message: "Acesso restrito ao administrador." });
    return;
  }
  next();
}

function broadcastRefresh() {
  const payload = `event: refresh\ndata: {"at":"${new Date().toISOString()}"}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (_error) {
      // ignore broken pipe; close handler will cleanup
    }
  }
}

const mapSchedule = (row) => ({
  workStart: String(row.work_start).slice(0, 5),
  workEnd: String(row.work_end).slice(0, 5),
  lunchStart: String(row.lunch_start).slice(0, 5),
  lunchEnd: String(row.lunch_end).slice(0, 5)
});

const clampDate = (date, start, end) => {
  if (date.isBefore(start)) {
    return start;
  }
  if (date.isAfter(end)) {
    return end;
  }
  return date;
};

const dailyRange = (base, hhmm) => {
  const [hour, minute] = hhmm.split(":").map(Number);
  return base.hour(hour).minute(minute).second(0).millisecond(0);
};

const minutesBetween = (start, end) => {
  if (!end.isAfter(start)) {
    return 0;
  }
  return end.diff(start, "minute");
};

const calculateUsefulMinutes = (startIso, endIso, schedule) => {
  let cursor = dayjs(startIso);
  const end = dayjs(endIso);

  if (!end.isAfter(cursor)) {
    return 0;
  }

  let total = 0;
  while (cursor.startOf("day").isBefore(end) || cursor.isSame(end, "day")) {
    const base = cursor.startOf("day");
    const workStart = dailyRange(base, schedule.workStart);
    const workEnd = dailyRange(base, schedule.workEnd);
    const lunchStart = dailyRange(base, schedule.lunchStart);
    const lunchEnd = dailyRange(base, schedule.lunchEnd);

    const daySliceStart = clampDate(cursor, workStart, workEnd);
    const daySliceEnd = clampDate(end.isBefore(workEnd) ? end : workEnd, workStart, workEnd);

    if (daySliceEnd.isAfter(daySliceStart)) {
      const fullMinutes = minutesBetween(daySliceStart, daySliceEnd);
      const overlapStart = daySliceStart.isAfter(lunchStart) ? daySliceStart : lunchStart;
      const overlapEnd = daySliceEnd.isBefore(lunchEnd) ? daySliceEnd : lunchEnd;
      const lunchMinutes = minutesBetween(overlapStart, overlapEnd);
      total += Math.max(0, fullMinutes - lunchMinutes);
    }

    cursor = base.add(1, "day");
    if (cursor.isAfter(end)) {
      break;
    }
  }

  return total;
};

const parsePositiveNumber = (value) => {
  const normalizedValue = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalizedValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
};

const quantityEpsilon = 0.00001;

const readOperationQuantities = (operation) => {
  const releasedQuantity = Number(operation.released_quantity || 0);
  const completedQuantity = Number(operation.completed_quantity || 0);
  const availableQuantity = Math.max(0, releasedQuantity - completedQuantity);
  return { releasedQuantity, completedQuantity, availableQuantity };
};

async function assertPreviousSectorsDone(client, itemId, sectorPosition) {
  const pendingPreviousRs = await client.query(
    `
    SELECT COUNT(*)::int AS pending_count
    FROM public.item_operations io
    JOIN public.sectors s ON s.id = io.sector_id
    WHERE io.item_id = $1
      AND s.position < $2
      AND io.status <> 'CONCLUIDA';
    `,
    [itemId, sectorPosition]
  );

  if (Number(pendingPreviousRs.rows[0]?.pending_count || 0) > 0) {
    throw new Error("Nao e permitido pular etapas. Conclua os setores anteriores antes.");
  }
}

async function completeOperation(client, operation, employeeId, schedule, nowIso, requestedQuantity) {
  await assertPreviousSectorsDone(client, operation.item_id, operation.sector_position);

  const { releasedQuantity, completedQuantity, availableQuantity } = readOperationQuantities(operation);
  if (availableQuantity <= quantityEpsilon) {
    throw new Error("Sem quantidade liberada para baixa neste setor.");
  }

  const previousSectorRs = await client.query(
    `
    SELECT io.finished_at
    FROM public.item_operations io
    JOIN public.sectors s ON s.id = io.sector_id
    WHERE io.item_id = $1
      AND s.position < $2
      AND io.finished_at IS NOT NULL
    ORDER BY s.position DESC
    LIMIT 1;
    `,
    [operation.item_id, operation.sector_position]
  );

  const previousFinishedAt = previousSectorRs.rows[0]?.finished_at
    ? previousSectorRs.rows[0].finished_at.toISOString()
    : undefined;

  const startedAt = operation.started_at
    ? operation.started_at.toISOString()
    : previousFinishedAt || operation.released_at.toISOString();

  const quantityToProcess = Math.max(
    0,
    Math.min(availableQuantity, requestedQuantity ?? availableQuantity)
  );
  if (quantityToProcess <= quantityEpsilon) {
    throw new Error("Quantidade solicitada invalida para baixa.");
  }
  const updatedCompletedQuantity = completedQuantity + quantityToProcess;
  const isFullyDone = releasedQuantity > 0 && updatedCompletedQuantity >= releasedQuantity - quantityEpsilon;
  const usefulMinutes = isFullyDone ? calculateUsefulMinutes(startedAt, nowIso, schedule) : null;

  await client.query(
    `UPDATE public.item_operations
     SET employee_id=$1,
         status=$2::operation_status,
         started_at=COALESCE(started_at, $3::timestamptz),
         finished_at=$4,
         useful_minutes=$5,
         completed_quantity=$6
     WHERE id=$7;`,
    [
      employeeId,
      isFullyDone ? "CONCLUIDA" : "PENDENTE",
      startedAt,
      isFullyDone ? nowIso : null,
      usefulMinutes,
      updatedCompletedQuantity,
      operation.id
    ]
  );

  const nextOperationRs = await client.query(
    `
    SELECT io.id
    FROM public.item_operations io
    JOIN public.sectors s ON s.id = io.sector_id
    WHERE io.item_id = $1
      AND s.position > $2
      AND io.status = 'PENDENTE'
    ORDER BY s.position ASC
    LIMIT 1;
    `,
    [operation.item_id, operation.sector_position]
  );

  if (nextOperationRs.rows[0]) {
    await client.query(
      `UPDATE public.item_operations
       SET released_at = $1,
           released_quantity = released_quantity + $2
       WHERE id = $3;`,
      [nowIso, quantityToProcess, nextOperationRs.rows[0].id]
    );
  }

  return {
    usefulMinutes,
    processedQuantity: quantityToProcess,
    isFullyDone
  };
}

async function recomputeOrderStatus(client, orderId) {
  const orderStatusRs = await client.query(
    `
    SELECT po.id AS order_id,
           CASE
             WHEN BOOL_AND(io.status = 'CONCLUIDA') THEN 'FINALIZADA'
             ELSE 'ABERTA'
           END AS next_status
    FROM public.production_orders po
    JOIN public.production_items pi ON pi.order_id = po.id
    JOIN public.item_operations io ON io.item_id = pi.id
    WHERE po.id = $1
    GROUP BY po.id;
    `,
    [orderId]
  );

  if (!orderStatusRs.rows[0]) {
    return;
  }

  const nextStatus = orderStatusRs.rows[0].next_status;
  await client.query(
    "UPDATE public.production_orders SET status=$1::order_status, finished_at=CASE WHEN $1::order_status='FINALIZADA'::order_status THEN COALESCE(finished_at, NOW()) ELSE NULL END WHERE id=$2;",
    [nextStatus, orderId]
  );
}

async function loadSnapshot(client) {
  const [scheduleRs, sectorsRs, employeesRs, ordersRs, itemsRs, operationsRs, notificationsRs] = await Promise.all([
    client.query(
      "SELECT work_start, work_end, lunch_start, lunch_end FROM public.work_schedules ORDER BY created_at ASC LIMIT 1;"
    ),
    client.query("SELECT id, name FROM public.sectors ORDER BY position ASC, created_at ASC;"),
    client.query(`
      SELECT e.id,
             e.name,
             COALESCE(
               ARRAY_AGG(es.sector_id) FILTER (WHERE es.sector_id IS NOT NULL),
               ARRAY[e.sector_id]
             ) AS sector_ids
      FROM public.employees e
      LEFT JOIN public.employee_sectors es ON es.employee_id = e.id
      GROUP BY e.id, e.name, e.created_at, e.sector_id
      ORDER BY e.created_at ASC;
    `),
    client.query(
      "SELECT id, number, name, status, created_at, opened_at, finished_at FROM public.production_orders ORDER BY created_at DESC;"
    ),
    client.query(
      "SELECT id, order_id, quantity, unit, description FROM public.production_items ORDER BY created_at ASC;"
    ),
    client.query(
      "SELECT id, item_id, sector_id, employee_id, status, released_at, started_at, finished_at, useful_minutes, released_quantity, completed_quantity FROM public.item_operations ORDER BY created_at ASC;"
    ),
    client.query(
      `
      SELECT n.id,
             n.action,
             n.item_id,
             n.rollback_reason,
             n.batch_mode,
             n.requested_quantity,
             n.processed_quantity,
             n.created_at,
             u.email AS actor_email,
             po.number AS order_number,
             pi.description AS item_description,
             pi.quantity,
             pi.unit,
             s.name AS sector_name,
             e.name AS employee_name
      FROM public.operation_notifications n
      JOIN public.app_users u ON u.id = n.actor_user_id
      JOIN public.production_orders po ON po.id = n.order_id
      JOIN public.production_items pi ON pi.id = n.item_id
      JOIN public.sectors s ON s.id = n.sector_id
      LEFT JOIN public.employees e ON e.id = n.employee_id
      ORDER BY n.created_at DESC
      LIMIT 80;
      `
    )
  ]);

  const scheduleRow = scheduleRs.rows[0];
  const schedule = scheduleRow
    ? mapSchedule(scheduleRow)
    : {
        workStart: "08:00",
        workEnd: "18:00",
        lunchStart: "12:00",
        lunchEnd: "13:00"
      };

  const sectors = sectorsRs.rows.map((row) => ({
    id: row.id,
    name: row.name
  }));

  const employees = employeesRs.rows.map((row) => ({
    id: row.id,
    name: row.name,
    sectorIds: row.sector_ids || []
  }));

  const operationsByItem = operationsRs.rows.reduce((acc, row) => {
    const existing = acc.get(row.item_id) || [];
    existing.push({
      sectorId: row.sector_id,
      employeeId: row.employee_id || undefined,
      status: row.status,
      releasedAt: row.released_at.toISOString(),
      releasedQuantity: Number(row.released_quantity || 0),
      completedQuantity: Number(row.completed_quantity || 0),
      startedAt: row.started_at ? row.started_at.toISOString() : undefined,
      finishedAt: row.finished_at ? row.finished_at.toISOString() : undefined,
      usefulMinutes: typeof row.useful_minutes === "number" ? row.useful_minutes : undefined
    });
    acc.set(row.item_id, existing);
    return acc;
  }, new Map());

  const itemsByOrder = itemsRs.rows.reduce((acc, row) => {
    const existing = acc.get(row.order_id) || [];
    existing.push({
      id: row.id,
      quantity: Number(row.quantity),
      unit: row.unit,
      description: row.description,
      operations: operationsByItem.get(row.id) || []
    });
    acc.set(row.order_id, existing);
    return acc;
  }, new Map());

  const orders = ordersRs.rows.map((row) => ({
    id: row.id,
    number: row.number,
    name: row.name,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    openedAt: row.opened_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : undefined,
    items: itemsByOrder.get(row.id) || []
  }));

  const notifications = notificationsRs.rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorEmail: row.actor_email,
    orderNumber: row.order_number,
    itemId: row.item_id,
    itemDescription: row.item_description,
    quantity: Number(row.quantity),
    unit: row.unit,
    sectorName: row.sector_name,
    employeeName: row.employee_name || undefined,
    rollbackReason: row.rollback_reason || undefined,
    batchMode: row.batch_mode || undefined,
    requestedQuantity:
      typeof row.requested_quantity === "number" ? Number(row.requested_quantity) : row.requested_quantity ? Number(row.requested_quantity) : undefined,
    processedQuantity:
      typeof row.processed_quantity === "number" ? Number(row.processed_quantity) : row.processed_quantity ? Number(row.processed_quantity) : undefined,
    createdAt: row.created_at.toISOString()
  }));

  return { schedule, sectors, employees, orders, notifications };
}

app.get("/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now;");
    res.json({ ok: true, now: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/events", (req, res) => {
  const token = String(req.query?.token ?? "");
  if (!token) {
    res.status(401).json({ message: "Token ausente." });
    return;
  }

  try {
    jwt.verify(token, jwtSecret);
  } catch (_error) {
    res.status(401).json({ message: "Token invalido." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  if (typeof res.socket?.setNoDelay === "function") {
    res.socket.setNoDelay(true);
  }
  res.write(`event: connected\ndata: {"ok":true}\n\n`);

  sseClients.add(res);

  const keepAlive = setInterval(() => {
    res.write(`event: ping\ndata: {"at":"${new Date().toISOString()}"}\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
    res.end();
  });
});

app.post("/auth/login", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");

  if (!email || !password) {
    res.status(400).json({ message: "Informe email e senha." });
    return;
  }

  try {
    const result = await pool.query(
      "SELECT id, email, role, is_active, password_hash FROM public.app_users WHERE email = $1 LIMIT 1;",
      [email]
    );
    const user = result.rows[0];
    if (!user || !user.is_active) {
      res.status(401).json({ message: "Credenciais invalidas." });
      return;
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      res.status(401).json({ message: "Credenciais invalidas." });
      return;
    }

    const token = signAccessToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, email, role, is_active FROM public.app_users WHERE id = $1 LIMIT 1;",
      [req.auth.sub]
    );
    const user = result.rows[0];
    if (!user || !user.is_active) {
      res.status(401).json({ message: "Sessao invalida." });
      return;
    }
    res.json({
      id: user.id,
      email: user.email,
      role: user.role
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/bootstrap", requireAuth, async (_req, res) => {
  const client = await pool.connect();
  try {
    const snapshot = await loadSnapshot(client);
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.post("/schedule", requireAuth, requireAdmin, async (req, res) => {
  const { workStart, workEnd, lunchStart, lunchEnd } = req.body ?? {};
  if (!workStart || !workEnd || !lunchStart || !lunchEnd) {
    res.status(400).json({ message: "Horario invalido." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT id FROM public.work_schedules ORDER BY created_at ASC LIMIT 1;");
    if (existing.rows[0]) {
      await client.query(
        "UPDATE public.work_schedules SET work_start=$1, work_end=$2, lunch_start=$3, lunch_end=$4, updated_at=NOW() WHERE id=$5;",
        [workStart, workEnd, lunchStart, lunchEnd, existing.rows[0].id]
      );
    } else {
      await client.query(
        "INSERT INTO public.work_schedules (work_start, work_end, lunch_start, lunch_end) VALUES ($1, $2, $3, $4);",
        [workStart, workEnd, lunchStart, lunchEnd]
      );
    }
    await client.query("COMMIT");
    broadcastRefresh();
    const snapshot = await loadSnapshot(client);
    res.json(snapshot);
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.post("/sectors", requireAuth, requireAdmin, async (req, res) => {
  const { name } = req.body ?? {};
  if (!name || !String(name).trim()) {
    res.status(400).json({ message: "Nome do setor e obrigatorio." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const positionRs = await client.query("SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM public.sectors;");
    await client.query("INSERT INTO public.sectors (name, position) VALUES ($1, $2);", [
      String(name).trim(),
      Number(positionRs.rows[0].next_position)
    ]);
    await client.query("COMMIT");
    broadcastRefresh();
    const snapshot = await loadSnapshot(client);
    res.json(snapshot);
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.put("/sectors/:sectorId", requireAuth, requireAdmin, async (req, res) => {
  const { sectorId } = req.params;
  const { name } = req.body ?? {};
  const nextName = String(name ?? "").trim();
  if (!nextName) {
    res.status(400).json({ message: "Nome do setor e obrigatorio." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updateRs = await client.query("UPDATE public.sectors SET name=$1 WHERE id=$2 RETURNING id;", [nextName, sectorId]);
    if (!updateRs.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ message: "Setor nao encontrado." });
      return;
    }
    await client.query("COMMIT");
    broadcastRefresh();
    const snapshot = await loadSnapshot(client);
    res.json(snapshot);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error?.code === "23505") {
      res.status(400).json({ message: "Ja existe um setor com esse nome." });
      return;
    }
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.delete("/sectors/:sectorId", requireAuth, requireAdmin, async (req, res) => {
  const { sectorId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sectorCountRs = await client.query("SELECT COUNT(*)::int AS total FROM public.sectors;");
    if (Number(sectorCountRs.rows[0]?.total || 0) <= 1) {
      throw new Error("Nao e permitido excluir o unico setor existente.");
    }

    const operationsUsageRs = await client.query(
      "SELECT COUNT(*)::int AS total FROM public.item_operations WHERE sector_id=$1;",
      [sectorId]
    );
    if (Number(operationsUsageRs.rows[0]?.total || 0) > 0) {
      throw new Error("Setor em uso em ordens de producao. Nao e permitido excluir.");
    }

    const employeeUsageRs = await client.query(
      `
      SELECT (
        (SELECT COUNT(*) FROM public.employee_sectors WHERE sector_id=$1) +
        (SELECT COUNT(*) FROM public.employees WHERE sector_id=$1)
      )::int AS total;
      `,
      [sectorId]
    );
    if (Number(employeeUsageRs.rows[0]?.total || 0) > 0) {
      throw new Error("Setor vinculado a funcionarios. Remova os vinculos antes de excluir.");
    }

    const deleteRs = await client.query("DELETE FROM public.sectors WHERE id=$1 RETURNING id;", [sectorId]);
    if (!deleteRs.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ message: "Setor nao encontrado." });
      return;
    }

    const reorderRs = await client.query("SELECT id FROM public.sectors ORDER BY position ASC, created_at ASC;");
    for (let i = 0; i < reorderRs.rows.length; i += 1) {
      await client.query("UPDATE public.sectors SET position=$1 WHERE id=$2;", [i + 1, reorderRs.rows[i].id]);
    }

    await client.query("COMMIT");
    broadcastRefresh();
    const snapshot = await loadSnapshot(client);
    res.json(snapshot);
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.post("/sectors/reorder", requireAuth, requireAdmin, async (req, res) => {
  const sectorIds = Array.isArray(req.body?.sectorIds)
    ? req.body.sectorIds.map((value) => String(value).trim()).filter(Boolean)
    : [];

  if (sectorIds.length === 0) {
    res.status(400).json({ message: "Informe a ordem de setores." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingRs = await client.query("SELECT id FROM public.sectors ORDER BY created_at ASC;");
    const existingIds = existingRs.rows.map((row) => row.id);
    if (existingIds.length !== sectorIds.length || existingIds.some((id) => !sectorIds.includes(id))) {
      throw new Error("Lista de setores invalida para reordenacao.");
    }

    for (let i = 0; i < sectorIds.length; i += 1) {
      await client.query("UPDATE public.sectors SET position=$1 WHERE id=$2;", [i + 1, sectorIds[i]]);
    }
    await client.query("COMMIT");
    broadcastRefresh();
    const snapshot = await loadSnapshot(client);
    res.json(snapshot);
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.post("/employees", requireAuth, requireAdmin, async (req, res) => {
  const { name, sectorId, sectorIds } = req.body ?? {};
  const parsedSectorIds = Array.isArray(sectorIds)
    ? sectorIds.map((value) => String(value).trim()).filter(Boolean)
    : sectorId
      ? [String(sectorId).trim()]
      : [];

  if (!name || !String(name).trim() || parsedSectorIds.length === 0) {
    res.status(400).json({ message: "Funcionario invalido." });
    return;
  }

  const client = await pool.connect();
  try {
    const uniqueSectorIds = [...new Set(parsedSectorIds)];
    await client.query("BEGIN");
    const employeeRs = await client.query(
      "INSERT INTO public.employees (name, sector_id) VALUES ($1, $2) RETURNING id;",
      [String(name).trim(), uniqueSectorIds[0]]
    );
    const employeeId = employeeRs.rows[0].id;
    for (const linkedSectorId of uniqueSectorIds) {
      await client.query(
        "INSERT INTO public.employee_sectors (employee_id, sector_id) VALUES ($1, $2) ON CONFLICT (employee_id, sector_id) DO NOTHING;",
        [employeeId, linkedSectorId]
      );
    }
    await client.query("COMMIT");
    broadcastRefresh();
    const snapshot = await loadSnapshot(client);
    res.json(snapshot);
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.put("/employees/:employeeId", requireAuth, requireAdmin, async (req, res) => {
  const { employeeId } = req.params;
  const { name, sectorIds } = req.body ?? {};
  const parsedSectorIds = Array.isArray(sectorIds)
    ? sectorIds.map((value) => String(value).trim()).filter(Boolean)
    : [];

  if (!name || !String(name).trim() || parsedSectorIds.length === 0) {
    res.status(400).json({ message: "Dados invalidos para atualizar funcionario." });
    return;
  }

  const client = await pool.connect();
  try {
    const uniqueSectorIds = [...new Set(parsedSectorIds)];
    await client.query("BEGIN");
    const updateRs = await client.query(
      "UPDATE public.employees SET name=$1, sector_id=$2 WHERE id=$3 RETURNING id;",
      [String(name).trim(), uniqueSectorIds[0], employeeId]
    );

    if (!updateRs.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ message: "Funcionario nao encontrado." });
      return;
    }

    await client.query("DELETE FROM public.employee_sectors WHERE employee_id=$1;", [employeeId]);
    for (const linkedSectorId of uniqueSectorIds) {
      await client.query(
        "INSERT INTO public.employee_sectors (employee_id, sector_id) VALUES ($1, $2) ON CONFLICT (employee_id, sector_id) DO NOTHING;",
        [employeeId, linkedSectorId]
      );
    }

    await client.query("COMMIT");
    broadcastRefresh();
    const snapshot = await loadSnapshot(client);
    res.json(snapshot);
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.delete("/employees/:employeeId", requireAuth, requireAdmin, async (req, res) => {
  const { employeeId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM public.employees WHERE id=$1;", [employeeId]);
    broadcastRefresh();
    const snapshot = await loadSnapshot(client);
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.post("/orders/import", requireAuth, requireAdmin, async (req, res) => {
  const { number, name, rows } = req.body ?? {};
  if (!number || !Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ message: "Payload de importacao invalido." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const now = new Date();
    const sectorsRs = await client.query("SELECT id, position FROM public.sectors ORDER BY position ASC, created_at ASC;");
    if (sectorsRs.rows.length === 0) {
      throw new Error("Cadastre ao menos um setor antes de criar OP.");
    }

    const orderRs = await client.query(
      "INSERT INTO public.production_orders (number, name, status, created_at, opened_at) VALUES ($1, $2, 'ABERTA', $3, $3) RETURNING id;",
      [String(number).trim(), String(name || number).trim(), now]
    );

    const orderId = orderRs.rows[0].id;

    for (const row of rows) {
      const quantity = Number(row.quantity ?? 0);
      const unit = String(row.unit ?? "UN").trim() || "UN";
      const description = String(row.description ?? "").trim();
      if (!description || quantity <= 0) {
        continue;
      }

      const itemRs = await client.query(
        "INSERT INTO public.production_items (order_id, quantity, unit, description) VALUES ($1, $2, $3, $4) RETURNING id;",
        [orderId, quantity, unit, description]
      );
      const itemId = itemRs.rows[0].id;

      for (const sector of sectorsRs.rows) {
        const releasedQuantity = Number(sector.position) === 1 ? quantity : 0;
        await client.query(
          "INSERT INTO public.item_operations (item_id, sector_id, status, released_at, released_quantity, completed_quantity) VALUES ($1, $2, 'PENDENTE', $3, $4, 0);",
          [itemId, sector.id, now, releasedQuantity]
        );
      }
    }

    await client.query("COMMIT");
    broadcastRefresh();
    const snapshot = await loadSnapshot(client);
    res.json(snapshot);
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.post("/orders/:orderId/finalize", requireAuth, requireAdmin, async (req, res) => {
  const { orderId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("UPDATE public.production_orders SET status='FINALIZADA', finished_at=COALESCE(finished_at, NOW()) WHERE id=$1;", [
      orderId
    ]);
    broadcastRefresh();
    const snapshot = await loadSnapshot(client);
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.delete("/orders/:orderId", requireAuth, requireAdmin, async (req, res) => {
  const { orderId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM public.production_orders WHERE id=$1;", [orderId]);
    broadcastRefresh();
    const snapshot = await loadSnapshot(client);
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.post("/operations/toggle", requireAuth, async (req, res) => {
  const { itemId, sectorId, employeeId, done, reason, quantity } = req.body ?? {};
  if (!itemId || !sectorId || typeof done !== "boolean") {
    res.status(400).json({ message: "Payload de operacao invalido." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const operationRs = await client.query(
      `
      SELECT io.id,
             io.released_at,
             io.started_at,
             io.finished_at,
             io.useful_minutes,
             io.released_quantity,
             io.completed_quantity,
             io.employee_id AS previous_employee_id,
             s.position AS sector_position,
             pi.id AS item_id,
             pi.order_id,
             s.id AS sector_id
      FROM public.item_operations io
      JOIN public.production_items pi ON pi.id = io.item_id
      JOIN public.sectors s ON s.id = io.sector_id
      WHERE io.item_id=$1 AND io.sector_id=$2
      LIMIT 1;
      `,
      [itemId, sectorId]
    );
    const operation = operationRs.rows[0];
    if (!operation) {
      throw new Error("Operacao nao encontrada.");
    }

    let notificationEmployeeId = null;
    let notificationAction = "UNCONFIRM_OPERATION";
    let rollbackReason = null;
    let processedQuantity = null;
    let requestedQuantity = null;

    if (!done) {
      if (!String(reason ?? "").trim()) {
        throw new Error("Informe o motivo para retornar a operacao.");
      }

      const rollbackQuantity = parsePositiveNumber(quantity);
      if (!rollbackQuantity) {
        throw new Error("Informe uma quantidade valida para retorno.");
      }

      const { releasedQuantity, completedQuantity } = readOperationQuantities(operation);
      if (releasedQuantity <= quantityEpsilon) {
        throw new Error("Nao ha quantidade liberada para retornar ao setor anterior.");
      }
      if (rollbackQuantity > releasedQuantity + quantityEpsilon) {
        throw new Error(`Quantidade de retorno maior que a liberada (${releasedQuantity}).`);
      }

      const previousOperationRs = await client.query(
        `
        SELECT io.id,
               io.released_quantity,
               io.completed_quantity
        FROM public.item_operations io
        JOIN public.sectors s ON s.id = io.sector_id
        WHERE io.item_id = $1
          AND s.position < $2
        ORDER BY s.position DESC
        LIMIT 1;
        `,
        [operation.item_id, operation.sector_position]
      );
      const previousOperation = previousOperationRs.rows[0];
      if (!previousOperation) {
        throw new Error("Nao existe setor anterior para retorno nesta operacao.");
      }

      const previousCompletedQuantity = Number(previousOperation.completed_quantity || 0);
      if (rollbackQuantity > previousCompletedQuantity + quantityEpsilon) {
        throw new Error(
          `Quantidade de retorno maior que a baixada no setor anterior (${previousCompletedQuantity}).`
        );
      }

      const nextReleasedQuantity = Math.max(0, releasedQuantity - rollbackQuantity);
      const nextCompletedQuantity = Math.min(completedQuantity, nextReleasedQuantity);
      const currentIsDone =
        nextReleasedQuantity > quantityEpsilon && nextCompletedQuantity >= nextReleasedQuantity - quantityEpsilon;

      await client.query(
        `UPDATE public.item_operations
         SET status=$1::operation_status,
             finished_at=$2,
             useful_minutes=$3,
             released_quantity=$4,
             completed_quantity=$5
         WHERE id=$6;`,
        [
          currentIsDone ? "CONCLUIDA" : "PENDENTE",
          currentIsDone ? operation.finished_at : null,
          currentIsDone ? operation.useful_minutes : null,
          nextReleasedQuantity,
          nextCompletedQuantity,
          operation.id
        ]
      );

      const previousReleasedQuantity = Number(previousOperation.released_quantity || 0);
      const nextPreviousCompletedQuantity = Math.max(0, previousCompletedQuantity - rollbackQuantity);
      const previousIsDone = nextPreviousCompletedQuantity >= previousReleasedQuantity - quantityEpsilon;

      await client.query(
        `UPDATE public.item_operations
         SET completed_quantity=$1,
             status=$2::operation_status,
             finished_at=CASE WHEN $2::operation_status='PENDENTE'::operation_status THEN NULL ELSE finished_at END,
             useful_minutes=CASE WHEN $2::operation_status='PENDENTE'::operation_status THEN NULL ELSE useful_minutes END
         WHERE id=$3;`,
        [nextPreviousCompletedQuantity, previousIsDone ? "CONCLUIDA" : "PENDENTE", previousOperation.id]
      );

      notificationEmployeeId = operation.previous_employee_id || null;
      notificationAction = "ROLLBACK_OPERATION";
      rollbackReason = String(reason).trim();
      requestedQuantity = rollbackQuantity;
      processedQuantity = rollbackQuantity;
    } else {
      if (!employeeId) {
        throw new Error("Selecione um funcionario.");
      }
      const now = new Date().toISOString();
      const scheduleRs = await client.query(
        "SELECT work_start, work_end, lunch_start, lunch_end FROM public.work_schedules ORDER BY created_at ASC LIMIT 1;"
      );
      const schedule = mapSchedule(scheduleRs.rows[0]);
      const completionResult = await completeOperation(client, operation, employeeId, schedule, now);
      notificationEmployeeId = employeeId;
      notificationAction = "CONFIRM_OPERATION";
      processedQuantity = completionResult.processedQuantity;
    }

    await client.query(
      `
      INSERT INTO public.operation_notifications (
        action, actor_user_id, order_id, item_id, sector_id, employee_id, rollback_reason, requested_quantity, processed_quantity
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
      `,
      [
        notificationAction,
        req.auth.sub,
        operation.order_id,
        operation.item_id,
        operation.sector_id,
        notificationEmployeeId,
        rollbackReason,
        requestedQuantity,
        processedQuantity
      ]
    );

    await recomputeOrderStatus(client, operation.order_id);

    await client.query("COMMIT");
    broadcastRefresh();
    const snapshot = await loadSnapshot(client);
    res.json(snapshot);
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.post("/operations/batch-toggle", requireAuth, async (req, res) => {
  const { orderId, sectorId, employeeId, mode, itemId, description, quantity } = req.body ?? {};
  const batchMode = String(mode || "");
  if (!orderId || !sectorId || !employeeId || !["SINGLE_ITEM", "CUSTOM_QUANTITY"].includes(batchMode)) {
    res.status(400).json({ message: "Payload de baixa em lote invalido." });
    return;
  }

  const parsedQuantity = parsePositiveNumber(quantity);
  if (batchMode === "CUSTOM_QUANTITY" && (!parsedQuantity || !String(description || "").trim())) {
    res.status(400).json({ message: "Informe uma quantidade valida para baixa personalizada." });
    return;
  }
  if (batchMode === "SINGLE_ITEM" && !itemId) {
    res.status(400).json({ message: "Selecione o item para efetuar a baixa." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const scheduleRs = await client.query(
      "SELECT work_start, work_end, lunch_start, lunch_end FROM public.work_schedules ORDER BY created_at ASC LIMIT 1;"
    );
    const schedule = mapSchedule(scheduleRs.rows[0]);
    const nowIso = new Date().toISOString();

    const baseSelect = `
      SELECT io.id,
             io.item_id,
             io.released_at,
             io.started_at,
             io.employee_id AS previous_employee_id,
             io.released_quantity,
             io.completed_quantity,
             s.position AS sector_position,
             pi.order_id,
             pi.description
      FROM public.item_operations io
      JOIN public.production_items pi ON pi.id = io.item_id
      JOIN public.sectors s ON s.id = io.sector_id
      WHERE pi.order_id = $1
        AND io.sector_id = $2
    `;

    let operationRows = [];
    if (batchMode === "SINGLE_ITEM") {
      const operationRs = await client.query(`${baseSelect} AND io.item_id = $3 LIMIT 1;`, [orderId, sectorId, itemId]);
      operationRows = operationRs.rows;
    } else {
      const operationRs = await client.query(
        `${baseSelect} AND pi.description = $3 ORDER BY pi.created_at ASC, io.created_at ASC;`,
        [orderId, sectorId, String(description).trim()]
      );
      operationRows = operationRs.rows;
    }

    if (operationRows.length === 0) {
      throw new Error("Operacao nao encontrada para os filtros informados.");
    }

    let totalAvailable = 0;
    for (const operation of operationRows) {
      totalAvailable += readOperationQuantities(operation).availableQuantity;
    }

    if (totalAvailable <= quantityEpsilon) {
      throw new Error("Sem quantidade liberada para baixa.");
    }

    const requestedQuantity = batchMode === "CUSTOM_QUANTITY" ? parsedQuantity : totalAvailable;
    if (!requestedQuantity || requestedQuantity <= 0) {
      throw new Error("Quantidade solicitada invalida.");
    }
    if (requestedQuantity > totalAvailable + quantityEpsilon) {
      throw new Error(`Quantidade solicitada maior que a liberada (${totalAvailable}).`);
    }

    let remaining = requestedQuantity;
    let processedQuantity = 0;
    for (const operation of operationRows) {
      if (remaining <= quantityEpsilon) {
        break;
      }

      const operationAvailable = readOperationQuantities(operation).availableQuantity;
      if (operationAvailable <= quantityEpsilon) {
        continue;
      }

      const quantityToProcess = Math.min(remaining, operationAvailable);
      const completionResult = await completeOperation(client, operation, employeeId, schedule, nowIso, quantityToProcess);
      remaining -= completionResult.processedQuantity;
      processedQuantity += completionResult.processedQuantity;
    }

    if (processedQuantity <= quantityEpsilon) {
      throw new Error("Nenhuma quantidade foi processada.");
    }

    const operation = operationRows[0];

    await client.query(
      `
      INSERT INTO public.operation_notifications (
        action,
        actor_user_id,
        order_id,
        item_id,
        sector_id,
        employee_id,
        batch_mode,
        requested_quantity,
        processed_quantity
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
      `,
      [
        "BATCH_OPERATION",
        req.auth.sub,
        orderId,
        operation.item_id,
        sectorId,
        employeeId,
        batchMode,
        requestedQuantity,
        processedQuantity
      ]
    );

    await recomputeOrderStatus(client, orderId);

    await client.query("COMMIT");
    broadcastRefresh();
    const snapshot = await loadSnapshot(client);
    res.json(snapshot);
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.listen(port, () => {
  console.log(`TrackLine API online em http://localhost:${port}`);
});
