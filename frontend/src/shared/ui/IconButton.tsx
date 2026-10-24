import AssetIcon from "./AssetIcon";

type Props = { icon: string; label: string; onClick?: () => void; size?: number; className?: string };

/** Icon-only button. `label` is required so the control always has an accessible name. */
export default function IconButton({ icon, label, onClick, size, className }: Props) {
  return (
    <button type="button" className={className} onClick={onClick} aria-label={label} title={label}>
      <AssetIcon src={icon} size={size} />
    </button>
  );
}
