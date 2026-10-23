import MoreHoriz from "@iconify-react/material-symbols/more-horiz";
import ZoomInMap from "@iconify-react/material-symbols/zoom-in-map";
import CallOutline from "@iconify-react/material-symbols/call-outline";

const GLYPHS = { more: MoreHoriz, collapse: ZoomInMap, call: CallOutline } as const;

type IconPillProps = {
  left: keyof typeof GLYPHS;
  right: keyof typeof GLYPHS;
  className?: string;
};

/** Decorative two-icon pill; hit-target buttons are layered on top by the caller. */
export default function IconPill({ left, right, className = "" }: IconPillProps) {
  const Left = GLYPHS[left];
  const Right = GLYPHS[right];
  return (
    <span className={`icon-pill ${className}`.trim()} aria-hidden="true">
      <Left width="20" height="20" />
      <Right width="20" height="20" />
    </span>
  );
}
