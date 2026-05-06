import { FormEvent, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import { parseOrderSpreadsheet } from "../lib/importers";
import { useProductionStore } from "../store/useProductionStore";
import { useAuthStore } from "../store/useAuthStore";

const fmtDate = (iso?: string) => (iso ? dayjs(iso).format("DD/MM/YYYY HH:mm") : "-");

function OrdersPage() {
  const navigate = useNavigate();
  const { orders, sectors, employees, createOrder, deleteOrder, finalizeOrder } = useProductionStore();
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"ABERTAS" | "FINALIZADAS">("ABERTAS");

  const employeeMap = useMemo(() => Object.fromEntries(employees.map((employee) => [employee.id, employee.name])), [employees]);

  const filteredOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    const statusFiltered = orders.filter((order) => (activeTab === "ABERTAS" ? order.status !== "FINALIZADA" : order.status === "FINALIZADA"));
    if (!q) {
      return statusFiltered;
    }
    return statusFiltered.filter((order) => {
      const byNumber = order.number.toLowerCase().includes(q);
      const byName = order.name.toLowerCase().includes(q);
      const byDate = fmtDate(order.createdAt).toLowerCase().includes(q);
      return byNumber || byName || byDate;
    });
  }, [orders, query, activeTab]);

  const averageBySector = (orderId: string, sectorId: string) => {
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      return "-";
    }
    const durations = order.items
      .flatMap((item) => item.operations)
      .filter((op) => op.sectorId === sectorId && typeof op.usefulMinutes === "number")
      .map((op) => op.usefulMinutes as number);

    if (durations.length === 0) {
      return "-";
    }

    const avg = Math.round(durations.reduce((sum, next) => sum + next, 0) / durations.length);
    return `${avg} min`;
  };

  const totalUnits = (orderId: string) => {
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      return 0;
    }
    return order.items.reduce((sum, item) => sum + item.quantity, 0);
  };

  const lastOperatorName = (orderId: string) => {
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      return "-";
    }
    const finishedOps = order.items.flatMap((item) => item.operations).filter((op) => op.finishedAt && op.employeeId);
    if (finishedOps.length === 0) {
      return "-";
    }
    finishedOps.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
    return employeeMap[finishedOps[0].employeeId!] || "-";
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!number.trim()) {
      setError("Informe o numero da OP.");
      return;
    }
    if (!file) {
      setError("Anexe uma planilha .xlsx ou .csv.");
      return;
    }

    setLoading(true);
    try {
      const rows = await parseOrderSpreadsheet(file);
      if (rows.length === 0) {
        setError("A planilha nao possui linhas validas.");
        return;
      }
      await createOrder({ number, name, rows });
      setNumber("");
      setName("");
      setFile(null);
      const input = document.getElementById("op-file-input") as HTMLInputElement | null;
      if (input) {
        input.value = "";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao importar OP.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="page">
      <header className="page-title">
        <h1>Ordens de Producao</h1>
        <p>Importe planilha, acompanhe etapas e finalize quando todo setor concluir.</p>
      </header>

      {isAdmin ? (
        <div className="card">
          <h2>Nova OP</h2>
          <form className="form-grid" onSubmit={handleCreate}>
            <label>
              Numero da OP
              <input value={number} onChange={(event) => setNumber(event.target.value)} placeholder="Ex: OP-2026-091" />
            </label>
            <label>
              Nome da OP
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: Sofa Linha Prime" />
            </label>
            <label className="full">
              Planilha
              <input
                id="op-file-input"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <button disabled={loading} type="submit">
              {loading ? "Importando..." : "Adicionar OP"}
            </button>
          </form>
          {error ? <p className="error">{error}</p> : null}
        </div>
      ) : null}

      <div className="card">
        <div className="section-head">
          <h2>Lista de OPs</h2>
          <div className="tabs-row">
            <button
              type="button"
              className={activeTab === "ABERTAS" ? "tab-btn active" : "tab-btn"}
              onClick={() => setActiveTab("ABERTAS")}
            >
              OPs abertas
            </button>
            <button
              type="button"
              className={activeTab === "FINALIZADAS" ? "tab-btn active" : "tab-btn"}
              onClick={() => setActiveTab("FINALIZADAS")}
            >
              OPs finalizadas
            </button>
          </div>
          <input placeholder="Buscar por numero, nome ou data" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>OP</th>
                <th>Nome</th>
                <th>Status</th>
                <th>Criacao</th>
                <th>Finalizacao</th>
                <th>Total unidades</th>
                {sectors.map((sector) => (
                  <th key={sector.id}>Media {sector.name}</th>
                ))}
                <th>Ultimo operador</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.id}>
                  <td>{order.number}</td>
                  <td>{order.name}</td>
                  <td>
                    <span className={order.status === "FINALIZADA" ? "badge done" : "badge open"}>{order.status}</span>
                  </td>
                  <td>{fmtDate(order.createdAt)}</td>
                  <td>{fmtDate(order.finishedAt)}</td>
                  <td>{totalUnits(order.id)}</td>
                  {sectors.map((sector) => (
                    <td key={`${order.id}-${sector.id}`}>{averageBySector(order.id, sector.id)}</td>
                  ))}
                  <td>{lastOperatorName(order.id)}</td>
                  <td className="actions">
                    <button onClick={() => navigate(`/ops/${order.id}`)}>Abrir</button>
                    {isAdmin && order.status !== "FINALIZADA" ? <button onClick={() => void finalizeOrder(order.id)}>Finalizar</button> : null}
                    {isAdmin ? (
                      <button
                        className="danger"
                        onClick={() => {
                          const confirmed = window.confirm(`Confirma excluir a OP ${order.number}? Esta acao nao pode ser desfeita.`);
                          if (!confirmed) {
                            return;
                          }
                          void deleteOrder(order.id);
                        }}
                      >
                        Excluir
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={8 + sectors.length}>Nenhuma OP cadastrada.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default OrdersPage;
