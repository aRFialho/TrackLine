import { FormEvent, useEffect, useState } from "react";
import { useProductionStore } from "../store/useProductionStore";
import type { ProductionDayCode } from "../types";

const productionDayOptions: Array<{ code: ProductionDayCode; label: string }> = [
  { code: "MON", label: "Segunda" },
  { code: "TUE", label: "Terca" },
  { code: "WED", label: "Quarta" },
  { code: "THU", label: "Quinta" },
  { code: "FRI", label: "Sexta" },
  { code: "SAT", label: "Sabado" },
  { code: "SUN", label: "Domingo" }
];

function AdminPage() {
  const {
    schedule,
    sectors,
    employees,
    addSector,
    updateSector,
    deleteSector,
    reorderSectors,
    addEmployee,
    updateEmployee,
    deleteEmployee,
    updateSchedule
  } = useProductionStore();
  const [sectorName, setSectorName] = useState("");
  const [editingSectorId, setEditingSectorId] = useState<string | null>(null);
  const [editingSectorName, setEditingSectorName] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [employeeSectorIds, setEmployeeSectorIds] = useState<string[]>([]);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingSectorIds, setEditingSectorIds] = useState<string[]>([]);
  const [sectorOrder, setSectorOrder] = useState<string[]>([]);
  const selectedProductionDays = schedule.productionDays?.length
    ? schedule.productionDays
    : (["MON", "TUE", "WED", "THU", "FRI"] as ProductionDayCode[]);

  useEffect(() => {
    if (employeeSectorIds.length === 0 && sectors[0]?.id) {
      setEmployeeSectorIds([sectors[0].id]);
    }
  }, [employeeSectorIds.length, sectors]);

  useEffect(() => {
    setSectorOrder(sectors.map((sector) => sector.id));
  }, [sectors]);

  const submitSector = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sectorName.trim()) {
      return;
    }
    await addSector(sectorName);
    setSectorName("");
  };

  const startEditingSector = (sectorId: string) => {
    const sector = sectors.find((row) => row.id === sectorId);
    if (!sector) {
      return;
    }
    setEditingSectorId(sectorId);
    setEditingSectorName(sector.name);
  };

  const cancelEditingSector = () => {
    setEditingSectorId(null);
    setEditingSectorName("");
  };

  const saveEditingSector = async () => {
    if (!editingSectorId || !editingSectorName.trim()) {
      return;
    }
    await updateSector(editingSectorId, editingSectorName.trim());
    cancelEditingSector();
  };

  const removeSector = async (sectorId: string, sectorNameToDelete: string) => {
    const confirmed = window.confirm(
      `Excluir setor "${sectorNameToDelete}"?\n\nNao sera permitido excluir setor que ja esteja em uso.`
    );
    if (!confirmed) {
      return;
    }
    await deleteSector(sectorId);
    if (editingSectorId === sectorId) {
      cancelEditingSector();
    }
  };

  const submitEmployee = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employeeName.trim() || employeeSectorIds.length === 0) {
      return;
    }
    await addEmployee(employeeName, employeeSectorIds);
    setEmployeeName("");
  };

  const startEditing = (employeeId: string) => {
    const employee = employees.find((row) => row.id === employeeId);
    if (!employee) {
      return;
    }
    setEditingEmployeeId(employeeId);
    setEditingName(employee.name);
    setEditingSectorIds(employee.sectorIds);
  };

  const cancelEditing = () => {
    setEditingEmployeeId(null);
    setEditingName("");
    setEditingSectorIds([]);
  };

  const saveEditing = async () => {
    if (!editingEmployeeId || !editingName.trim() || editingSectorIds.length === 0) {
      return;
    }
    await updateEmployee(editingEmployeeId, editingName, editingSectorIds);
    cancelEditing();
  };

  const removeEmployee = async (employeeId: string, employeeNameToDelete: string) => {
    const confirmed = window.confirm(`Excluir funcionario "${employeeNameToDelete}"?`);
    if (!confirmed) {
      return;
    }
    await deleteEmployee(employeeId);
    if (editingEmployeeId === employeeId) {
      cancelEditing();
    }
  };

  const moveSector = (sectorId: string, direction: "up" | "down") => {
    setSectorOrder((current) => {
      const index = current.indexOf(sectorId);
      if (index < 0) {
        return current;
      }
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [removed] = next.splice(index, 1);
      next.splice(targetIndex, 0, removed);
      return next;
    });
  };

  return (
    <section className="page admin-page">
      <header className="page-title">
        <h1>Admin</h1>
        <p>Configure expediente, setores e funcionarios por setor.</p>
      </header>

      <div className="grid-two">
        <div className="card">
          <h2>Horario de producao</h2>
          <div className="form-grid">
            <label>
              Inicio expediente
              <input
                type="time"
                value={schedule.workStart}
                onChange={(event) => void updateSchedule({ ...schedule, workStart: event.target.value })}
              />
            </label>
            <label>
              Fim expediente
              <input
                type="time"
                value={schedule.workEnd}
                onChange={(event) => void updateSchedule({ ...schedule, workEnd: event.target.value })}
              />
            </label>
            <label>
              Inicio almoco
              <input
                type="time"
                value={schedule.lunchStart}
                onChange={(event) => void updateSchedule({ ...schedule, lunchStart: event.target.value })}
              />
            </label>
            <label>
              Fim almoco
              <input
                type="time"
                value={schedule.lunchEnd}
                onChange={(event) => void updateSchedule({ ...schedule, lunchEnd: event.target.value })}
              />
            </label>
            <label className="full">
              Dias de producao (usados no calculo de tempo medio)
              <div className="sector-check-list">
                {productionDayOptions.map((option) => {
                  const checked = selectedProductionDays.includes(option.code);
                  return (
                    <label key={option.code} className="sector-check-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const nextDays = event.target.checked
                            ? [...new Set([...selectedProductionDays, option.code])]
                            : selectedProductionDays.filter((code) => code !== option.code);
                          if (nextDays.length === 0) {
                            return;
                          }
                          void updateSchedule({ ...schedule, productionDays: nextDays });
                        }}
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
            </label>
          </div>
        </div>

        <div className="card">
          <h2>Setores</h2>
          <form className="form-grid" onSubmit={submitSector}>
            <label>
              Nome do setor
              <input value={sectorName} onChange={(event) => setSectorName(event.target.value)} placeholder="Ex: Embalagem" />
            </label>
            <button type="submit">Adicionar setor</button>
          </form>
          <ul className="simple-list">
            {sectors.map((sector) => (
              <li key={sector.id}>{sector.name}</li>
            ))}
          </ul>
          <hr />
          <h3>Fluxo de producao (sem pular etapas)</h3>
          <p className="muted-line">Defina da primeira ate a ultima etapa. O sistema bloqueia conclusao fora da sequencia.</p>
          <div className="flow-list">
            {sectorOrder.map((sectorId, index) => {
              const sector = sectors.find((row) => row.id === sectorId);
              if (!sector) {
                return null;
              }
              return (
                <div key={sector.id} className="flow-item">
                  {editingSectorId === sector.id ? (
                    <strong>{index + 1}. Editando setor</strong>
                  ) : (
                    <strong>
                      {index + 1}. {sector.name}
                    </strong>
                  )}
                  <div className="actions">
                    {editingSectorId === sector.id ? (
                      <>
                        <input
                          value={editingSectorName}
                          onChange={(event) => setEditingSectorName(event.target.value)}
                          placeholder="Nome do setor"
                        />
                        <button className="mini-btn" type="button" onClick={() => void saveEditingSector()}>
                          Salvar
                        </button>
                        <button className="mini-btn ghost" type="button" onClick={cancelEditingSector}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="mini-btn" type="button" onClick={() => startEditingSector(sector.id)}>
                          Editar
                        </button>
                        <button className="mini-btn danger" type="button" onClick={() => void removeSector(sector.id, sector.name)}>
                          Excluir
                        </button>
                      </>
                    )}
                    <button className="mini-btn ghost" type="button" onClick={() => moveSector(sector.id, "up")}>
                      Subir
                    </button>
                    <button className="mini-btn ghost" type="button" onClick={() => moveSector(sector.id, "down")}>
                      Descer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => void reorderSectors(sectorOrder)}>
            Salvar fluxo
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Funcionarios</h2>
        <form className="form-grid" onSubmit={submitEmployee}>
          <label>
            Nome
            <input value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} />
          </label>
          <label className="full">
            Setores permitidos
            <div className="sector-check-list">
              {sectors.map((sector) => {
                const checked = employeeSectorIds.includes(sector.id);
                return (
                  <label key={sector.id} className="sector-check-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setEmployeeSectorIds((current) => [...new Set([...current, sector.id])]);
                          return;
                        }
                        setEmployeeSectorIds((current) => current.filter((id) => id !== sector.id));
                      }}
                    />
                    {sector.name}
                  </label>
                );
              })}
            </div>
          </label>
          <button type="submit">Adicionar funcionario</button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Setor</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => {
                const editing = editingEmployeeId === employee.id;
                return (
                  <tr key={employee.id}>
                    <td>
                      {editing ? (
                        <input value={editingName} onChange={(event) => setEditingName(event.target.value)} />
                      ) : (
                        employee.name
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <div className="sector-check-list">
                          {sectors.map((sector) => {
                            const checked = editingSectorIds.includes(sector.id);
                            return (
                              <label key={sector.id} className="sector-check-item">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) => {
                                    if (event.target.checked) {
                                      setEditingSectorIds((current) => [...new Set([...current, sector.id])]);
                                      return;
                                    }
                                    setEditingSectorIds((current) => current.filter((id) => id !== sector.id));
                                  }}
                                />
                                {sector.name}
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        employee.sectorIds
                          .map((sectorId) => sectors.find((sector) => sector.id === sectorId)?.name ?? "")
                          .filter(Boolean)
                          .join(", ") || "-"
                      )}
                    </td>
                    <td className="actions">
                      {editing ? (
                        <>
                          <button className="mini-btn" onClick={() => void saveEditing()}>
                            Salvar
                          </button>
                          <button className="mini-btn ghost" onClick={cancelEditing}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="mini-btn" onClick={() => startEditing(employee.id)}>
                            Editar
                          </button>
                          <button className="mini-btn danger" onClick={() => void removeEmployee(employee.id, employee.name)}>
                            Excluir
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default AdminPage;
