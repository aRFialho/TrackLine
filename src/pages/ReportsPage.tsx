import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useProductionStore } from "../store/useProductionStore";

const average = (values: number[]) =>
  values.length === 0 ? 0 : Math.round(values.reduce((acc, value) => acc + value, 0) / values.length);

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

  return (
    <section className="page reports-page">
      <header className="page-title">
        <h1>Relatorios</h1>
        <p>Tempos por item/setor, medias por funcionario e diagnostico de retrocessos/baixas.</p>
      </header>

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
