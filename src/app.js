const prenatalRules = window.Prenatal.DEFAULT_RULES;
const prenatalBuildEpisodes = window.Prenatal.buildEpisodes;
const prenatalDateRangeForControl = window.Prenatal.dateRangeForControl;
const prenatalFormatDate = window.Prenatal.formatDate;
const prenatalFormatGestAge = window.Prenatal.formatGestAge;
const prenatalNormalizeRismiRows = window.Prenatal.normalizeRismiRows;
const sigepReadPdf = window.SigepPdf.readSigepPdf;
const xlsxReadSpreadsheet = window.XlsxLite.readSpreadsheet;
const downloadCsv = window.Exporters.exportCsv;
const downloadXlsx = window.Exporters.exportXlsx;

const state = {
  rismiRows: [],
  sigepDocs: [],
  episodes: [],
  selectedId: null,
  query: "",
  filter: "Todos",
  sort: "priority",
};

const els = {
  statusLine: document.querySelector("#statusLine"),
  rismiInput: document.querySelector("#rismiInput"),
  sigepInput: document.querySelector("#sigepInput"),
  darkModeToggle: document.querySelector("#darkModeToggle"),
  exportCsvBtn: document.querySelector("#exportCsvBtn"),
  exportXlsxBtn: document.querySelector("#exportXlsxBtn"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  filterBar: document.querySelector("#filterBar"),
  episodeList: document.querySelector("#episodeList"),
  episodeCount: document.querySelector("#episodeCount"),
  episodeDetail: document.querySelector("#episodeDetail"),
  kpiPregnancies: document.querySelector("#kpiPregnancies"),
  kpiEarly: document.querySelector("#kpiEarly"),
  kpiComplete: document.querySelector("#kpiComplete"),
  kpiSigep: document.querySelector("#kpiSigep"),
  kpiCorrections: document.querySelector("#kpiCorrections"),
};

const FILTERS = ["Todos", "Alerta", "Cumplimiento parcial", "En seguimiento de cumplimiento", "Cumplimiento total", "Sin DOM"];

init();

function init() {
  window.addEventListener("error", (event) => setStatus(`Error de aplicación: ${event.message}`));
  window.addEventListener("unhandledrejection", (event) => setStatus(`Error de lectura: ${event.reason?.message || event.reason}`));
  renderFilters();
  render();
  els.rismiInput.addEventListener("change", handleRismiFiles);
  els.sigepInput.addEventListener("change", handleSigepFiles);
  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });
  els.sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });
  els.darkModeToggle.addEventListener("change", (event) => {
    document.documentElement.classList.toggle("dark", event.target.checked);
  });
  els.exportCsvBtn.addEventListener("click", () => exportWhenReady("csv"));
  els.exportXlsxBtn.addEventListener("click", () => exportWhenReady("xlsx"));
  els.filterBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    render();
  });
  setStatus("Aplicación lista. Cargá RISMI y DOM SIGEP para comenzar.");
}

async function handleRismiFiles(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  setStatus(`RISMI seleccionado: ${files.length} archivo(s). Leyendo...`);
  try {
    const rawRows = (await Promise.all(files.map(xlsxReadSpreadsheet))).flat();
    state.rismiRows = prenatalNormalizeRismiRows(rawRows);
    rebuildEpisodes();
    setStatus(`RISMI cargado: ${state.rismiRows.length} prestaciones leídas.`);
  } catch (error) {
    setStatus(`Error RISMI: ${error.message}`);
  }
}

async function handleSigepFiles(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  setStatus(`DOM SIGEP seleccionado: ${files.length} archivo(s). Leyendo...`);
  try {
    state.sigepDocs = await Promise.all(files.map(sigepReadPdf));
    rebuildEpisodes();
    const count = state.sigepDocs.reduce((sum, doc) => sum + doc.rows.length, 0);
    setStatus(`SIGEP cargado: ${count} prestaciones DOM leídas.`);
  } catch (error) {
    setStatus(`Error SIGEP: ${error.message}`);
  }
}

function rebuildEpisodes() {
  state.episodes = prenatalBuildEpisodes(state.rismiRows, state.sigepDocs, prenatalRules, new Date());
  if (!state.selectedId || !state.episodes.some((episode) => episode.id === state.selectedId)) {
    state.selectedId = state.episodes[0]?.id || null;
  }
  render();
}

function render() {
  const episodes = getVisibleEpisodes();
  renderKpis();
  renderFilters();
  renderEpisodeList(episodes);
  renderDetail();
}

function renderKpis() {
  const episodes = state.episodes;
  els.kpiPregnancies.textContent = episodes.length;
  els.kpiEarly.textContent = episodes.filter((episode) => episode.earlyCaptureInSigep).length;
  els.kpiComplete.textContent = episodes.filter((episode) => episode.status === "Cumplimiento total").length;
  els.kpiSigep.textContent = episodes.filter((episode) => episode.admin.missingInSigep || !episode.hasDom).length;
  els.kpiCorrections.textContent = episodes.reduce((sum, episode) => sum + episode.admin.correctableRows.length, 0);
  els.episodeCount.textContent = `${episodes.length} casos`;
}

