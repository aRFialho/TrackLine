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

const parseQuantity = (raw: string) => {
  const normalized = raw.replace(/\./g, "").replace(",", ".").trim();
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
};

const normalizeUnit = (raw: string) => raw.trim().toUpperCase().replace(/\./g, "");

const validUnits = new Set(["UN", "UND", "PC", "PCS", "PCA", "PCT", "M", "MT", "M2", "M3", "KG", "G", "L", "LT", "CJ"]);

const parseRowsFromLines = (lines: string[]): ImportedRow[] => {
  const rows: ImportedRow[] = [];
  let afterHeader = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) {
      continue;
    }

    const upper = line.toUpperCase();
    if (!afterHeader && upper.includes("QTDE") && upper.includes("UN") && (upper.includes("DESCR") || upper.includes("ITEM"))) {
      afterHeader = true;
      continue;
    }

    const match = line.match(/^(\d+(?:[.,]\d+)?)\s+([A-Za-z0-9]{1,6})\s+(.+)$/);
    if (!match) {
      continue;
    }

    const quantity = parseQuantity(match[1]);
    const unit = normalizeUnit(match[2]);
    const description = match[3].trim();

    if (quantity <= 0 || description.length < 2) {
      continue;
    }
    if (!afterHeader && !validUnits.has(unit)) {
      continue;
    }

    rows.push({ quantity, unit, description });
  }

  return rows;
};

const loadPdfDocument = async (file: File) => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

  const bytes = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  return { pdfjs, document };
};

const extractPdfLines = async (file: File): Promise<string[]> => {
  const { document } = await loadPdfDocument(file);
  const allLines: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items: { text: string; x: number; y: number }[] = [];
    for (const rawItem of textContent.items) {
      if (!("str" in rawItem)) {
        continue;
      }
      const text = String(rawItem.str ?? "").trim();
      if (!text) {
        continue;
      }
      items.push({ text, x: rawItem.transform[4], y: rawItem.transform[5] });
    }

    const rowsByY = new Map<number, { x: number; text: string }[]>();
    for (const item of items) {
      const yKey = Math.round(item.y * 2) / 2;
      const row = rowsByY.get(yKey) ?? [];
      row.push({ x: item.x, text: item.text });
      rowsByY.set(yKey, row);
    }

    const sortedY = Array.from(rowsByY.keys()).sort((a, b) => b - a);
    for (const y of sortedY) {
      const line = (rowsByY.get(y) ?? [])
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) {
        allLines.push(line);
      }
    }
  }

  return allLines;
};

const extractPdfLinesWithOcr = async (file: File): Promise<string[]> => {
  if (typeof document === "undefined") {
    return [];
  }

  const { document: pdfDocument } = await loadPdfDocument(file);
  const Tesseract = await import("tesseract.js");
  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      continue;
    }
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvasContext: context, viewport }).promise;

    const result = await Tesseract.recognize(canvas, "por", {
      logger: () => {
        // keep silent in UI; OCR can be slow and noisy
      }
    });

    const pageLines = result.data.text
      .split(/\r?\n/g)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    lines.push(...pageLines);
  }

  return lines;
};

export const parseOrderSpreadsheet = async (file: File): Promise<ImportedRow[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const firstSheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
  return extractRows(rows);
};

export const parseOrderPdf = async (file: File): Promise<ImportedRow[]> => {
  const lines = await extractPdfLines(file);
  let rows = parseRowsFromLines(lines);
  if (rows.length > 0) {
    return rows;
  }

  const ocrLines = await extractPdfLinesWithOcr(file);
  rows = parseRowsFromLines(ocrLines);
  if (rows.length > 0) {
    return rows;
  }

  throw new Error("PDF sem linhas validas de itens, mesmo com OCR. Verifique qualidade/legibilidade do arquivo.");
};

export const parseOrderFile = async (file: File): Promise<ImportedRow[]> => {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf") {
    return parseOrderPdf(file);
  }
  return parseOrderSpreadsheet(file);
};
