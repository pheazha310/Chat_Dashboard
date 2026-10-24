import { Icon } from "@/shared/ui";

type Props = {
  icon: string;
  title: string;
  description: string;
  enabled?: boolean;
  chevron?: string;
  onToggle?: () => void;
  onOpen?: () => void;
  last?: boolean;
};

export default function SettingsRow({
  icon,
  title,
  description,
  enabled,
  chevron,
  onToggle,
  onOpen,
  last = false,
}: Props) {
  return (
    <div className="settings-row-wrap">
      <button
        className="settings-row"
        onClick={onToggle ?? onOpen}
        {...(onToggle ? { role: "switch", "aria-checked": !!enabled } : {})}
      >
        <span className="settings-row-main">
          <Icon src={icon} alt="" />
          <span>
            <strong>{title}</strong>
            <small>{description}</small>
          </span>
        </span>
        {onToggle ? (
          enabled ? (
            <span className="figma-toggle">
              <i />
            </span>
          ) : (
            <span className="settings-toggle-off">
              <i />
            </span>
          )
        ) : (
          chevron && <Icon className="settings-chevron" src={chevron} alt="" />
        )}
      </button>
      {!last && <span className="settings-divider" role="separator" />}
    </div>
  );
}