function renderFilters() {
  els.filterBar.innerHTML = FILTERS.map((filter) => `<button class="filter-chip" type="button" data-filter="${escapeAttr(filter)}">${filter}</button>`).join("");
  for (const button of els.filterBar.querySelectorAll("[data-filter]")) {
    button.classList.toggle("active", button.dataset.filter === state.filter);
  }
}

function renderEpisodeList(episodes) {
  if (!episodes.length) {
    els.episodeList.innerHTML = `<div class="list-empty">No hay embarazos para mostrar.</div>`;
    return;
  }

  els.episodeList.innerHTML = episodes
    .map(
      (episode) => `
        <button class="episode-row ${episode.id === state.selectedId ? "active" : ""}" type="button" data-id="${escapeAttr(episode.id)}">
          <span class="row-main">
            <strong>${escapeHtml(episode.patientName)}</strong>
            <span>DNI ${escapeHtml(episode.dni)} · ${escapeHtml(episode.service || "Sin efector")}</span>
          </span>
          <span class="state-badge ${stateClass(episode.status)}">${escapeHtml(episode.status)}</span>
          <span class="row-meta">
            <span>FPP ${prenatalFormatDate(episode.fpp)}</span>
            <span>${prenatalFormatGestAge(episode.currentEge)}</span>
            <span>${escapeHtml(episode.nextAction)}</span>
          </span>
        </button>
      `,
    )
    .join("");

  els.episodeList.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      render();
    });
  });
}

