import * as XLSX from "xlsx";

export type ImportedRow = {
  quantity: number;
  unit: string;
  description: string;
};

const normalize = (value: string) => value.trim().toUpperCase().replace(/\s+/g, " ");

const findHeader = (headers: string[], options: string[]) => {
  const normalizedHeaders = headers.map(normalize);
  return options.map(normalize).find((option) => normalizedHeaders.includes(option));
};

const extractRows = (raw: Record<string, unknown>[]): ImportedRow[] => {
  if (raw.length === 0) {
    return [];
  }

  const headers = Object.keys(raw[0]);
  const quantityKey = findHeader(headers, ["QTDE", "QTD", "QUANTIDADE"]);
  const unitKey = findHeader(headers, ["UN", "UNIDADE"]);
  const descriptionKey = findHeader(headers, ["DESCRICAO", "DESCRIÇÃO", "ITEM"]);

  if (!quantityKey || !unitKey || !descriptionKey) {
    throw new Error("Planilha precisa conter colunas: QTDE/QTD, UN e DESCRICAO.");
  }

  return raw
    .map((row) => {
      const quantityValue = Number(row[quantityKey] ?? 0);
      const unit = String(row[unitKey] ?? "").trim();
      const description = String(row[descriptionKey] ?? "").trim();
      return {
        quantity: Number.isFinite(quantityValue) ? quantityValue : 0,
        unit,
        description
      };
    })
    .filter((row) => row.quantity > 0 && row.description.length > 0);
};

export const parseOrderSpreadsheet = async (file: File): Promise<ImportedRow[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const firstSheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
  return extractRows(rows);
};

