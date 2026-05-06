import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useProductionStore } from "../store/useProductionStore";

const average = (values: number[]) =>
  values.length === 0 ? 0 : Math.round(values.reduce((acc, value) => acc + value, 0) / values.length);

const weekdayColumns = [
  { code: "MON", label: "Seg" },
  { code: "TUE", label: "Ter" },
  { code: "WED", label: "Qua" },
  { code: "THU", label: "Qui" },
  { code: "FRI", label: "Sex" },
  { code: "SAT", label: "Sab" },
  { code: "SUN", label: "Dom" }
] as const;

type WeekdayCode = (typeof weekdayColumns)[number]["code"];

const dayToCode = (day: number): WeekdayCode => {
  if (day === 0) {
    return "SUN";
  }
  if (day === 1) {
    return "MON";
  }
  if (day === 2) {
    return "TUE";
  }
  if (day === 3) {
    return "WED";
  }
  if (day === 4) {
    return "THU";
  }
  if (day === 5) {
    return "FRI";
  }
  return "SAT";
};

const initWeekMap = () =>
  weekdayColumns.reduce<Record<WeekdayCode, { released: number; completed: number }>>((acc, day) => {
    acc[day.code] = { released: 0, completed: 0 };
    return acc;
  }, {} as Record<WeekdayCode, { released: number; completed: number }>);

