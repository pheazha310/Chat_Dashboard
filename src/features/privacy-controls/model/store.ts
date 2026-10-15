import { create } from "zustand";

type PrivacyState = {
  readReceipts: boolean;
  secureUploads: boolean;
  setReadReceipts: (value: boolean) => void;
  setSecureUploads: (value: boolean) => void;
};

export const usePrivacyStore = create<PrivacyState>((set) => ({
  readReceipts: true,
  secureUploads: true,
  setReadReceipts: (readReceipts) => set({ readReceipts }),
  setSecureUploads: (secureUploads) => set({ secureUploads }),
}));
