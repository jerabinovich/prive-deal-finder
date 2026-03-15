"use client";

import { ReactNode } from "react";

interface DataTableShellProps {
  title?: string;
  subtitle?: string;
  summary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export default function DataTableShell({ title, subtitle, summary, actions, children }: DataTableShellProps) {
  return (
    <section className="table-shell">
      {(title || subtitle || actions) && (
        <div className="page-header" style={{ marginBottom: 10 }}>
          <div>
            {title ? <h3 className="section-title" style={{ marginBottom: 0 }}>{title}</h3> : null}
            {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="actions-row">{actions}</div> : null}
        </div>
      )}
      {summary ? <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>{summary}</div> : null}
      <div className="table-wrap">{children}</div>
    </section>
  );
}
