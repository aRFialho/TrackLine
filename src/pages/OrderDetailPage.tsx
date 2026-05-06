import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { exportOrderCsvSemicolon, exportOrderXlsxDetailed } from "../lib/exporters";
import { useProductionStore } from "../store/useProductionStore";

function OrderDetailPage() {
  const { orderId = "" } = useParams();
  const { orders, sectors, employees, setOperationDone, batchSetOperations } = useProductionStore();
  const [selectedOperators, setSelectedOperators] = useState<Record<string, string>>({});
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [runningBatchKey, setRunningBatchKey] = useState<string>("");

  const order = useMemo(() => orders.find((candidate) => candidate.id === orderId), [orders, orderId]);
  const employeesBySector = useMemo(
    () =>
      sectors.reduce<Record<string, typeof employees>>((acc, sector) => {
        acc[sector.id] = employees.filter((employee) => employee.sectorIds.includes(sector.id));
        return acc;
      }, {}),
    [employees, sectors]
  );
  const sectorPositionById = useMemo(
    () =>
      sectors.reduce<Record<string, number>>((acc, sector, index) => {
        acc[sector.id] = index;
        return acc;
      }, {}),
    [sectors]
  );

  if (!order) {
    return (
      <section className="page">
        <div className="card">
          <h2>OP nao encontrada</h2>
          <Link to="/ops">Voltar para lista</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <header className="page-title">
        <h1>
          OP {order.number} - {order.name}
        </h1>
        <p>
          Criada em {dayjs(order.createdAt).format("DD/MM/YYYY HH:mm")} | Status {order.status}
        </p>
        <div className="actions">
          <button type="button" onClick={() => exportOrderCsvSemicolon(order, sectors, employees)}>
            Exportar CSV (;)
          </button>
          <button type="button" onClick={() => exportOrderXlsxDetailed(order, sectors, employees)}>
            Exportar Excel detalhado
          </button>
        </div>
      </header>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>QTDE</th>
                <th>UN</th>
                <th>DESCRICAO</th>
                {sectors.map((sector) => (
                  <th key={sector.id}>{sector.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.quantity}</td>
                  <td>{item.unit}</td>
                  <td>{item.description}</td>
                  {sectors.map((sector) => {
                    const operation = item.operations.find((op) => op.sectorId === sector.id);
                    if (!operation) {
                      return <td key={`${item.id}-${sector.id}`}>-</td>;
                    }
                    const availableQuantity = Math.max(0, Number(operation.releasedQuantity || 0) - Number(operation.completedQuantity || 0));
                    const lotAvailableQuantity = order.items
                      .filter((candidate) => candidate.description === item.description)
                      .reduce((sum, candidate) => {
                        const lotOperation = candidate.operations.find((op) => op.sectorId === sector.id);
                        if (!lotOperation) {
                          return sum;
                        }
                        return sum + Math.max(0, Number(lotOperation.releasedQuantity || 0) - Number(lotOperation.completedQuantity || 0));
                      }, 0);
                    const availableEmployees = employeesBySector[sector.id] ?? [];
                    const cellKey = `${item.id}-${sector.id}`;
                    const selectedEmployeeId = selectedOperators[cellKey] ?? operation.employeeId ?? "";
                    const rollbackAvailableQuantity = Math.max(
                      0,
                      Number(operation.releasedQuantity || 0) - Number(operation.completedQuantity || 0)
                    );
                    const hasPreviousSector = (sectorPositionById[sector.id] ?? 0) > 0;

                    return (
                      <td key={cellKey}>
                        <div className="qty-legend">
                          <span className="qty-chip released">Liberada: {operation.releasedQuantity}</span>
                          <span className="qty-chip completed">Baixada: {operation.completedQuantity}</span>
                        </div>
                        <small>Status: {operation.status}</small>
                        <select
                          value={selectedEmployeeId}
                          onChange={(event) => {
                            const nextEmployeeId = event.target.value;
                            setSelectedOperators((current) => ({ ...current, [cellKey]: nextEmployeeId }));
                            setCellErrors((current) => ({ ...current, [cellKey]: "" }));
                          }}
                        >
                          <option value="">Selecionar</option>
                          {availableEmployees.map((employee) => (
                            <option key={employee.id} value={employee.id}>
                              {employee.name}
                            </option>
                          ))}
                        </select>
                        <div className="batch-actions">
                          <button
                            className="mini-btn"
                            disabled={!selectedEmployeeId || availableQuantity <= 0}
                            onClick={() => {
                              setRunningBatchKey(`${cellKey}-single`);
                              void batchSetOperations({
                                orderId: order.id,
                                sectorId: sector.id,
                                employeeId: selectedEmployeeId,
                                mode: "SINGLE_ITEM",
                                itemId: item.id
                              }).finally(() => setRunningBatchKey(""));
                            }}
                          >
                            {runningBatchKey === `${cellKey}-single` ? "..." : "Baixa item"}
                          </button>
                          <button
                            className="mini-btn ghost"
                            disabled={!selectedEmployeeId || lotAvailableQuantity <= 0}
                            onClick={() => {
                              const raw = window.prompt(
                                `Quantidade para baixa por lote "${item.description}" (max ${lotAvailableQuantity}):`,
                                String(Math.min(lotAvailableQuantity, 1))
                              );
                              if (!raw) {
                                return;
                              }
                              const nextQty = Number(raw);
                              if (!Number.isFinite(nextQty) || nextQty <= 0) {
                                setCellErrors((current) => ({
                                  ...current,
                                  [cellKey]: "Quantidade personalizada invalida."
                                }));
                                return;
                              }
                              if (nextQty > lotAvailableQuantity) {
                                setCellErrors((current) => ({
                                  ...current,
                                  [cellKey]: `Quantidade maior que a liberada no lote (${lotAvailableQuantity}).`
                                }));
                                return;
                              }
                              setRunningBatchKey(`${cellKey}-qty`);
                              void batchSetOperations({
                                orderId: order.id,
                                sectorId: sector.id,
                                employeeId: selectedEmployeeId,
                                mode: "CUSTOM_QUANTITY",
                                description: item.description,
                                quantity: nextQty
                              }).finally(() => setRunningBatchKey(""));
                            }}
                          >
                            {runningBatchKey === `${cellKey}-qty` ? "..." : "Baixa quantidade (lote)"}
                          </button>
                          <button
                            className="mini-btn ghost"
                            disabled={!hasPreviousSector || rollbackAvailableQuantity <= 0}
                            onClick={() => {
                              const qtyRaw = window.prompt(
                                `Quantidade para retornar ao setor anterior (max ${rollbackAvailableQuantity}):`,
                                String(Math.min(rollbackAvailableQuantity, 1))
                              );
                              if (!qtyRaw) {
                                return;
                              }
                              const rollbackQuantity = Number(qtyRaw);
                              if (!Number.isFinite(rollbackQuantity) || rollbackQuantity <= 0) {
                                setCellErrors((current) => ({
                                  ...current,
                                  [cellKey]: "Quantidade de retorno invalida."
                                }));
                                return;
                              }
                              if (rollbackQuantity > rollbackAvailableQuantity) {
                                setCellErrors((current) => ({
                                  ...current,
                                  [cellKey]: `Quantidade de retorno maior que a liberada (${rollbackAvailableQuantity}).`
                                }));
                                return;
                              }
                              const reason = window.prompt("Motivo obrigatorio para retornar operacao anterior:");
                              if (!reason || !reason.trim()) {
                                setCellErrors((current) => ({
                                  ...current,
                                  [cellKey]: "Motivo obrigatorio para retornar operacao."
                                }));
                                return;
                              }
                              setRunningBatchKey(`${cellKey}-rollback`);
                              setCellErrors((current) => ({ ...current, [cellKey]: "" }));
                              void setOperationDone({
                                orderId: order.id,
                                itemId: item.id,
                                sectorId: sector.id,
                                employeeId: "",
                                done: false,
                                reason: reason.trim(),
                                quantity: rollbackQuantity
                              }).finally(() => setRunningBatchKey(""));
                            }}
                          >
                            {runningBatchKey === `${cellKey}-rollback` ? "..." : "Retornar operacao anterior"}
                          </button>
                        </div>
                        {cellErrors[cellKey] ? <small className="error">{cellErrors[cellKey]}</small> : null}
                        <small>{operation.usefulMinutes ? `${operation.usefulMinutes} min` : "-"}</small>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default OrderDetailPage;
