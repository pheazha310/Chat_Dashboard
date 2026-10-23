// Material Symbols replacements for the glyph-style .svg assets, keyed by asset id.
import type { ComponentType, SVGProps } from "react";
import MSearch from "@iconify-react/material-symbols/search";
import MChatBubbleOutline from "@iconify-react/material-symbols/chat-bubble-outline";
import MNotificationsOutline from "@iconify-react/material-symbols/notifications-outline";
import MKeyboardArrowDown from "@iconify-react/material-symbols/keyboard-arrow-down";
import MCallOutline from "@iconify-react/material-symbols/call-outline";
import MMoreHoriz from "@iconify-react/material-symbols/more-horiz";
import MPhoneCallbackOutline from "@iconify-react/material-symbols/phone-callback-outline";
import MAdd from "@iconify-react/material-symbols/add";
import MMicOutline from "@iconify-react/material-symbols/mic-outline";
import MAttachFile from "@iconify-react/material-symbols/attach-file";
import MShieldOutline from "@iconify-react/material-symbols/shield-outline";
import MVolumeUpOutline from "@iconify-react/material-symbols/volume-up-outline";
import MLayersOutline from "@iconify-react/material-symbols/layers-outline";
import MAutoAwesomeOutline from "@iconify-react/material-symbols/auto-awesome-outline";
import MChatOutline from "@iconify-react/material-symbols/chat-outline";
import MArchiveOutline from "@iconify-react/material-symbols/archive-outline";
import MChevronRight from "@iconify-react/material-symbols/chevron-right";
import MSendOutline from "@iconify-react/material-symbols/send-outline";
import MPersonRemoveOutline from "@iconify-react/material-symbols/person-remove-outline";
import MRemove from "@iconify-react/material-symbols/remove";
import MHomeOutline from "@iconify-react/material-symbols/home-outline";
import MAssignmentOutline from "@iconify-react/material-symbols/assignment-outline";
import MVerifiedUserOutline from "@iconify-react/material-symbols/verified-user-outline";
import MAnalyticsOutline from "@iconify-react/material-symbols/analytics-outline";
import MPaymentsOutline from "@iconify-react/material-symbols/payments-outline";
import MBlock from "@iconify-react/material-symbols/block";
import MHelpOutline from "@iconify-react/material-symbols/help-outline";
import MAdminPanelSettingsOutline from "@iconify-react/material-symbols/admin-panel-settings-outline";
import MDownload from "@iconify-react/material-symbols/download";
import MSwapVert from "@iconify-react/material-symbols/swap-vert";
import MFilterAltOutline from "@iconify-react/material-symbols/filter-alt-outline";
import MDescriptionOutline from "@iconify-react/material-symbols/description-outline";
import MPersonAddOutline from "@iconify-react/material-symbols/person-add-outline";
import MAssignmentTurnedInOutline from "@iconify-react/material-symbols/assignment-turned-in-outline";
import MChevronLeft from "@iconify-react/material-symbols/chevron-left";
import MArrowBack from "@iconify-react/material-symbols/arrow-back";
import MEditOutline from "@iconify-react/material-symbols/edit-outline";
import MCircle from "@iconify-react/material-symbols/circle";

export type MaterialIcon = ComponentType<SVGProps<SVGSVGElement> & { width?: string; height?: string }>;

export const materialIcons: Record<string, { Icon: MaterialIcon; size: number; exact?: boolean }> = {
  "3bde3": { Icon: MSearch, size: 16 },
  "5397a": { Icon: MChatBubbleOutline, size: 20 },
  "882ce": { Icon: MNotificationsOutline, size: 20 },
  "3add6": { Icon: MKeyboardArrowDown, size: 8 },
  "f8295": { Icon: MSearch, size: 24 },
  "a52ea": { Icon: MCallOutline, size: 20 },
  "28eac": { Icon: MMoreHoriz, size: 16 },
  "ce10c": { Icon: MPhoneCallbackOutline, size: 14 },
  "c9789": { Icon: MAdd, size: 20 },
  "786a3": { Icon: MMicOutline, size: 18 },
  "f0c3a": { Icon: MAttachFile, size: 20 },
  "7b9b3": { Icon: MShieldOutline, size: 20 },
  "fc7be": { Icon: MCallOutline, size: 20 },
  "48f72": { Icon: MVolumeUpOutline, size: 20 },
  "19fa8": { Icon: MLayersOutline, size: 20 },
  "26012": { Icon: MAutoAwesomeOutline, size: 20 },
  "b0d3c": { Icon: MChatOutline, size: 20 },
  "8cba4": { Icon: MArchiveOutline, size: 20 },
  "aba08": { Icon: MChevronRight, size: 14 },
  "95915": { Icon: MSendOutline, size: 20 },
  "27a6f": { Icon: MChevronRight, size: 14 },
  "21ab4": { Icon: MPersonRemoveOutline, size: 20 },
  "b5104": { Icon: MRemove, size: 20 },
  "7bae6": { Icon: MHomeOutline, size: 20 },
  "962e0": { Icon: MAssignmentOutline, size: 20 },
  "69b92": { Icon: MVerifiedUserOutline, size: 20 },
  "9302f": { Icon: MAnalyticsOutline, size: 20 },
  "c3d93": { Icon: MPaymentsOutline, size: 20 },
  "76535": { Icon: MBlock, size: 20 },
  "ff060": { Icon: MHelpOutline, size: 20 },
  "df6a6": { Icon: MAdminPanelSettingsOutline, size: 20 },
  "d5828": { Icon: MKeyboardArrowDown, size: 16 },
  "fa7f5": { Icon: MSearch, size: 14 },
  "42b2c": { Icon: MDownload, size: 14 },
  "1d28e": { Icon: MSwapVert, size: 14 },
  "79205": { Icon: MSwapVert, size: 14 },
  "427b7": { Icon: MFilterAltOutline, size: 14 },
  "fe7f4": { Icon: MDescriptionOutline, size: 16 },
  "e9c82": { Icon: MChatBubbleOutline, size: 16 },
  "0d31e": { Icon: MPersonAddOutline, size: 16 },
  "6f355": { Icon: MAssignmentTurnedInOutline, size: 16 },
  "badbe": { Icon: MChatOutline, size: 16 },
  "7bf06": { Icon: MNotificationsOutline, size: 16 },
  "3a4e8": { Icon: MChevronLeft, size: 12 },
  "70555": { Icon: MChevronRight, size: 12 },
  "b2b06": { Icon: MArrowBack, size: 16 },
  "6e507": { Icon: MEditOutline, size: 22 },
  "04682": { Icon: MCircle, size: 9, exact: true },
  "21708": { Icon: MCircle, size: 12, exact: true },
  "32682": { Icon: MCircle, size: 9, exact: true },
  "3a5de": { Icon: MCircle, size: 9, exact: true },
  "3ebb0": { Icon: MCircle, size: 18, exact: true },
  "4255c": { Icon: MCircle, size: 9, exact: true },
  "43747": { Icon: MCircle, size: 12, exact: true },
  "48843": { Icon: MCircle, size: 12, exact: true },
  "5beb6": { Icon: MCircle, size: 12, exact: true },
  "5e44b": { Icon: MCircle, size: 9, exact: true },
  "62999": { Icon: MCircle, size: 9, exact: true },
  "86225": { Icon: MCircle, size: 9, exact: true },
  "8faa7": { Icon: MCircle, size: 12, exact: true },
  "b8845": { Icon: MCircle, size: 12, exact: true },
  "bfceb": { Icon: MCircle, size: 9, exact: true },
  "f6e52": { Icon: MCircle, size: 9, exact: true },
};
