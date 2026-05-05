import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useProductionStore } from "../store/useProductionStore";

function OrderDetailPage() {
  const { orderId = "" } = useParams();
  const { orders, sectors, employees, setOperationDone } = useProductionStore();
  const [selectedOperators, setSelectedOperators] = useState<Record<string, string>>({});
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});

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
                                setCellErrors((current) => ({ ...current, [cellKey]: "" }));
                                void setOperationDone({
                                  orderId: order.id,
                                  itemId: item.id,
                                  sectorId: sector.id,
                                  employeeId: "",
                                  done: false
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