function ReportsPage() {
  const { orders, sectors, employees, notifications } = useProductionStore();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");

  const operationRows = useMemo(() => {
    const sectorById = Object.fromEntries(sectors.map((sector) => [sector.id, sector.name]));
    const employeeById = Object.fromEntries(employees.map((employee) => [employee.id, employee.name]));
    return orders.flatMap((order) =>
      order.items.flatMap((item) =>
        item.operations
          .filter((operation) => typeof operation.usefulMinutes === "number")
          .map((operation) => ({
            orderNumber: order.number,
            itemId: item.id,
            itemDescription: item.description,
            quantity: item.quantity,
            unit: item.unit,
            sectorId: operation.sectorId,
            sectorName: sectorById[operation.sectorId] ?? operation.sectorId,
            employeeId: operation.employeeId ?? "",
            employeeName: operation.employeeId ? employeeById[operation.employeeId] ?? operation.employeeId : "Nao informado",
            usefulMinutes: operation.usefulMinutes as number,
            finishedAt: operation.finishedAt
          }))
      )
    );
  }, [orders, sectors, employees]);

  const byItemSector = useMemo(() => {
    const map = new Map<string, { item: string; sector: string; minutes: number[]; totalUnits: number }>();
    operationRows.forEach((row) => {
      const key = `${row.itemDescription}::${row.sectorName}`;
      const current = map.get(key) ?? { item: row.itemDescription, sector: row.sectorName, minutes: [], totalUnits: 0 };
      current.minutes.push(row.usefulMinutes);
      current.totalUnits += row.quantity;
      map.set(key, current);
    });
    return Array.from(map.values()).map((row) => ({
      item: row.item,
      sector: row.sector,
      totalUnits: row.totalUnits,
      avgMinutes: average(row.minutes),
      totalMinutes: row.minutes.reduce((acc, value) => acc + value, 0)
    }));
  }, [operationRows]);

  const employeeGeneral = useMemo(() => {
    return employees
      .map((employee) => {
        const minutes = operationRows.filter((row) => row.employeeId === employee.id).map((row) => row.usefulMinutes);
        return {
          employeeId: employee.id,
          employeeName: employee.name,
          operations: minutes.length,
          avgMinutes: average(minutes)
        };
      })
      .sort((a, b) => b.operations - a.operations);
  }, [employees, operationRows]);

  const employeeByItem = useMemo(() => {
    const map = new Map<string, { employee: string; item: string; minutes: number[]; operations: number }>();
    operationRows.forEach((row) => {
      if (!row.employeeId) {
        return;
      }
      const key = `${row.employeeId}::${row.itemDescription}`;
      const current = map.get(key) ?? { employee: row.employeeName, item: row.itemDescription, minutes: [], operations: 0 };
      current.minutes.push(row.usefulMinutes);
      current.operations += 1;
      map.set(key, current);
    });
    return Array.from(map.values()).map((row) => ({
      employee: row.employee,
      item: row.item,
      operations: row.operations,
      avgMinutes: average(row.minutes)
    }));
  }, [operationRows]);

  const employeeDailyDetail = useMemo(() => {
    if (!selectedEmployeeId) {
      return [];
    }
    const filtered = operationRows.filter((row) => row.employeeId === selectedEmployeeId && row.finishedAt);
    const map = new Map<string, { date: string; hour: string; item: string; sector: string; minutes: number[]; operations: number }>();
    filtered.forEach((row) => {
      const date = dayjs(row.finishedAt).format("DD/MM/YYYY");
      const hour = dayjs(row.finishedAt).format("HH:00");
      const key = `${date}::${hour}::${row.itemDescription}::${row.sectorName}`;
      const current = map.get(key) ?? {
        date,
        hour,
        item: row.itemDescription,
        sector: row.sectorName,
        minutes: [],
        operations: 0
      };
      current.minutes.push(row.usefulMinutes);
      current.operations += 1;
      map.set(key, current);
    });

    return Array.from(map.values())
      .map((row) => ({
        date: row.date,
        hour: row.hour,
        item: row.item,
        sector: row.sector,
        operations: row.operations,
        avgMinutes: average(row.minutes)
      }))
      .sort((a, b) => `${b.date} ${b.hour}`.localeCompare(`${a.date} ${a.hour}`));
  }, [operationRows, selectedEmployeeId]);

  const rollbackDiagnostics = useMemo(
    () =>
      notifications.filter((notification) => notification.action === "ROLLBACK_OPERATION" || notification.action === "BATCH_OPERATION"),
    [notifications]
  );

  const sectorBalance = useMemo(() => {
    const sectorById = Object.fromEntries(sectors.map((sector) => [sector.id, sector.name]));
    const map = new Map<string, { sectorId: string; sectorName: string; released: number; completed: number; pending: number }>();
    orders.forEach((order) => {
      order.items.forEach((item) => {
        item.operations.forEach((operation) => {
          const current = map.get(operation.sectorId) ?? {
            sectorId: operation.sectorId,
            sectorName: sectorById[operation.sectorId] ?? operation.sectorId,
            released: 0,
            completed: 0,
            pending: 0
          };
          const released = Number(operation.releasedQuantity || 0);
          const completed = Number(operation.completedQuantity || 0);
          current.released += released;
          current.completed += completed;
          current.pending += Math.max(0, released - completed);
          map.set(operation.sectorId, current);
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => a.sectorName.localeCompare(b.sectorName));
  }, [orders, sectors]);

  const balanceBySectorDescription = useMemo(() => {
    const sectorById = Object.fromEntries(sectors.map((sector) => [sector.id, sector.name]));
    const map = new Map<
      string,
      { sectorId: string; sectorName: string; description: string; released: number; completed: number; pending: number }
    >();
    orders.forEach((order) => {
      order.items.forEach((item) => {
        item.operations.forEach((operation) => {
          const key = `${operation.sectorId}::${item.description}`;
          const current = map.get(key) ?? {
            sectorId: operation.sectorId,
            sectorName: sectorById[operation.sectorId] ?? operation.sectorId,
            description: item.description,
            released: 0,
            completed: 0,
            pending: 0
          };
          const released = Number(operation.releasedQuantity || 0);
          const completed = Number(operation.completedQuantity || 0);
          current.released += released;
          current.completed += completed;
          current.pending += Math.max(0, released - completed);
          map.set(key, current);
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.sectorName === b.sectorName) {
        return a.description.localeCompare(b.description);
      }
      return a.sectorName.localeCompare(b.sectorName);
    });
  }, [orders, sectors]);

  const productivity = useMemo(() => {
    const now = dayjs();
    const mondayOffset = (now.day() + 6) % 7;
    const weekStart = now.startOf("day").subtract(mondayOffset, "day");
    const weekEnd = weekStart.add(7, "day");

    const employeeMap = new Map<
      string,
      {
        employeeName: string;
        releasedTotal: number;
        completedTotal: number;
        weekDays: Record<WeekdayCode, { released: number; completed: number }>;
      }
    >();
    const sectorMap = new Map<
      string,
      {
        sectorName: string;
        releasedTotal: number;
        completedTotal: number;
        weekDays: Record<WeekdayCode, { released: number; completed: number }>;
      }
    >();

    notifications.forEach((notification) => {
      const baseQty = Number(notification.processedQuantity ?? notification.quantity ?? 0);
      if (!Number.isFinite(baseQty) || baseQty <= 0) {
        return;
      }
      const isReversal = notification.action === "ROLLBACK_OPERATION" || notification.action === "UNCONFIRM_OPERATION";
      const delta = isReversal ? -baseQty : baseQty;

      const eventAt = dayjs(notification.createdAt);
      const inCurrentWeek = (eventAt.isAfter(weekStart) || eventAt.isSame(weekStart)) && eventAt.isBefore(weekEnd);
      const weekdayCode = dayToCode(eventAt.day());

      if (notification.employeeName) {
        const employee = employeeMap.get(notification.employeeName) ?? {
          employeeName: notification.employeeName,
          releasedTotal: 0,
          completedTotal: 0,
          weekDays: initWeekMap()
        };
        employee.releasedTotal += delta;
        employee.completedTotal += delta;
        if (inCurrentWeek) {
          employee.weekDays[weekdayCode].released += delta;
          employee.weekDays[weekdayCode].completed += delta;
        }
        employeeMap.set(notification.employeeName, employee);
      }

      const sector = sectorMap.get(notification.sectorName) ?? {
        sectorName: notification.sectorName,
        releasedTotal: 0,
        completedTotal: 0,
        weekDays: initWeekMap()
      };
      sector.releasedTotal += delta;
      sector.completedTotal += delta;
      if (inCurrentWeek) {
        sector.weekDays[weekdayCode].released += delta;
        sector.weekDays[weekdayCode].completed += delta;
      }
      sectorMap.set(notification.sectorName, sector);
    });

    const employeeRows = Array.from(employeeMap.values()).sort((a, b) => b.completedTotal - a.completedTotal);
    const sectorRows = Array.from(sectorMap.values()).sort((a, b) => b.completedTotal - a.completedTotal);
    const employeeTotalCompleted = employeeRows.reduce((acc, row) => acc + Math.max(0, row.completedTotal), 0);
    const sectorTotalCompleted = sectorRows.reduce((acc, row) => acc + Math.max(0, row.completedTotal), 0);

    return {
      weekStartLabel: weekStart.format("DD/MM/YYYY"),
      weekEndLabel: weekEnd.subtract(1, "day").format("DD/MM/YYYY"),
      employeeRows: employeeRows.map((row) => ({
        ...row,
        completedPercent:
          employeeTotalCompleted > 0 ? Math.max(0, (Math.max(0, row.completedTotal) / employeeTotalCompleted) * 100) : 0
      })),
      sectorRows: sectorRows.map((row) => ({
        ...row,
        completedPercent:
          sectorTotalCompleted > 0 ? Math.max(0, (Math.max(0, row.completedTotal) / sectorTotalCompleted) * 100) : 0
      }))
    };
  }, [notifications]);

  return (
    <section className="page reports-page">
      <header className="page-title">
        <h1>Relatorios</h1>
        <p>Tempos por item/setor, saldos de liberacao/baixa e rendimento por funcionario/setor.</p>
      </header>

      <div className="card">
        <h2>Saldo atual por setor</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Setor</th>
                <th>Total liberada</th>
                <th>Total concluida</th>
                <th>Saldo acumulado</th>
              </tr>
            </thead>
            <tbody>
              {sectorBalance.map((row) => (
                <tr key={row.sectorId}>
                  <td>{row.sectorName}</td>
                  <td>{row.released}</td>
                  <td>{row.completed}</td>
                  <td>{row.pending}</td>
                </tr>
              ))}
              {sectorBalance.length === 0 ? (
                <tr>
                  <td colSpan={4}>Sem dados de saldo para exibir.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Saldo por descricao em cada setor</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Setor</th>
                <th>Descricao</th>
                <th>Total liberada</th>
                <th>Total concluida</th>
                <th>Saldo acumulado</th>
              </tr>
            </thead>
            <tbody>
              {balanceBySectorDescription.map((row) => (
                <tr key={`${row.sectorId}-${row.description}`}>
                  <td>{row.sectorName}</td>
                  <td>{row.description}</td>
                  <td>{row.released}</td>
                  <td>{row.completed}</td>
                  <td>{row.pending}</td>
                </tr>
              ))}
              {balanceBySectorDescription.length === 0 ? (
                <tr>
                  <td colSpan={5}>Sem dados por descricao.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>
          Rendimento semanal por funcionario ({productivity.weekStartLabel} a {productivity.weekEndLabel})
        </h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Funcionario</th>
                <th>Liberadas total</th>
                <th>Baixadas total</th>
                {weekdayColumns.map((day) => (
                  <th key={`emp-${day.code}`}>{day.label} (L/B)</th>
                ))}
                <th>% producao baixada</th>
              </tr>
            </thead>
            <tbody>
              {productivity.employeeRows.map((row) => (
                <tr key={row.employeeName}>
                  <td>{row.employeeName}</td>
                  <td>{row.releasedTotal}</td>
                  <td>{row.completedTotal}</td>
                  {weekdayColumns.map((day) => (
                    <td key={`${row.employeeName}-${day.code}`}>
                      {row.weekDays[day.code].released}/{row.weekDays[day.code].completed}
                    </td>
                  ))}
                  <td>{row.completedPercent.toFixed(1)}%</td>
                </tr>
              ))}
              {productivity.employeeRows.length === 0 ? (
                <tr>
                  <td colSpan={11}>Sem dados de rendimento por funcionario.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>
          Rendimento semanal por setor ({productivity.weekStartLabel} a {productivity.weekEndLabel})
        </h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Setor</th>
                <th>Liberadas total</th>
                <th>Baixadas total</th>
                {weekdayColumns.map((day) => (
                  <th key={`sec-${day.code}`}>{day.label} (L/B)</th>
                ))}
                <th>% producao baixada</th>
              </tr>
            </thead>
            <tbody>
              {productivity.sectorRows.map((row) => (
                <tr key={row.sectorName}>
                  <td>{row.sectorName}</td>
                  <td>{row.releasedTotal}</td>
                  <td>{row.completedTotal}</td>
                  {weekdayColumns.map((day) => (
                    <td key={`${row.sectorName}-${day.code}`}>
                      {row.weekDays[day.code].released}/{row.weekDays[day.code].completed}
                    </td>
                  ))}
                  <td>{row.completedPercent.toFixed(1)}%</td>
                </tr>
              ))}
              {productivity.sectorRows.length === 0 ? (
                <tr>
                  <td colSpan={11}>Sem dados de rendimento por setor.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Tempo detalhado por item em cada setor</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Setor</th>
                <th>Total unidades</th>
                <th>Tempo total (min)</th>
                <th>Tempo medio (min)</th>
              </tr>
            </thead>
            <tbody>
              {byItemSector.map((row) => (
                <tr key={`${row.item}-${row.sector}`}>
                  <td>{row.item}</td>
                  <td>{row.sector}</td>
                  <td>{row.totalUnits}</td>
                  <td>{row.totalMinutes}</td>
                  <td>{row.avgMinutes}</td>
                </tr>
              ))}
              {byItemSector.length === 0 ? (
                <tr>
                  <td colSpan={5}>Sem dados para exibir.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-two">
        <div className="card">
          <h2>Media geral por funcionario</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Funcionario</th>
                  <th>Operacoes</th>
                  <th>Tempo medio (min)</th>
                </tr>
              </thead>
              <tbody>
                {employeeGeneral.map((row) => (
                  <tr key={row.employeeId}>
                    <td>{row.employeeName}</td>
                    <td>{row.operations}</td>
                    <td>{row.avgMinutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Media por funcionario e item</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Funcionario</th>
                  <th>Item</th>
                  <th>Operacoes</th>
                  <th>Tempo medio (min)</th>
                </tr>
              </thead>
              <tbody>
                {employeeByItem.map((row) => (
                  <tr key={`${row.employee}-${row.item}`}>
                    <td>{row.employee}</td>
                    <td>{row.item}</td>
                    <td>{row.operations}</td>
                    <td>{row.avgMinutes}</td>
                  </tr>
                ))}
                {employeeByItem.length === 0 ? (
                  <tr>
                    <td colSpan={4}>Sem dados por item.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-head">
          <h2>Detalhamento diario por funcionario</h2>
          <select value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
            <option value="">Selecionar funcionario</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Dia</th>
                <th>Horario</th>
                <th>Item</th>
                <th>Setor</th>
                <th>Operacoes</th>
                <th>Tempo medio (min)</th>
              </tr>
            </thead>
            <tbody>
              {employeeDailyDetail.map((row) => (
                <tr key={`${row.date}-${row.hour}-${row.item}-${row.sector}`}>
                  <td>{row.date}</td>
                  <td>{row.hour}</td>
                  <td>{row.item}</td>
                  <td>{row.sector}</td>
                  <td>{row.operations}</td>
                  <td>{row.avgMinutes}</td>
                </tr>
              ))}
              {employeeDailyDetail.length === 0 ? (
                <tr>
                  <td colSpan={6}>Selecione um funcionario para visualizar o detalhamento.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Diagnostico admin: retrocessos e baixas em lote</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Acao</th>
                <th>OP</th>
                <th>Item</th>
                <th>Setor</th>
                <th>Responsavel</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {rollbackDiagnostics.map((row) => (
                <tr key={row.id}>
                  <td>{dayjs(row.createdAt).format("DD/MM/YYYY HH:mm")}</td>
                  <td>{row.action}</td>
                  <td>{row.orderNumber}</td>
                  <td>{row.itemDescription}</td>
                  <td>{row.sectorName}</td>
                  <td>{row.actorEmail}</td>
                  <td>
                    {row.rollbackReason
                      ? `Motivo: ${row.rollbackReason} | retorno: ${row.processedQuantity ?? "-"}`
                      : row.batchMode
                        ? `${row.batchMode} | solicitado: ${row.requestedQuantity ?? "-"} | processado: ${row.processedQuantity ?? "-"}`
                        : "-"}
                  </td>
                </tr>
              ))}
              {rollbackDiagnostics.length === 0 ? (
                <tr>
                  <td colSpan={7}>Nenhum retrocesso/baixa em lote registrado.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default ReportsPage;
