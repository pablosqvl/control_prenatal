const DEFAULT_RULES = {
  controlRanges: [
    { id: "c1", label: "Control 1", start: 0, end: 12.9 },
    { id: "c2", label: "Control 2", start: 13, end: 20.9 },
    { id: "c3", label: "Control 3", start: 21, end: 30.9 },
    { id: "c4", label: "Control 4", start: 31, end: 34.9 },
    { id: "c5", label: "Control 5", start: 35, end: 39.9 },
  ],
  sigep: {
    earlyCapture: "CT C003",
    firstControl: "CT C005",
    followUpControl: "CT C006",
    ultrasound: "IG R031",
    pap: "PR P018",
    labPrefix: "LB",
    vaccines: ["IM V008", "IM V013"],
  },
  rismi: {
    firstControl: "1852",
    followUpControl: "1853",
    earlyCapture: "3629",
    gynecology: "1095",
    ultrasound: "15",
    vaccines: ["1857", "1858", "1859", "1861"],
  },
  required: {
    controls: 5,
    ultrasounds: 3,
    labs: 3,
    vaccines: 1,
    pap: 1,
  },
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeRismiRows(rows) {
  const seen = new Set();
  return rows
    .map((row, index) => normalizeRismiRow(row, index))
    .filter((row) => {
      if (!row.dni || !row.date || !row.code) return false;
      const key = row.receiptId || `${row.dni}-${row.dateKey}-${row.code}-${row.index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildEpisodes(rismiRows, sigepDocs, rules = DEFAULT_RULES, today = new Date()) {
  const sigepByDni = groupBy(sigepDocs.flatMap((doc) => doc.rows), (row) => row.dni);
  const rowsByDni = groupBy(rismiRows, (row) => row.dni);
  const episodes = [];

  for (const [dni, rows] of rowsByDni.entries()) {
    const evidenceRows = rows.filter((row) => hasPregnancyEvidence(row, rules));
    if (!evidenceRows.length) continue;

    const patient = pickPatient(rows);
    const fpp = estimateFpp(evidenceRows);
    const sigepRows = (sigepByDni.get(dni) || []).map((row) => ({ ...row, gestAge: gestAgeForDate(row.date, fpp) }));
    const currentEge = fpp ? clamp((40 * 7 - daysBetween(today, fpp)) / 7, 0, 45) : null;
    const controls = evaluateControls(rows, sigepRows, currentEge, rules);
    const components = evaluateComponents(rows, sigepRows, currentEge, rules);
    const admin = evaluateAdministrativeState(rows, sigepRows, controls, components, rules);
    const status = classifyCompliance(controls, components, currentEge);
    const actions = buildActions(status, admin, controls, components, Boolean(sigepRows.length));

    episodes.push({
      id: dni,
      dni,
      patientName: patient.name,
      patientId: patient.id,
      birthDate: patient.birthDate,
      service: patient.service,
      professional: patient.professional,
      lastDate: maxDate(rows.map((row) => row.date)),
      fpp,
      currentEge,
      controls,
      components,
      admin,
      status,
      nextAction: actions[0] || "Revisar seguimiento",
      actions,
      rismiRows: rows.sort(byDateAsc),
      sigepRows: sigepRows.sort(byDateAsc),
      hasDom: Boolean(sigepRows.length),
      earlyCaptureInSigep: sigepRows.some((row) => row.code === rules.sigep.earlyCapture && gestAgeForDate(row.date, fpp) <= 12.9),
    });
  }

  return episodes.sort(compareEpisodePriority);
}

function normalizeRismiRow(row, index = 0) {
  const patient = String(row.Paciente || row.paciente || "").trim();
  const patientMatch = patient.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const rawDate = row.Fecha || row.fecha;
  const date = normalizeDate(rawDate);
  const prestation = String(row.Prestacion || row.prestacion || "").trim();
  const code = (prestation.match(/^(\d+)/) || [])[1] || "";
  const evolution = cleanText(row.Evolucion || row.evolucion || "");

  return {
    index,
    receiptId: valueToText(row["Id Comprobante"] || row.idComprobante || row.Comprobante),
    date,
    dateKey: date ? date.toISOString().slice(0, 10) : "",
    patientName: cleanText(patientMatch ? patientMatch[1] : patient),
    patientId: patientMatch ? patientMatch[2] : "",
    dni: onlyDigits(row.Documento || row.documento),
    birthDate: normalizeDate(row["Fecha Nacimiento"]),
    prestation,
    code,
    diagnosis: cleanText(row.Diagnosticos || row.diagnosticos || ""),
    evolution,
    gestAge: parseGestationalAge(evolution),
    service: cleanText(row.Servicio || row.servicio || ""),
    professional: cleanText(row.Profesional || row.profesional || ""),
    source: row.__source || "",
  };
}

function parseGestationalAge(text) {
  const match = String(text || "").match(/Edad\s*Gestacional\s*:?\s*(\d{1,2})(?:[,.](\d{1,2}))?/i);
  if (!match) return null;
  const weeks = Number(match[1]);
  const fraction = match[2] ? Number(`0.${match[2]}`) : 0;
  return Number.isFinite(weeks) ? weeks + fraction : null;
}

function hasClapEvidence(row) {
  return String(row.evolution || "").includes("EXAMEN FISICO:");
}

function isPrenatalControl(row, rules = DEFAULT_RULES) {
  const validCode = [rules.rismi.firstControl, rules.rismi.followUpControl].includes(row.code);
  return validCode && hasClapEvidence(row) && Boolean(row.diagnosis);
}

function isCorrectable1095(row, rules = DEFAULT_RULES) {
  return row.code === rules.rismi.gynecology && hasClapEvidence(row);
}

function formatDate(date) {
  if (!date) return "Sin dato";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatGestAge(value) {
  if (value == null || Number.isNaN(value)) return "Sin dato";
  return `${value.toFixed(1)} sem`;
}

function dateRangeForControl(range, fpp) {
  if (!fpp) return "Sin FPP";
  const start = new Date(fpp.getTime() - (40 - range.start) * 7 * MS_PER_DAY);
  const end = new Date(fpp.getTime() - (40 - range.end) * 7 * MS_PER_DAY);
  return `${formatDate(start)} - ${formatDate(end)}`;
}

function evaluateControls(rismiRows, sigepRows, currentEge, rules) {
  return rules.controlRanges.map((range) => {
    const reached = currentEge == null ? false : currentEge >= range.start;
    const rismiMatches = rismiRows.filter((row) => inRange(row.gestAge, range) && (isPrenatalControl(row, rules) || isCorrectable1095(row, rules)));
    const sigepMatches = sigepRows.filter((row) => [rules.sigep.firstControl, rules.sigep.followUpControl].includes(row.code));
    const sigepInRange = sigepMatches.filter((row) => currentEge == null || !row.gestAge || inRange(row.gestAge, range));
    const correctable = rismiMatches.some((row) => isCorrectable1095(row, rules));

    let state = "wait";
    if (reached && (rismiMatches.length || sigepInRange.length)) state = correctable ? "correctable" : "complete";
    if (reached && !rismiMatches.length && !sigepInRange.length) state = currentEge <= range.end ? "alert" : "missing";

    return {
      ...range,
      reached,
      state,
      rismiRows: rismiMatches,
      sigepRows: sigepInRange,
      needsSigep: rismiMatches.length > 0 && sigepInRange.length === 0,
      correctable,
    };
  });
}

function evaluateComponents(rismiRows, sigepRows, currentEge, rules) {
  const specs = [
    {
      key: "ultrasounds",
      label: "Ecografías",
      required: rules.required.ultrasounds,
      rismiRows: rismiRows.filter((row) => row.code === rules.rismi.ultrasound),
      sigepRows: sigepRows.filter((row) => row.code === rules.sigep.ultrasound),
    },
    {
      key: "labs",
      label: "Laboratorios",
      required: rules.required.labs,
      rismiRows: [],
      sigepRows: sigepRows.filter((row) => row.code.startsWith(rules.sigep.labPrefix)),
    },
    {
      key: "vaccines",
      label: "Vacunas",
      required: rules.required.vaccines,
      rismiRows: rismiRows.filter((row) => rules.rismi.vaccines.includes(row.code)),
      sigepRows: sigepRows.filter((row) => rules.sigep.vaccines.includes(row.code)),
    },
    {
      key: "pap",
      label: "PAP",
      required: rules.required.pap,
      rismiRows: [],
      sigepRows: sigepRows.filter((row) => row.code === rules.sigep.pap),
    },
  ];

  return specs.map((spec) => {
    const count = Math.max(spec.rismiRows.length, spec.sigepRows.length);
    const sigepCount = spec.sigepRows.length;
    const reached = currentEge == null ? false : currentEge >= 20;
    let state = "wait";
    if (sigepCount >= spec.required) state = "complete";
    else if (reached && count > 0) state = "partial";
    else if (reached) state = "missing";
    return { ...spec, count, sigepCount, state, reached, needsSigep: spec.rismiRows.length > sigepCount };
  });
}

function evaluateAdministrativeState(rismiRows, sigepRows, controls, components, rules) {
  const correctableRows = rismiRows.filter((row) => isCorrectable1095(row, rules));
  const needsSigep = controls.some((control) => control.needsSigep) || components.some((component) => component.needsSigep);
  const missingDom = sigepRows.length === 0;
  return {
    validated: sigepRows.length > 0 && !needsSigep && !correctableRows.length,
    missingInSigep: needsSigep,
    correctableRows,
    needsReview: missingDom || correctableRows.length > 0,
    missingDom,
  };
}

function classifyCompliance(controls, components, currentEge) {
  if (currentEge == null) return "Alerta";
  const reachedControls = controls.filter((control) => control.reached);
  const hasCurrentAlert = controls.some((control) => control.state === "alert");
  const hasMissing = reachedControls.some((control) => ["missing", "alert"].includes(control.state)) || components.some((component) => component.state === "missing");
  const hasPartial = components.some((component) => component.state === "partial") || controls.some((control) => control.state === "correctable");
  const allControlsComplete = controls.every((control) => control.state === "complete" || control.state === "correctable");
  const allComponentsComplete = components.every((component) => component.state === "complete");

  if (hasCurrentAlert) return "Alerta";
  if (allControlsComplete && allComponentsComplete) return "Cumplimiento total";
  if (hasMissing || hasPartial) return "Cumplimiento parcial";
  return "En seguimiento de cumplimiento";
}

function buildActions(status, admin, controls, components, hasDom) {
  const actions = [];
  if (!hasDom) actions.push("Descargar DOM SIGEP");
  if (admin.correctableRows.length) actions.push("Corregir código RISMI");
  if (admin.missingInSigep) actions.push("Falta cargar en SIGEP");
  if (controls.some((control) => ["missing", "alert"].includes(control.state)) || components.some((component) => component.state === "missing")) actions.push("Prestación faltante");
  if (status === "En seguimiento de cumplimiento") actions.push("Aún no corresponde");
  if (status === "Cumplimiento total" && admin.validated) actions.push("Validado RISMI/SIGEP");
  return actions;
}

function estimateFpp(rows) {
  const candidates = rows
    .filter((row) => row.date && row.gestAge != null)
    .map((row) => new Date(row.date.getTime() + (40 - row.gestAge) * 7 * MS_PER_DAY));
  if (!candidates.length) return null;
  candidates.sort((a, b) => a - b);
  return candidates[Math.floor(candidates.length / 2)];
}

function hasPregnancyEvidence(row, rules) {
  if ([rules.rismi.firstControl, rules.rismi.followUpControl, rules.rismi.earlyCapture, rules.rismi.ultrasound].includes(row.code)) return true;
  if (isCorrectable1095(row, rules)) return true;
  if (row.gestAge != null) return true;
  return /CONTROL\s+PRENATAL/i.test(`${row.diagnosis} ${row.evolution}`);
}

function pickPatient(rows) {
  const withName = rows.find((row) => row.patientName) || rows[0] || {};
  return {
    name: withName.patientName || "Sin nombre",
    id: withName.patientId || "",
    birthDate: withName.birthDate || null,
    service: withName.service || "",
    professional: withName.professional || "",
  };
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + value * MS_PER_DAY);
  }
  const text = String(value).trim();
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function valueToText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function cleanText(value) {
  return valueToText(value).replace(/\s+/g, " ");
}

function onlyDigits(value) {
  return valueToText(value).replace(/\D+/g, "");
}

function groupBy(values, getter) {
  const map = new Map();
  for (const value of values) {
    const key = getter(value);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
  return map;
}

function maxDate(dates) {
  const valid = dates.filter(Boolean).sort((a, b) => b - a);
  return valid[0] || null;
}

function daysBetween(a, b) {
  return Math.round((b - a) / MS_PER_DAY);
}

function inRange(value, range) {
  return value != null && value >= range.start && value <= range.end;
}

function gestAgeForDate(date, fpp) {
  if (!date || !fpp) return null;
  return (40 * 7 - daysBetween(date, fpp)) / 7;
}

function byDateAsc(a, b) {
  return (a.date || 0) - (b.date || 0);
}

function compareEpisodePriority(a, b) {
  const priority = {
    Alerta: 0,
    "Cumplimiento parcial": 1,
    "En seguimiento de cumplimiento": 2,
    "Cumplimiento total": 3,
  };
  return (priority[a.status] ?? 9) - (priority[b.status] ?? 9) || (b.lastDate || 0) - (a.lastDate || 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

window.Prenatal = {
  DEFAULT_RULES,
  buildEpisodes,
  dateRangeForControl,
  formatDate,
  formatGestAge,
  hasClapEvidence,
  isCorrectable1095,
  isPrenatalControl,
  normalizeRismiRow,
  normalizeRismiRows,
  parseGestationalAge,
};
