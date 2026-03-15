"use client";

type SortDir = "asc" | "desc";

interface ColumnHeaderSortProps {
  label: string;
  column: string;
  sortBy?: string;
  sortDir?: SortDir;
  onToggle: (column: string) => void;
  title?: string;
}

export default function ColumnHeaderSort({
  label,
  column,
  sortBy,
  sortDir,
  onToggle,
  title,
}: ColumnHeaderSortProps) {
  const active = sortBy === column;
  const arrow = active ? (sortDir === "asc" ? "▲" : "▼") : "↕";
  return (
    <button
      type="button"
      className="table-sort-button"
      onClick={() => onToggle(column)}
      title={title || label}
      aria-label={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span className="muted" style={{ fontSize: 11 }}>{arrow}</span>
    </button>
  );
}
