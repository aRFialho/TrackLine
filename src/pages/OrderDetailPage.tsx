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
  const [itemQuery, setItemQuery] = useState("");

  const parseInputQuantity = (raw: string) => {
    const normalized = raw.trim().replace(/\s+/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  };

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

  const filteredItems = order.items.filter((item) => {
    const q = itemQuery.trim().toLowerCase();
    if (!q) {
      return true;
    }
    return item.description.toLowerCase().includes(q);
  });

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
        <div className="section-head">
          <h2>Itens da OP</h2>
          <input
            value={itemQuery}
            onChange={(event) => setItemQuery(event.target.value)}
            placeholder="Buscar item por descricao"
          />
        </div>
        <div className="table-wrap order-items-wrap">
          <table className="order-items-table">
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
              {filteredItems.map((item) => {
                const itemCompleted = item.operations.every(
                  (op) =>
                    op.status === "CONCLUIDA" &&
                    Number(op.completedQuantity || 0) >= Number(op.releasedQuantity || 0) - 0.00001
                );
                return (
                <tr key={item.id} className={itemCompleted ? "item-complete-row" : ""}>
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
                    const rollbackAvailableQuantity = Math.max(0, Number(operation.releasedQuantity || 0));
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
                            type="button"
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
                            type="button"
                            onClick={() => {
                              const raw = window.prompt(
                                `Quantidade para baixa por lote "${item.description}" (max ${lotAvailableQuantity}):`,
                                String(Math.min(lotAvailableQuantity, 1))
                              );
                              if (!raw) {
                                return;
                              }
                              const nextQty = parseInputQuantity(raw);
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
                            type="button"
                            onClick={() => {
                              const qtyRaw = window.prompt(
                                `Quantidade para retornar ao setor anterior (max ${rollbackAvailableQuantity}):`,
                                String(Math.min(rollbackAvailableQuantity, 1))
                              );
                              if (!qtyRaw) {
                                return;
                              }
                              const rollbackQuantity = parseInputQuantity(qtyRaw);
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
              )})}
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={3 + sectors.length}>Nenhum item encontrado para o filtro informado.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default OrderDetailPage;
