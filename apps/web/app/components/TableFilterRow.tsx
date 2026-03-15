"use client";

import { ReactNode } from "react";

export default function TableFilterRow({ children }: { children: ReactNode }) {
  return <tr className="table-filter-row">{children}</tr>;
}
