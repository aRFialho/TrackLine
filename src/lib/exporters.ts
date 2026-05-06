import * as XLSX from "xlsx";
import dayjs from "dayjs";
import type { Employee, ProductionOrder, Sector } from "../types";

type ExportRow = {
  OP: string;
  NomeOP: string;
  ItemID: string;
  Descricao: string;
  Quantidade: number;
  Unidade: string;
  Setor: string;
  Status: string;
  Funcionario: string;
  LiberadoEm: string;
  IniciadoEm: string;
  FinalizadoEm: string;
  MinutosUteis: number | "";
};

const fmtDate = (iso?: string) => (iso ? dayjs(iso).format("DD/MM/YYYY HH:mm:ss") : "");

const normalizeFileName = (value: string) =>
  value
    .trim()
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_");

const buildRows = (order: ProductionOrder, sectors: Sector[], employees: Employee[]): ExportRow[] => {
  const sectorNameById = Object.fromEntries(sectors.map((sector) => [sector.id, sector.name]));
  const employeeById = Object.fromEntries(employees.map((employee) => [employee.id, employee.name]));
  return order.items.flatMap((item) =>
    item.operations.map((operation) => ({
      OP: order.number,
      NomeOP: order.name,
      ItemID: item.id,
      Descricao: item.description,
      Quantidade: item.quantity,
      Unidade: item.unit,
      Setor: sectorNameById[operation.sectorId] ?? operation.sectorId,
      Status: operation.status,
      Funcionario: operation.employeeId ? employeeById[operation.employeeId] ?? operation.employeeId : "",
      LiberadoEm: fmtDate(operation.releasedAt),
      IniciadoEm: fmtDate(operation.startedAt),
      FinalizadoEm: fmtDate(operation.finishedAt),
      MinutosUteis: typeof operation.usefulMinutes === "number" ? operation.usefulMinutes : ""
    }))
  );
};

const csvEscape = (value: string | number) => {
  const text = String(value ?? "");
  if (text.includes(";") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

export const exportOrderCsvSemicolon = (order: ProductionOrder, sectors: Sector[], employees: Employee[]) => {
  const rows = buildRows(order, sectors, employees);
  const headers = [
    "OP",
    "NomeOP",
    "ItemID",
    "Descricao",
    "Quantidade",
    "Unidade",
    "Setor",
    "Status",
    "Funcionario",
    "LiberadoEm",
    "IniciadoEm",
    "FinalizadoEm",
    "MinutosUteis"
  ] as const;
  const lines = [headers.join(";")];
  rows.forEach((row) => {
    const values = headers.map((header) => csvEscape(row[header]));
    lines.push(values.join(";"));
  });

  const bom = "\uFEFF";
  const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `OP_${normalizeFileName(order.number)}_detalhado.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const exportOrderXlsxDetailed = (order: ProductionOrder, sectors: Sector[], employees: Employee[]) => {
  const rows = buildRows(order, sectors, employees);
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 16 },
    { wch: 30 },
    { wch: 38 },
    { wch: 38 },
    { wch: 12 },
    { wch: 10 },
    { wch: 18 },
    { wch: 14 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
    { wch: 12 }
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "OP Detalhada");
  XLSX.writeFile(workbook, `OP_${normalizeFileName(order.number)}_detalhado.xlsx`);
};
