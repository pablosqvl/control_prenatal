let pdfjsPromise = null;

async function readSigepPdf(file) {
  const pdfjs = await getPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pages = [];

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }

  return parseSigepText(pages.join(" "), file.name);
}

function parseSigepText(rawText, source = "") {
  const text = rawText.replace(/\s+/g, " ").trim();
  const beneficiary = text.match(/Benef:\s*\[([^\]]+)\]\s*(.*?)\s*-\s*DNI:\s*(\d+)\s*-\s*Fec\.\s*Nac:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const tableText = text.split(/Fecha\s+Prest\.\s+Lugar\s+de\s+Realización\s+Código\s+Descripción/i).pop() || text;
  const dni = beneficiary ? beneficiary[3] : "";
  const name = beneficiary ? beneficiary[2].trim() : "Sin beneficiario";
  const beneficiaryNumber = beneficiary ? beneficiary[1].trim() : "";
  const birthDate = beneficiary ? parseDmy(beneficiary[4]) : null;
  const rows = [];
  const rowRegex = /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([A-Z]{2}\s+[A-Z]\d{3})\s+([A-Z]\d{2}(?:\.\d)?)\s+(.+?)(?=\s+\d{2}\/\d{2}\/\d{4}\s+| TOTAL:|\s+\[[^\]]+\]\s+\d+\/\d+|$)/g;
  let match;

  while ((match = rowRegex.exec(tableText)) !== null) {
    rows.push({
      date: parseDmy(match[1]),
      dateKey: toDateKey(parseDmy(match[1])),
      place: match[2].trim(),
      code: match[3].replace(/\s+/g, " ").trim(),
      diagnosis: match[4].trim(),
      description: match[5].trim(),
      dni,
      beneficiaryName: name,
      beneficiaryNumber,
      birthDate,
      source,
    });
  }

  return { source, dni, name, beneficiaryNumber, birthDate, rows };
}

async function getPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  if (!pdfjsPromise) {
    pdfjsPromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs")
      .then((mod) => {
        mod.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
        return mod;
      })
      .catch((error) => {
        throw new Error(`No se pudo cargar PDF.js para leer DOM SIGEP. Verificá la conexión o publicá PDF.js localmente. ${error.message}`);
      });
  }
  return pdfjsPromise;
}

function parseDmy(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function toDateKey(date) {
  return date ? date.toISOString().slice(0, 10) : "";
}

window.SigepPdf = {
  parseSigepText,
  readSigepPdf,
};
