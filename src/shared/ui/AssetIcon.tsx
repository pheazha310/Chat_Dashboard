export default function AssetIcon({ src, size = 20 }: { src: string; size?: number }) {
  return <img className="asset-icon" src={src} width={size} height={size} alt="" />;
}
