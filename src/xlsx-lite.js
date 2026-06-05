async function readSpreadsheet(file) {
  const workbookApi = window.XLSX;
  if (workbookApi) {
    const buffer = await file.arrayBuffer();
    const workbook = workbookApi.read(buffer, { type: "array", cellDates: true });
    const firstSheet = workbook.SheetNames[0];
    const rows = workbookApi.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: null });
    return rows.map((row) => ({ ...row, __source: file.name }));
  }

  if (file.name.toLowerCase().endsWith(".xlsx")) {
    const rows = await readXlsxLocally(file);
    return rows.map((row) => ({ ...row, __source: file.name }));
  }

  throw new Error("No se pudo cargar XLSX desde CDN. Para .xls hace falta conexión o convertir el archivo a .xlsx.");
}

function writeWorkbook(sheets, filename) {
  const workbookApi = window.XLSX;
  if (!workbookApi) {
    throw new Error("No se pudo cargar la librería XLSX.");
  }
  const workbook = workbookApi.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = workbookApi.utils.json_to_sheet(sheet.rows);
    workbookApi.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  workbookApi.writeFile(workbook, filename);
}

window.XlsxLite = {
  readSpreadsheet,
  writeWorkbook,
};

async function readXlsxLocally(file) {
  const entries = await unzipEntries(await file.arrayBuffer());
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml") || "");
  const sheetPath = findFirstSheetPath(entries);
  const sheetXml = entries.get(sheetPath);
  if (!sheetXml) throw new Error("No se encontró la primera hoja del XLSX.");
  return sheetXmlToJson(sheetXml, sharedStrings);
}

function findFirstSheetPath(entries) {
  if (entries.has("xl/worksheets/sheet1.xml")) return "xl/worksheets/sheet1.xml";
  const first = Array.from(entries.keys()).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!first) throw new Error("El XLSX no contiene hojas legibles.");
  return first;
}

async function unzipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const entries = new Map();
  let offset = 0;

  while (offset < bytes.length - 4) {
    const signature = readUint32(bytes, offset);
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const method = readUint16(bytes, offset + 8);
    const compressedSize = readUint32(bytes, offset + 18);
    const uncompressedSize = readUint32(bytes, offset + 22);
    const nameLength = readUint16(bytes, offset + 26);
    const extraLength = readUint16(bytes, offset + 28);
    const nameStart = offset + 30;
    const name = decodeBytes(bytes.slice(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const compressed = bytes.slice(dataStart, dataEnd);

    if (!name.endsWith("/")) {
      entries.set(name, await inflateZipEntry(compressed, method, uncompressedSize));
    }

    offset = dataEnd;
  }

  return entries;
}

async function inflateZipEntry(compressed, method, uncompressedSize) {
  if (method === 0) return decodeBytes(compressed);
  if (method !== 8) throw new Error(`Método ZIP no soportado: ${method}`);
  if (!("DecompressionStream" in window)) {
    throw new Error("Este navegador no permite descomprimir XLSX sin librería externa.");
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  const out = new Uint8Array(buffer);
  if (uncompressedSize && out.length !== uncompressedSize) {
    return decodeBytes(out);
  }
  return decodeBytes(out);
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const doc = parseXml(xml);
  return Array.from(doc.querySelectorAll("si")).map((node) =>
    Array.from(node.querySelectorAll("t"))
      .map((part) => part.textContent || "")
      .join(""),
  );
}

function sheetXmlToJson(xml, sharedStrings) {
  const doc = parseXml(xml);
  const rowMaps = Array.from(doc.querySelectorAll("sheetData row")).map((rowNode) => {
    const row = new Map();
    for (const cell of rowNode.querySelectorAll("c")) {
      const ref = cell.getAttribute("r") || "";
      const column = ref.replace(/\d+/g, "");
      row.set(columnToIndex(column), readCell(cell, sharedStrings));
    }
    return row;
  });

  if (!rowMaps.length) return [];
  const headers = mapToArray(rowMaps[0]).map((value) => String(value || "").trim());
  return rowMaps.slice(1).map((rowMap) => {
    const values = mapToArray(rowMap);
    const row = {};
    headers.forEach((header, index) => {
      if (header) row[header] = values[index] ?? null;
    });
    return row;
  });
}

function readCell(cell, sharedStrings) {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") return cell.querySelector("is t")?.textContent || "";
  const raw = cell.querySelector("v")?.textContent || "";
  if (type === "s") return sharedStrings[Number(raw)] || "";
  if (type === "str") return raw;
  if (type === "b") return raw === "1";
  if (raw === "") return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : raw;
}

function parseXml(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const error = doc.querySelector("parsererror");
  if (error) throw new Error("No se pudo leer XML interno del XLSX.");
  return doc;
}

function mapToArray(map) {
  const max = Math.max(...map.keys());
  return Array.from({ length: max + 1 }, (_, index) => map.get(index) ?? null);
}

function columnToIndex(column) {
  let index = 0;
  for (const char of column) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function decodeBytes(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}
