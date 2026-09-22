"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import TableEmptyState from "../../components/TableEmptyState";

// Deuda registrada del Clerk de Miami-Dade. SOLO INFORMATIVA (decision de JR, 22-sep-2026):
// se muestra aca y no entra al triage, al lane, a la accion recomendada ni al score.

type MortgageStatus = "RELEASED" | "PREDATES_TRANSFER" | "EXPIRED" | "LIKELY_OUTSTANDING" | "UNKNOWN";

interface RecordedMortgage {
  cfn: string;
  recordedOn: string | null;
  amount: number;
  status: MortgageStatus;
  reason: string;
  parties: string[];
}

interface RecordedDebtDocument {
  cfn: string;
  docType: string;
  recordedOn: string | null;
  amount: number;
  parties: string[];
  released: boolean;
}

interface RecordedDebtSnapshot {
  folio: string;
  outcome: "RECORDS_FOUND" | "NO_RECORDS";
  queriedAt: string | null;
  documentCount: number;
  likelyOutstandingDebt: number;
  recordedDebtCeiling: number;
  mortgages: RecordedMortgage[];
  otherDebtDocuments: RecordedDebtDocument[];
  lastTransfer: { cfn: string; recordedOn: string | null; docType: string; price: number } | null;
  lastPurchaseWithoutLaterMortgage: boolean;
  titleCertificates: string[];
  liens: {
    total: number;
    releasedInIndex: number;
    last24Months: number;
    lastRecordedOn: string | null;
    frequentParties: Array<{ name: string; count: number }>;
  };
}

type RecordedDebtResponse =
  | { available: false; informationalOnly: true; folio: string | null; reason: string }
  | { available: true; informationalOnly: true; folio: string; importedAt: string; snapshot: RecordedDebtSnapshot };

const STATUS_LABEL: Record<MortgageStatus, string> = {
  RELEASED: "Cancelada",
  PREDATES_TRANSFER: "Anterior a un traspaso",
  EXPIRED: "Vencida (más de 30 años)",
  LIKELY_OUTSTANDING: "Vigente probable",
  UNKNOWN: "Sin clasificar",
};

const DOC_TYPE_LABEL: Record<string, string> = {
  MOR: "Hipoteca",
  MTG: "Hipoteca",
  LIS: "Lis pendens",
  JUD: "Sentencia",
  AGR: "Acuerdo",
  LIE: "Gravamen",
  DEE: "Escritura",
  WD: "Escritura de garantía",
  QCD: "Quitclaim",
  SPD: "Escritura especial",
  CTI: "Certificado de título",
};

