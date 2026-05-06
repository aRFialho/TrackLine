import dayjs from "dayjs";
import { FormEvent, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { exportOrderCsvSemicolon, exportOrderXlsxDetailed } from "../lib/exporters";
import { useProductionStore } from "../store/useProductionStore";

type ActionDialogState =
  | { kind: "none" }
  | {
      kind: "batch";
      cellKey: string;
      orderId: string;
      sectorId: string;
      employeeId: string;
      description: string;
      maxQuantity: number;
    }
  | {
      kind: "rollback";
      cellKey: string;
      orderId: string;
      itemId: string;
      sectorId: string;
      maxQuantity: number;
    };

function OrderDetailPage() {
  const { orderId = "" } = useParams();
  const { orders, sectors, employees, setOperationDone, batchSetOperations } = useProductionStore();
  const [selectedOperators, setSelectedOperators] = useState<Record<string, string>>({});
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [runningBatchKey, setRunningBatchKey] = useState<string>("");
  const [itemQuery, setItemQuery] = useState("");
  const [dialog, setDialog] = useState<ActionDialogState>({ kind: "none" });
  const [dialogQuantity, setDialogQuantity] = useState("");
  const [dialogReason, setDialogReason] = useState("");
  const [dialogError, setDialogError] = useState("");

  const parseInputQuantity = (raw: string) => {
    const normalized = raw.trim().replace(/\s+/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  };

  const closeDialog = () => {
    setDialog({ kind: "none" });
    setDialogQuantity("");
    setDialogReason("");
    setDialogError("");
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

  const submitDialog = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (dialog.kind === "none") {
      return;
    }

    const parsedQuantity = parseInputQuantity(dialogQuantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setDialogError("Quantidade invalida.");
      return;
    }

    if (parsedQuantity > dialog.maxQuantity) {
      setDialogError(`Quantidade maior que o maximo liberado (${dialog.maxQuantity}).`);
      return;
    }

    setDialogError("");
    const requestedQuantity = parsedQuantity;
    const rollbackReason = dialogReason.trim();

    if (dialog.kind === "batch") {
      setRunningBatchKey(`${dialog.cellKey}-qty`);
      setCellErrors((current) => ({ ...current, [dialog.cellKey]: "" }));
      closeDialog();
      void batchSetOperations({
        orderId: dialog.orderId,
        sectorId: dialog.sectorId,
        employeeId: dialog.employeeId,
        mode: "CUSTOM_QUANTITY",
        description: dialog.description,
        quantity: requestedQuantity
      }).finally(() => setRunningBatchKey(""));
      return;
    }

    if (!rollbackReason) {
      setDialogError("Motivo obrigatorio para retorno.");
      return;
    }

    setRunningBatchKey(`${dialog.cellKey}-rollback`);
    setCellErrors((current) => ({ ...current, [dialog.cellKey]: "" }));
    closeDialog();
    void setOperationDone({
      orderId: dialog.orderId,
      itemId: dialog.itemId,
      sectorId: dialog.sectorId,
      employeeId: "",
      done: false,
      reason: rollbackReason,
      quantity: requestedQuantity
    }).finally(() => setRunningBatchKey(""));
  };

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
                      const availableQuantity = Math.max(
                        0,
                        Number(operation.releasedQuantity || 0) - Number(operation.completedQuantity || 0)
                      );
                      const lotAvailableQuantity = order.items
                        .filter((candidate) => candidate.description === item.description)
                        .reduce((sum, candidate) => {
                          const lotOperation = candidate.operations.find((op) => op.sectorId === sector.id);
                          if (!lotOperation) {
                            return sum;
                          }
                          return (
                            sum +
                            Math.max(
                              0,
                              Number(lotOperation.releasedQuantity || 0) - Number(lotOperation.completedQuantity || 0)
                            )
                          );
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
                                setCellErrors((current) => ({ ...current, [cellKey]: "" }));
                                setDialog({
                                  kind: "batch",
                                  cellKey,
                                  orderId: order.id,
                                  sectorId: sector.id,
                                  employeeId: selectedEmployeeId,
                                  description: item.description,
                                  maxQuantity: lotAvailableQuantity
                                });
                                setDialogQuantity(String(Math.min(lotAvailableQuantity, 1)));
                                setDialogReason("");
                                setDialogError("");
                              }}
                            >
                              {runningBatchKey === `${cellKey}-qty` ? "..." : "Baixa quantidade (lote)"}
                            </button>
                            <button
                              className="mini-btn ghost"
                              disabled={!hasPreviousSector || rollbackAvailableQuantity <= 0}
                              type="button"
                              onClick={() => {
                                setCellErrors((current) => ({ ...current, [cellKey]: "" }));
                                setDialog({
                                  kind: "rollback",
                                  cellKey,
                                  orderId: order.id,
                                  itemId: item.id,
                                  sectorId: sector.id,
                                  maxQuantity: rollbackAvailableQuantity
                                });
                                setDialogQuantity(String(Math.min(rollbackAvailableQuantity, 1)));
                                setDialogReason("");
                                setDialogError("");
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
                );
              })}
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={3 + sectors.length}>Nenhum item encontrado para o filtro informado.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {dialog.kind !== "none" ? (
        <div className="action-modal-backdrop" role="presentation" onClick={closeDialog}>
          <div className="action-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h3>{dialog.kind === "batch" ? "Baixa por lote" : "Retornar operacao anterior"}</h3>
            <form className="form-grid" onSubmit={submitDialog}>
              <label className="full">
                Quantidade (max {dialog.maxQuantity})
                <input value={dialogQuantity} onChange={(event) => setDialogQuantity(event.target.value)} />
              </label>
              {dialog.kind === "rollback" ? (
                <label className="full">
                  Motivo do retorno
                  <input value={dialogReason} onChange={(event) => setDialogReason(event.target.value)} />
                </label>
              ) : null}
              {dialogError ? <p className="error">{dialogError}</p> : null}
              <div className="actions full">
                <button className="mini-btn ghost" type="button" onClick={closeDialog}>
                  Cancelar
                </button>
                <button className="mini-btn" type="submit">
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default OrderDetailPage;
