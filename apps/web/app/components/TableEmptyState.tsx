"use client";

interface TableEmptyStateProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function TableEmptyState({ message, actionLabel, onAction }: TableEmptyStateProps) {
  return (
    <div className="empty-state" style={{ textAlign: "left" }}>
      <div>{message}</div>
      {actionLabel && onAction ? (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="button-outline" onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
