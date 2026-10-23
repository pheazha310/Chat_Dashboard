import Icon from "./Icon";

export default function AssetIcon({ src, size = 20 }: { src: string; size?: number }) {
  return <Icon className="asset-icon" src={src} size={size} />;
}
