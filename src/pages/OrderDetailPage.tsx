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
                    const availableEmployees = employeesBySector[sector.id] ?? [];
                    const cellKey = `${item.id}-${sector.id}`;
                    const selectedEmployeeId = selectedOperators[cellKey] ?? operation.employeeId ?? "";

                    return (
                      <td key={cellKey}>
                        <label className="op-check">
                          <input
                            type="checkbox"
                            checked={operation.status === "CONCLUIDA"}
                            onChange={(event) => {
                              if (!event.target.checked) {
                                const reason = window.prompt(
                                  "Informe o motivo do retrocesso para retornar a operacao anterior:"
                                );
                                if (!reason || !reason.trim()) {
                                  setCellErrors((current) => ({
                                    ...current,
                                    [cellKey]: "Motivo obrigatorio para retornar operacao."
                                  }));
                                  return;
                                }

                                setCellErrors((current) => ({ ...current, [cellKey]: "" }));
                                void setOperationDone({
                                  orderId: order.id,
                                  itemId: item.id,
                                  sectorId: sector.id,
                                  employeeId: "",
                                  done: false,
                                  reason: reason.trim()
                                });
                                return;
                              }

                              if (!selectedEmployeeId) {
                                setCellErrors((current) => ({
                                  ...current,
                                  [cellKey]: "Selecione o operador antes de confirmar."
                                }));
                                return;
                              }

                              setCellErrors((current) => ({ ...current, [cellKey]: "" }));
                              void setOperationDone({
                                orderId: order.id,
                                itemId: item.id,
                                sectorId: sector.id,
                                employeeId: selectedEmployeeId,
                                done: true
                              });
                            }}
                          />
                          {operation.status}
                        </label>
                        {operation.status === "CONCLUIDA" ? (
                          <button
                            className="mini-btn ghost"
                            onClick={() => {
                              const reason = window.prompt(
                                "Motivo obrigatorio para retornar para a operacao anterior:"
                              );
                              if (!reason || !reason.trim()) {
                                setCellErrors((current) => ({
                                  ...current,
                                  [cellKey]: "Motivo obrigatorio para retornar operacao."
                                }));
                                return;
                              }
                              setCellErrors((current) => ({ ...current, [cellKey]: "" }));
                              void setOperationDone({
                                orderId: order.id,
                                itemId: item.id,
                                sectorId: sector.id,
                                employeeId: "",
                                done: false,
                                reason: reason.trim()
                              });
                            }}
                          >
                            Retornar operacao anterior
                          </button>
                        ) : null}
                        <select
                          value={selectedEmployeeId}
                          onChange={(event) => {
                            const nextEmployeeId = event.target.value;
                            setSelectedOperators((current) => ({ ...current, [cellKey]: nextEmployeeId }));
                            setCellErrors((current) => ({ ...current, [cellKey]: "" }));

                            if (operation.status === "CONCLUIDA" && nextEmployeeId) {
                              void setOperationDone({
                                orderId: order.id,
                                itemId: item.id,
                                sectorId: sector.id,
                                employeeId: nextEmployeeId,
                                done: true
                              });
                            }
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
                            disabled={!selectedEmployeeId || operation.status === "CONCLUIDA"}
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
                            disabled={!selectedEmployeeId}
                            onClick={() => {
                              setRunningBatchKey(`${cellKey}-lot`);
                              void batchSetOperations({
                                orderId: order.id,
                                sectorId: sector.id,
                                employeeId: selectedEmployeeId,
                                mode: "FULL_LOT",
                                description: item.description
                              }).finally(() => setRunningBatchKey(""));
                            }}
                          >
                            {runningBatchKey === `${cellKey}-lot` ? "..." : "Baixa lote"}
                          </button>
                          <button
                            className="mini-btn ghost"
                            disabled={!selectedEmployeeId}
                            onClick={() => {
                              const raw = window.prompt(`Quantidade para baixar no lote "${item.description}":`, "1");
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
                            {runningBatchKey === `${cellKey}-qty` ? "..." : "Baixa quantidade"}
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
