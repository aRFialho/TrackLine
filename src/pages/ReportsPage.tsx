import { useMemo } from "react";
import { useProductionStore } from "../store/useProductionStore";

const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);

function ReportsPage() {
  const { orders, sectors, employees } = useProductionStore();

  const byDescription = useMemo(() => {
    const map = new Map<string, { units: number; minutes: number[] }>();
    orders.forEach((order) =>
      order.items.forEach((item) => {
        const current = map.get(item.description) ?? { units: 0, minutes: [] };
        current.units += item.quantity;
        current.minutes.push(
          ...item.operations.filter((operation) => typeof operation.usefulMinutes === "number").map((operation) => operation.usefulMinutes as number)
        );
        map.set(item.description, current);
      })
    );

    return Array.from(map.entries()).map(([description, data]) => ({
      description,
      totalUnits: data.units,
      averageMinutes: data.minutes.length ? Math.round(sum(data.minutes) / data.minutes.length) : 0
    }));
  }, [orders]);

  const bySector = useMemo(() => {
    return sectors.map((sector) => {
      const minutes = orders
        .flatMap((order) => order.items)
        .flatMap((item) => item.operations)
        .filter((operation) => operation.sectorId === sector.id && typeof operation.usefulMinutes === "number")
        .map((operation) => operation.usefulMinutes as number);
      return {
        sector: sector.name,
        avgMinutes: minutes.length ? Math.round(sum(minutes) / minutes.length) : 0
      };
    });
  }, [orders, sectors]);

  const byEmployee = useMemo(() => {
    return employees.map((employee) => {
      const doneCount = orders
        .flatMap((order) => order.items)
        .flatMap((item) => item.operations)
        .filter((operation) => operation.employeeId === employee.id && operation.status === "CONCLUIDA").length;
      return {
        employee: employee.name,
        doneCount
      };
    });
  }, [employees, orders]);

  return (
    <section className="page">
      <header className="page-title">
        <h1>Relatorios</h1>
        <p>Visao consolidada por componente, setor e funcionario.</p>
      </header>

      <div className="grid-two">
        <div className="card">
          <h2>Por descricao</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Descricao</th>
                  <th>Total unidades</th>
                  <th>Media de minutos</th>
                </tr>
              </thead>
              <tbody>
                {byDescription.map((row) => (
                  <tr key={row.description}>
                    <td>{row.description}</td>
                    <td>{row.totalUnits}</td>
                    <td>{row.averageMinutes}</td>
                  </tr>
                ))}
                {byDescription.length === 0 ? (
                  <tr>
                    <td colSpan={3}>Sem dados.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Media por setor</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Setor</th>
                  <th>Media minutos</th>
                </tr>
              </thead>
              <tbody>
                {bySector.map((row) => (
                  <tr key={row.sector}>
                    <td>{row.sector}</td>
                    <td>{row.avgMinutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Ranking de produtividade</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Funcionario</th>
                <th>Operacoes concluidas</th>
              </tr>
            </thead>
            <tbody>
              {byEmployee
                .sort((a, b) => b.doneCount - a.doneCount)
                .map((row) => (
                  <tr key={row.employee}>
                    <td>{row.employee}</td>
                    <td>{row.doneCount}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default ReportsPage;

