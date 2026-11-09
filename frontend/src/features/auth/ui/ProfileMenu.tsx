import { useEffect, useRef, useState } from "react";
import { authRequired, useAuthStore } from "@/shared/api/auth";
import { assets } from "@/shared/config";
import { AssetIcon, notify } from "@/shared/ui";
import { submitSignOut } from "../model/sign-in";

/** The avatar button in the top bar. Signed in to the backend, it opens a menu with the account and "Sign out". */
export default function ProfileMenu() {
  const user = useAuthStore((state) => state.user);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="profile-menu" ref={ref}>
      <button
        className="profile-action"
        onClick={() => (authRequired ? setOpen((value) => !value) : notify("Agent profile opened"))}
        aria-label="Open profile"
        aria-haspopup={authRequired ? "menu" : undefined}
        aria-expanded={authRequired ? open : undefined}
        title={user?.displayName}
      >
        <img src={assets.users.currentUser} alt="" />
        <span>
          <AssetIcon src={assets.icons.chevron} size={8} />
        </span>
      </button>
      {open && user && (
        <div className="more-menu profile-menu-popover" role="menu">
          <div className="profile-menu-account">
            <strong>{user.displayName}</strong>
            {user.email && <small>{user.email}</small>}
            <small>{user.role.toLowerCase()}</small>
          </div>
          <button role="menuitem" onClick={() => void submitSignOut()}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
