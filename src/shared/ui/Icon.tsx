import type { CSSProperties } from "react";
import { iconColors, svgIcons } from "./icons/registry";
import { materialIcons } from "./icons/material";

type IconProps = {
  src: string;
  size?: number;
  className?: string;
  alt?: string;
  style?: CSSProperties;
};

const iconId = (src: string) => /\/([0-9a-f]+)\.svg$/i.exec(src)?.[1];

// Material glyphs sit inside a padded 24px grid, so very small slots need a larger box to stay legible.
const MIN_GLYPH = 16;

/**
 * Renders an asset by id: Material Symbols where one replaces it, the inline SVG
 * component for shapes with no glyph (dividers, dots, pill groups), else a plain <img>.
 */
export default function Icon({ src, size, className, alt = "", style }: IconProps) {
  const id = iconId(src);
  const a11y = {
    "aria-hidden": alt ? undefined : true,
    role: alt ? "img" : undefined,
    "aria-label": alt || undefined,
  } as const;
  const mergedStyle: CSSProperties = { color: id ? iconColors[id] : undefined, ...style };

  const material = id ? materialIcons[id] : undefined;
  if (material) {
    const px = String(size ?? material.exact ? material.size : Math.max(material.size, MIN_GLYPH));
    return <material.Icon className={className} style={mergedStyle} width={px} height={px} {...a11y} />;
  }

  const Svg = id ? svgIcons[id] : undefined;
  if (Svg) {
    return <Svg className={className} style={mergedStyle} {...(size ? { width: size, height: size } : {})} {...a11y} />;
  }

  return <img className={className} src={src} alt={alt} width={size} height={size} style={style} />;
}
