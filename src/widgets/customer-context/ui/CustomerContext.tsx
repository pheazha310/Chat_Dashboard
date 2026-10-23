import { useSelectedConversation } from "@/entities/conversation";
import { MediaFilesPanel } from "@/features/share-files";
import { assets } from "@/shared/config";
import { Icon } from "@/shared/ui";

type ContextView = "media" | null;

export default function CustomerContext({
  open,
  view,
  onViewChange,
  onClose,
}: {
  open: boolean;
  view: ContextView;
  onViewChange: (view: ContextView) => void;
  onClose: () => void;
}) {
  const conversation = useSelectedConversation();
  if (!conversation) return <aside className="context-column" />;
  const { application, activity } = conversation;

  return (
    <aside className={`context-column ${open ? "panel-open" : ""} ${view ? "has-detail" : ""}`}>
      <button type="button" className="close-context" onClick={onClose} aria-label="Close customer details">
        ×
      </button>
      {view === "media" ? (
        <MediaFilesPanel customer={conversation.name} appId={application.appId} onBack={() => onViewChange(null)} />
      ) : (
        <>
          <div className="customer-card info-card">
            <div className="customer-name">
              <img src={conversation.avatar} alt="" />
              <div>
                <h3>{conversation.name}</h3>
                <p>
                  <Icon src={assets.icons.online} alt="" /> App ID: {application.appId}
                </p>
              </div>
            </div>
            <dl>
              <div>
                <dt>Product</dt>
                <dd>{application.product}</dd>
              </div>
              <div>
                <dt>Requested Amount</dt>
                <dd>{application.amount}</dd>
              </div>
              <div>
                <dt>Requested Tenor</dt>
                <dd>{application.tenor}</dd>
              </div>
              <div>
                <dt>Current Status</dt>
                <dd className="status-progress">{application.status}</dd>
              </div>
            </dl>
          </div>

          <section className="info-card history-card">
            <div className="card-heading">
              <h3>History & Activity</h3>
              <span>{activity.length} recent</span>
            </div>
            <div className="activity-list">
              {activity.map((item) => (
                <div className="activity" key={item.id}>
                  <span className={`activity-marker ${item.tone}`} aria-hidden="true" />
                  <div>
                    <div>
                      <strong>{item.title}</strong>
                      <time>{item.time}</time>
                    </div>
                    <p>{item.copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="info-card summary-card">
            <div className="card-heading">
              <h3>AI Summary</h3>
              <span>Generated</span>
            </div>
            <p>{conversation.summary}</p>
          </section>
        </>
      )}
    </aside>
  );
}