function money(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Sin dato";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

/** "2026-07-23" -> "23/07/2026". */
function day(value?: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "Sin fecha";
}

/** "2026-500415" -> "2026R0500415", el numero con que el Clerk identifica el documento. */
function cfn(value: string) {
  const match = /^(\d{4})-(\d{1,7})$/.exec(value.trim());
  return match ? `${match[1]}R${match[2].padStart(7, "0")}` : value;
}

/** El motivo viene del script con codigo de documento, fechas ISO y CFN con guion: se pasa al formato de la ficha. */
function reasonText(value: string) {
  return value
    .replace(/^([A-Z]{2,6}) /, (match, code: string) => (DOC_TYPE_LABEL[code] ? `${DOC_TYPE_LABEL[code]} ` : match))
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3/$2/$1")
    .replace(/\b(\d{4})-(\d{1,7})\b/g, (_match, year: string, seq: string) => `${year}R${seq.padStart(7, "0")}`);
}

function docType(value: string) {
  return DOC_TYPE_LABEL[value] ?? value;
}

function newestFirst<T extends { recordedOn: string | null }>(items: T[]) {
  return [...items].sort((a, b) => {
    if (!a.recordedOn && !b.recordedOn) return 0;
    if (!a.recordedOn) return 1;
    if (!b.recordedOn) return -1;
    return b.recordedOn.localeCompare(a.recordedOn);
  });
}

export default function RecordedDebtSection({ dealId }: { dealId: string }) {
  const [data, setData] = useState<RecordedDebtResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await apiFetch<RecordedDebtResponse>(`/deals/${dealId}/recorded-debt`));
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Error al leer la deuda registrada");
    }
  }, [dealId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const header = (
    <div className="actions-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
      <h3 className="section-title" style={{ margin: 0 }}>Deuda registrada (Clerk Miami-Dade)</h3>
      <span className="badge badge-muted">Solo informativo</span>
    </div>
  );

  if (error) {
    return (
      <section className="card detail-section">
        {header}
        <TableEmptyState
          message={`No se pudo leer la deuda registrada: ${error}`}
          actionLabel="Reintentar"
          onAction={() => load().catch(() => undefined)}
        />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="card detail-section">
        {header}
        <p className="muted">Cargando deuda registrada...</p>
      </section>
    );
  }

  if (!data.available) {
    return (
      <section className="card detail-section">
        {header}
        <TableEmptyState message={`${data.reason} Se trae con consultar.py y el sync de miami-dade-clerk en Integraciones.`} />
      </section>
    );
  }

  const snap = data.snapshot;
  const importedOn = new Date(data.importedAt).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const footer = (
    <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
      Folio {snap.folio} · consultado al Clerk el {day(snap.queriedAt)} · importado el {importedOn} · no cambia el lane, la
      acción, la etapa ni el score.
    </p>
  );

  if (snap.outcome === "NO_RECORDS") {
    return (
      <section className="card detail-section">
        {header}
        <TableEmptyState message="El índice por folio del Clerk no tiene documentos para este folio. No prueba que no haya deuda: el índice es incompleto." />
        {footer}
      </section>
    );
  }

  const mortgages = newestFirst(snap.mortgages);
  const likely = snap.mortgages.filter((item) => item.status === "LIKELY_OUTSTANDING");
  const others = newestFirst(snap.otherDebtDocuments);
  const transfer = snap.lastTransfer;

  return (
    <section className="card detail-section">
      {header}

      <div className="detail-grid">
        <div className="detail-card">
          <div className="stat-label">Deuda vigente probable</div>
          <div className="stat-value">{money(snap.likelyOutstandingDebt)}</div>
        </div>
        <div className="detail-card">
          <div className="stat-label">Hipotecas sin cancelación en el índice</div>
          <div className="stat-value">{money(snap.recordedDebtCeiling)}</div>
        </div>
        <div className="detail-card">
          <div className="stat-label">Hipotecas en el índice</div>
          <div className="stat-value">
            {snap.mortgages.length} ({likely.length} vigente{likely.length === 1 ? "" : "s"} probable{likely.length === 1 ? "" : "s"})
          </div>
        </div>
        <div className="detail-card">
          <div className="stat-label">Último traspaso real</div>
          <div className="stat-value">
            {transfer
              ? `${day(transfer.recordedOn)} · ${docType(transfer.docType)}${transfer.price > 0 ? ` · ${money(transfer.price)}` : ""}`
              : "Ninguno en el índice"}
          </div>
        </div>
        <div className="detail-card">
          <div className="stat-label">Gravámenes</div>
          <div className="stat-value">
            {snap.liens.total} ({snap.liens.last24Months} en 24 meses)
          </div>
        </div>
        <div className="detail-card">
          <div className="stat-label">Documentos en el índice</div>
          <div className="stat-value">{snap.documentCount}</div>
        </div>
      </div>

      {mortgages.length ? (
        <div className="table-wrap">
          <table className="table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>CFN</th>
                <th>Monto</th>
                <th>Estado</th>
                <th>Motivo</th>
                <th>Partes</th>
              </tr>
            </thead>
            <tbody>
              {mortgages.map((item) => (
                <tr key={`mortgage-${item.cfn}`}>
                  <td>{day(item.recordedOn)}</td>
                  <td>{cfn(item.cfn)}</td>
                  <td>{money(item.amount)}</td>
                  <td>
                    <span className={item.status === "LIKELY_OUTSTANDING" ? "badge badge-warning" : "badge badge-muted"}>
                      {STATUS_LABEL[item.status] ?? item.status}
                    </span>
                  </td>
                  <td>{item.reason ? reasonText(item.reason) : ""}</td>
                  <td>{item.parties.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <TableEmptyState message="El índice por folio no trae hipotecas para este folio. Puede haber hipotecas no indexadas." />
      )}

      {others.length > 0 && (
        <div className="table-wrap">
          <table className="table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>CFN</th>
                <th>Monto</th>
                <th>Partes</th>
                <th>Cancelado</th>
              </tr>
            </thead>
            <tbody>
              {others.map((item) => (
                <tr key={`doc-${item.cfn}`}>
                  <td>{day(item.recordedOn)}</td>
                  <td>{docType(item.docType)}</td>
                  <td>{cfn(item.cfn)}</td>
                  <td>{item.amount > 0 ? money(item.amount) : "Sin dato"}</td>
                  <td>{item.parties.join(" · ")}</td>
                  <td>{item.released ? "Sí" : "No en el índice"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="empty-state" style={{ marginTop: 12, textAlign: "left" }}>
        {snap.liens.total > 0 && (
          <div style={{ marginBottom: 6 }}>
            <strong>Gravámenes:</strong> el último es del {day(snap.liens.lastRecordedOn)}; {snap.liens.releasedInIndex} liberado
            {snap.liens.releasedInIndex === 1 ? "" : "s"} en el índice.
            {snap.liens.frequentParties.length > 0 &&
              ` Partes que más aparecen (incluye al dueño): ${snap.liens.frequentParties
                .map((item) => `${item.name} (${item.count})`)
                .join(", ")}.`}{" "}
            La API no informa sus montos.
          </div>
        )}
        {snap.titleCertificates.length > 0 && (
          <div style={{ marginBottom: 6 }}>
            <strong>Certificados de título:</strong> {snap.titleCertificates.map((item) => day(item)).join(", ")}. Un
            certificado de título indica una venta judicial.
          </div>
        )}
        {snap.lastPurchaseWithoutLaterMortgage && (
          <div style={{ marginBottom: 6 }}>
            <strong>Última compra sin hipoteca posterior en el índice:</strong> pudo ser cash, o la hipoteca no está
            indexada.
          </div>
        )}
        <div>
          <strong>Cómo leer esto:</strong> el índice por folio casi nunca trae las cancelaciones de hipoteca y a veces
          tampoco trae hipotecas. Vigente probable es una hipoteca sin cancelación en el índice, posterior al último
          traspaso real y de menos de 30 años. Confirmar con un informe de título antes de decidir.
        </div>
      </div>

      {footer}
    </section>
  );
}
