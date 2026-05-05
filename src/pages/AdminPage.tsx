import { FormEvent, useEffect, useState } from "react";
import { useProductionStore } from "../store/useProductionStore";

function AdminPage() {
  const { schedule, sectors, employees, addSector, addEmployee, updateEmployee, deleteEmployee, updateSchedule } =
    useProductionStore();
  const [sectorName, setSectorName] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [employeeSectorIds, setEmployeeSectorIds] = useState<string[]>([]);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingSectorIds, setEditingSectorIds] = useState<string[]>([]);

  useEffect(() => {
    if (employeeSectorIds.length === 0 && sectors[0]?.id) {
      setEmployeeSectorIds([sectors[0].id]);
    }
  }, [employeeSectorIds.length, sectors]);

  const submitSector = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sectorName.trim()) {
      return;
    }
    await addSector(sectorName);
    setSectorName("");
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

  return (
    <section className="page">
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