function renderDetail() {
  const episode = state.episodes.find((item) => item.id === state.selectedId);
  els.episodeDetail.hidden = !episode;
  if (!episode) return;

  els.episodeDetail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${escapeHtml(episode.patientName)}</h2>
        <p>DNI ${escapeHtml(episode.dni)} · ${escapeHtml(episode.service || "Sin efector informado")}</p>
      </div>
      <span class="state-badge large ${stateClass(episode.status)}">${escapeHtml(episode.status)}</span>
    </div>

    <div class="detail-grid">
      ${detailMetric("ID RISMI", episode.patientId || "Sin dato")}
      ${detailMetric("FPP estimada", prenatalFormatDate(episode.fpp))}
      ${detailMetric("EGE actual", prenatalFormatGestAge(episode.currentEge))}
      ${detailMetric("Último control", prenatalFormatDate(episode.lastDate))}
    </div>

    <div class="actions-strip">
      ${episode.actions.map((action) => `<span class="action-badge ${actionClass(action)}">${escapeHtml(action)}</span>`).join("")}
    </div>

    <div class="link-row">
      <button class="button secondary" data-copy="${escapeAttr(episode.dni)}" type="button">Copiar DNI</button>
      ${
        episode.patientId
          ? `<a class="button secondary" target="_blank" rel="noreferrer" href="http://10.1.4.64/rismi/hca/saveUser.php?id=${encodeURIComponent(episode.patientId)}&idturno=0">Historia RISMI</a>`
          : ""
      }
      <a class="button secondary" target="_blank" rel="noreferrer" href="https://sistemasmsp.misiones.gob.ar/nacer/modulos/facturacion/listado_prestaciones_doms.php">Abrir SIGEP DOM</a>
    </div>

    <p class="calculation-note">La FPP se estima desde las edades gestacionales registradas en RISMI. Los rangos futuros se muestran como "Aún no corresponde".</p>

    ${section("Controles prenatales", renderControlsTable(episode))}
    ${section("Componentes de trazadora", renderComponentsTable(episode))}
    ${section("Prestaciones RISMI", renderSourceTable(episode.rismiRows, "rismi"))}
    ${section("Prestaciones SIGEP DOM", episode.hasDom ? renderSourceTable(episode.sigepRows, "sigep") : missingDomBox(episode))}
  `;

  els.episodeDetail.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copy));
  });
}

function renderControlsTable(episode) {
  const rows = episode.controls
    .map(
      (control) => `
        <tr>
          <td>${escapeHtml(control.label)}</td>
          <td>${escapeHtml(`${control.start}-${control.end}`)}</td>
          <td>${escapeHtml(prenatalDateRangeForControl(control, episode.fpp))}</td>
          <td><span class="mini-state ${control.state}">${controlLabel(control.state)}</span></td>
          <td>${control.rismiRows.length}</td>
          <td>${control.sigepRows.length}</td>
        </tr>
      `,
    )
    .join("");
  return table(["Rango", "Semanas", "Fechas estimadas", "Estado", "RISMI", "SIGEP"], rows);
}

function renderComponentsTable(episode) {
  const rows = episode.components
    .map(
      (component) => `
        <tr>
          <td>${escapeHtml(component.label)}</td>
          <td>${component.rismiRows.length}</td>
          <td>${component.sigepRows.length}</td>
        </tr>
      `,
    )
    .join("");
  return table(["Componente", "RISMI", "SIGEP"], rows);
}

function renderSourceTable(rows, source) {
  if (!rows.length) return `<div class="list-empty">Sin prestaciones para mostrar.</div>`;
  const htmlRows = rows
    .slice()
    .sort((a, b) => (b.date || 0) - (a.date || 0))
    .map((row) => {
      const description = source === "rismi" ? row.prestation : row.description;
      const place = source === "rismi" ? row.service : row.place;
      const receipt = row.receiptId
        ? `<a href="http://10.1.4.64/rismi/administracion/admcomprobante.php?action=buscar&li=0&comprobanteID=${encodeURIComponent(row.receiptId)}" target="_blank" rel="noreferrer">${escapeHtml(row.receiptId)}</a>`
        : "";
      return `
        <tr>
          <td>${prenatalFormatDate(row.date)}</td>
          <td><code>${escapeHtml(row.code || "")}</code></td>
          <td>${escapeHtml(row.diagnosis || "")}</td>
          <td>${escapeHtml(description || "")}</td>
          <td>${escapeHtml(place || "")}</td>
          <td>${receipt}</td>
        </tr>
      `;
    })
    .join("");
  return table(["Fecha", "Código", "Dx", "Descripción", "Efector/Servicio", "Comprobante"], htmlRows);
}

function missingDomBox(episode) {
  return `
    <div class="warning-box">
      <strong>Falta DOM SIGEP para esta paciente.</strong>
      <p>Copiá el DNI y descargá el DOM desde SIGEP para validar impacto prestacional.</p>
      <button class="button primary" data-copy="${escapeAttr(episode.dni)}" type="button">Copiar DNI</button>
    </div>
  `;
}

function getVisibleEpisodes() {
  const query = normalizeSearch(state.query);
  let episodes = state.episodes.filter((episode) => {
    const matchesQuery = !query || normalizeSearch(`${episode.patientName} ${episode.dni}`).includes(query);
    const matchesFilter =
      state.filter === "Todos" ||
      episode.status === state.filter ||
      (state.filter === "Sin DOM" && !episode.hasDom);
    return matchesQuery && matchesFilter;
  });

  episodes = episodes.slice().sort((a, b) => {
    if (state.sort === "name") return a.patientName.localeCompare(b.patientName);
    if (state.sort === "lastDate") return (b.lastDate || 0) - (a.lastDate || 0);
    if (state.sort === "fpp") return (a.fpp || 0) - (b.fpp || 0);
    if (state.sort === "ege") return (b.currentEge || 0) - (a.currentEge || 0);
    return 0;
  });

  return episodes;
}

function exportWhenReady(type) {
  if (!state.episodes.length) {
    setStatus("No hay episodios para exportar.");
    return;
  }
  try {
    if (type === "csv") {
      downloadCsv(state.episodes);
      setStatus("Exportación CSV generada.");
    } else if (!window.XLSX) {
      downloadCsv(state.episodes);
      setStatus("XLSX no está disponible sin conexión; se generó CSV como alternativa.");
    } else {
      downloadXlsx(state.episodes);
      setStatus("Exportación XLSX generada.");
    }
  } catch (error) {
    setStatus(`Error de exportación: ${error.message}`);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`Copiado al portapapeles: ${text}`);
  } catch {
    setStatus("No se pudo copiar al portapapeles.");
  }
}

function setStatus(message) {
  els.statusLine.textContent = message;
}

function section(title, content) {
  return `
    <section class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      ${content}
    </section>
  `;
}

function table(headers, rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function detailMetric(label, value) {
  return `
    <div class="detail-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function stateClass(status) {
  return {
    Alerta: "danger",
    "Cumplimiento parcial": "warning",
    "En seguimiento de cumplimiento": "info",
    "Cumplimiento total": "success",
  }[status] || "info";
}

function actionClass(action) {
  if (action.includes("SIGEP")) return "sigep";
  if (action.includes("RISMI")) return "rismi";
  if (action.includes("faltante")) return "danger";
  if (action.includes("Validado")) return "success";
  return "info";
}

function controlLabel(stateName) {
  return {
    complete: "Cumplido",
    correctable: "Corregir RISMI",
    missing: "Faltante",
    wait: "Aún no corresponde",
    alert: "Alerta",
  }[stateName] || stateName;
}

function componentLabel(stateName) {
  return {
    complete: "Cumplido en SIGEP",
    partial: "Parcial",
    missing: "Faltante",
    wait: "Aún no corresponde",
  }[stateName] || stateName;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
