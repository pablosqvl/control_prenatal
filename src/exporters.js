const prenatalFormatDateForExport = window.Prenatal.formatDate;
const prenatalFormatGestAgeForExport = window.Prenatal.formatGestAge;
const writeWorkbookForExport = window.XlsxLite.writeWorkbook;

function exportCsv(episodes) {
  const rows = buildEpisodeRows(episodes);
  downloadText(toCsv(rows), `seguimiento_prenatal_${dateStamp()}.csv`, "text/csv;charset=utf-8");
}

function exportXlsx(episodes) {
  writeWorkbookForExport(
    [
      { name: "episodios", rows: buildEpisodeRows(episodes) },
      { name: "acciones", rows: buildActionRows(episodes) },
      { name: "rismi", rows: episodes.flatMap((episode) => episode.rismiRows.map((row) => sourceRow(episode, row, "RISMI"))) },
      { name: "sigep", rows: episodes.flatMap((episode) => episode.sigepRows.map((row) => sourceRow(episode, row, "SIGEP"))) },
    ],
    `seguimiento_prenatal_${dateStamp()}.xlsx`,
  );
}

function buildEpisodeRows(episodes) {
  return episodes.map((episode) => ({
    dni: episode.dni,
    paciente: episode.patientName,
    id_rismi: episode.patientId,
    estado_cumplimiento: episode.status,
    proxima_accion: episode.nextAction,
    fpp: prenatalFormatDateForExport(episode.fpp),
    ege: prenatalFormatGestAgeForExport(episode.currentEge),
    ultimo_control: prenatalFormatDateForExport(episode.lastDate),
    efector_servicio: episode.service,
    tiene_dom_sigep: episode.hasDom ? "SI" : "NO",
    captacion_temprana_sigep: episode.earlyCaptureInSigep ? "SI" : "NO",
    pendientes_sigep: episode.admin.missingInSigep ? "SI" : "NO",
    correcciones_rismi: episode.admin.correctableRows.length,
  }));
}

function buildActionRows(episodes) {
  return episodes.flatMap((episode) =>
    episode.actions.map((action) => ({
      dni: episode.dni,
      paciente: episode.patientName,
      accion: action,
      estado_cumplimiento: episode.status,
      fpp: prenatalFormatDateForExport(episode.fpp),
      ege: prenatalFormatGestAgeForExport(episode.currentEge),
    })),
  );
}

function sourceRow(episode, row, sourceType) {
  return {
    fuente: sourceType,
    dni: episode.dni,
    paciente: episode.patientName,
    fecha: prenatalFormatDateForExport(row.date),
    codigo: row.code,
    diagnostico: row.diagnosis,
    descripcion: row.prestation || row.description || "",
    efector_servicio: row.service || row.place || "",
    comprobante: row.receiptId || "",
    archivo: row.source || "",
  };
}

function toCsv(rows) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const lines = [columns.join(";")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(";"));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadText(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

window.Exporters = {
  exportCsv,
  exportXlsx,
};
