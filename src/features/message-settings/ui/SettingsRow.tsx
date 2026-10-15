import { assets } from "@/shared/config";

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
          <img src={icon} alt="" />
          <span>
            <strong>{title}</strong>
            <small>{description}</small>
          </span>
        </span>
        {onToggle ? (
          enabled ? (
            <img className="figma-toggle" src={assets.settings.toggle} alt="" />
          ) : (
            <span className="settings-toggle-off">
              <i />
            </span>
          )
        ) : (
          chevron && <img className="settings-chevron" src={chevron} alt="" />
        )}
      </button>
      {!last && <img className="settings-divider" src={assets.settings.divider} alt="" />}
    </div>
  );
}
