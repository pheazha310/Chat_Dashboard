import { useState } from "react";
import { MessageSettingsDialog } from "@/features/message-settings";
import { assets } from "@/shared/config";
import { AssetIcon, IconButton, notify } from "@/shared/ui";
import ApplicationsNav from "./ApplicationsNav";
import ApplicationsTable, { type ApplicationRow, type ApplicationStatus } from "./ApplicationsTable";
import ExpandedChat from "./ExpandedChat";
import ExpandedMessageList from "./ExpandedMessageList";

type StatusTab = "All Draft" | ApplicationStatus;

const statusTabs: [StatusTab, string, string][] = [
  ["All Draft", "119", assets.zoom.statusAll],
  ["New", "67", assets.zoom.statusNew],
  ["Reviewing", "1", assets.zoom.statusReviewing],
  ["Completed", "41", assets.zoom.statusCompleted],
  ["Failed", "10", assets.zoom.statusFailed],
  ["Paid Off", "429", assets.zoom.statusPaid],
];

const applicationRows: ApplicationRow[] = [
  { id: 1, status: "Reviewing", occupation: "Employee" },
  { id: 2, status: "Failed", occupation: "Employee" },
  { id: 3, status: "Failed", occupation: "Employee" },
  { id: 4, status: "Paid Off", occupation: "Employee" },
  { id: 5, status: "Completed", occupation: "Employee" },
  { id: 6, status: "Completed", occupation: "Employee" },
  { id: 7, status: "Completed", occupation: "Employee" },
  { id: 8, status: "New", occupation: "Employee" },
  { id: 9, status: "New", occupation: "Employee" },
  { id: 10, status: "New", occupation: "Employee" },
];

export default function ApplicationsWorkspace({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<StatusTab>("All Draft");
  const [tableQuery, setTableQuery] = useState("");
  const [chatOpen, setChatOpen] = useState(true);
  const [messageListOpen, setMessageListOpen] = useState(false);

  const rows = applicationRows.filter((row) => {
    const tabMatches = activeTab === "All Draft" || row.status === activeTab;
    return tabMatches && `CID-061829-C30 #61831 ${row.status}`.toLowerCase().includes(tableQuery.toLowerCase());
  });

  return (
    <main className="expanded-applications">
      <ApplicationsNav />

      <section className="applications-workspace">
        <header className="applications-topbar">
          <label>
            <AssetIcon src={assets.icons.search} size={16} />
            <input placeholder="Quick Search - Name, Number, Status, Cycle..." />
          </label>
          <div>
            <IconButton
              icon={assets.icons.message}
              label="Messages"
              onClick={() => {
                setChatOpen(false);
                setMessageListOpen(true);
              }}
            />
            <IconButton
              icon={assets.icons.bell}
              label="Notifications"
              onClick={() => notify("You have 3 new notifications")}
            />
            <img src={assets.users.currentUser} alt="" />
          </div>
        </header>

        <div className="applications-content">
          <div className="applications-title">
            <h1>Draft Applications</h1>
            <p>Review and manage draft loan applications before submission</p>
          </div>
          <div className="status-tabs">
            {statusTabs.map(([label, count, icon]) => (
              <button className={activeTab === label ? "active" : ""} onClick={() => setActiveTab(label)} key={label}>
                <img src={icon} alt="" />
                <span>{label}</span>
                <small>{count}</small>
                {label !== "Paid Off" && <span className="tab-chevron">⌄</span>}
              </button>
            ))}
          </div>

          <ApplicationsTable
            rows={rows}
            query={tableQuery}
            onQueryChange={setTableQuery}
            onOpenChat={() => setChatOpen(true)}
          />
        </div>
      </section>

      {chatOpen && (
        <ExpandedChat
          onBack={() => {
            setChatOpen(false);
            setMessageListOpen(true);
          }}
        />
      )}
      {messageListOpen && (
        <ExpandedMessageList
          onClose={onClose}
          onOpened={() => {
            setMessageListOpen(false);
            setChatOpen(true);
          }}
        />
      )}
      <button
        className="compose-fab"
        onClick={() => {
          setMessageListOpen(false);
          setChatOpen(true);
        }}
        aria-label="Open chat"
      >
        <AssetIcon src={assets.zoom.edit} size={22} />
      </button>
      <MessageSettingsDialog />
    </main>
  );
}
