import { Pencil, Plus, Trash2 } from "lucide-react";

export default function AdminPanel({
  title,
  items,
  selectedId,
  onSelect,
  onAdd,
  onEdit,
  onDelete,
  nameKey = "name",
  idKey = "id",
  emptyText = "Nothing here yet.",
  disabled = false
}) {
  return (
    <article className="card admin-card">
      <div className="card-header">
        <h2 className="card-title">{title}</h2>
        <button type="button" className="btn btn-primary" onClick={onAdd} disabled={disabled}>
          <Plus size={18} />
          Add
        </button>
      </div>
      <div className="card-body">
        {items.length === 0 ? (
          <div className="empty-state">{emptyText}</div>
        ) : (
          <ul className="admin-list">
            {items.map((item) => {
              const id = item[idKey];
              const label = item[nameKey];
              const sel = selectedId === id;
              return (
                <li
                  key={id}
                  className={sel ? "selected" : ""}
                  onClick={() => onSelect(id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span>{label}</span>
                  <div className="admin-actions">
                    <button
                      type="button"
                      className="btn-icon"
                      title="Edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(item);
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(item);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </article>
  );
}
