import { assets } from "@/shared/config";
import { AssetIcon, IconButton, notify, Icon } from "@/shared/ui";

export type ApplicationStatus = "New" | "Reviewing" | "Completed" | "Failed" | "Paid Off";
export type ApplicationRow = { id: number; status: ApplicationStatus; occupation: string };

const STATUS_CLASS: Record<ApplicationStatus, string> = {
  New: "new",
  Reviewing: "reviewing",
  Completed: "completed",
  Failed: "failed",
  "Paid Off": "paid-off",
};

type Props = {
  rows: ApplicationRow[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpenChat: () => void;
};

export default function ApplicationsTable({ rows, query, onQueryChange, onOpenChat }: Props) {
  return (
    <section className="applications-table-card">
      <div className="table-toolbar">
        <label>
          <AssetIcon src={assets.zoom.tableSearch} size={14} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search" />
        </label>
        <div>
          <button onClick={() => notify("Column chooser opened")}>Column</button>
          <button onClick={() => notify("Application data exported")}>
            <AssetIcon src={assets.zoom.download} size={14} />
            Export
          </button>
          <button onClick={() => notify("Rows sorted by newest")}>
            <AssetIcon src={assets.zoom.sort} size={14} />
            Sort by
          </button>
          <button className="filter-button" onClick={() => notify("All filters opened")}>
            <AssetIcon src={assets.zoom.filter} size={14} />
            All Filter
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label="Select all applications" />
              </th>
              <th>CID-Cycle</th>
              <th>Registered Date</th>
              <th>Customer Name</th>
              <th>NID</th>
              <th>Phone Number</th>
              <th>Salary</th>
              <th>Loan Request</th>
              <th>Tenure</th>
              <th>Completeness</th>
              <th>Status</th>
              <th>Shortcuts</th>
              <th>Action</th>
              <th>
                Occupation <AssetIcon src={assets.zoom.sortSmall} size={14} />
              </th>
              <th>Blacklist</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <input type="checkbox" aria-label={`Select application ${row.id}`} />
                </td>
                <td>
                  <button className="cid-link" onClick={onOpenChat}>
                    CID-061829-C30
                  </button>
                </td>
                <td>05-Jun-26 13:03</td>
                <td>
                  <span className="customer-cell">
                    <img src={assets.zoom.customer} alt="" />
                    <button onClick={onOpenChat}>#61831</button>
                  </span>
                </td>
                <td>111111113</td>
                <td className="phone-cell">016111111</td>
                <td>
                  <strong>$10,008</strong>
                </td>
                <td>—</td>
                <td>—</td>
                <td>
                  <span className="completeness">
                    <b>D</b>
                    <b>P</b>
                    <b>O</b>
                    <b>R</b>
                    <i>L</i>
                  </span>
                </td>
                <td>
                  <StatusBadge status={row.status} />
                </td>
                <td>
                  <span className="row-actions">
                    <IconButton
                      icon={assets.zoom.file}
                      size={16}
                      label="Open application file"
                      onClick={() => notify("Application file opened")}
                    />
                    <IconButton icon={assets.zoom.rowMessage} size={16} label="Open chat" onClick={onOpenChat} />
                  </span>
                </td>
                <td>
                  <span className="row-actions four">
                    <IconButton
                      icon={assets.zoom.assign}
                      size={16}
                      label="Assign agent"
                      onClick={() => notify("Agent assigned")}
                    />
                    <IconButton
                      icon={assets.zoom.approve}
                      size={16}
                      label="Open checklist"
                      onClick={() => notify("Checklist opened")}
                    />
                    <IconButton
                      icon={assets.zoom.note}
                      size={16}
                      label="Add note"
                      onClick={() => notify("Note opened")}
                    />
                    <IconButton
                      icon={assets.zoom.reminder}
                      size={16}
                      label="Set reminder"
                      onClick={() => notify("Reminder set")}
                    />
                  </span>
                </td>
                <td>
                  <span className="occupation-badge">
                    <Icon src={assets.zoom.employee} alt="" />
                    {row.occupation}
                  </span>
                </td>
                <td>
                  <span className="safe-badge">
                    <Icon src={assets.zoom.safe} alt="" />
                    Not Listed
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="no-applications">No applications match this filter.</p>}
      </div>
      <footer className="table-pagination">
        <span>Showing 1-{rows.length} of 38 results</span>
        <div>
          <button>
            <AssetIcon src={assets.zoom.previous} size={12} />
            Previous
          </button>
          <button className="page-active">1</button>
          <button>2</button>
          <span>…</span>
          <button>4</button>
          <button>
            Next
            <AssetIcon src={assets.zoom.next} size={12} />
          </button>
        </div>
      </footer>
    </section>
  );
}

function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`application-status ${STATUS_CLASS[status]}`}>
      <i />
      {status}
    </span>
  );
}
