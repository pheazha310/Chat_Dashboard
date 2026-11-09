import { create } from "zustand";
import { listAttachments } from "@/shared/api/rest";
import { API_URL } from "@/shared/config";
import { formatBytes } from "@/shared/lib/format-size";

export type SharedFile = {
  id: number | string;
  name: string;
  kind: "Document" | "Image";
  size: string;
  added: string;
  /** Set for files from the server; the bytes need the bearer token. */
  downloadPath?: string;
};
export type MediaFilter = "All" | "Documents" | "Images";

type FilesState = {
  files: SharedFile[];
  filter: MediaFilter;
  loading: boolean;
  error: boolean;
  /** Replaces the list with the conversation's real files (real backend only). */
  load: (conversationId: string) => Promise<void>;
  setFilter: (filter: MediaFilter) => void;
  add: (file: File) => void;
};

export const useSharedFilesStore = create<FilesState>((set) => ({
  files: [
    {
      id: 1,
      name: "Bank_statement_May.pdf",
      kind: "Document",
      size: "1.8 MB",
      added: "Today, 09:06",
    },
    {
      id: 2,
      name: "Identity_verification.jpg",
      kind: "Image",
      size: "842 KB",
      added: "May 22, 16:42",
    },
    {
      id: 3,
      name: "Loan_agreement.pdf",
      kind: "Document",
      size: "620 KB",
      added: "May 22, 16:39",
    },
  ],
  filter: "All",
  loading: false,
  error: false,
  load: async (conversationId) => {
    if (!API_URL) return;
    set({ loading: true, error: false, files: [] });
    try {
      const items = await listAttachments(conversationId);
      set({
        loading: false,
        files: items.map((item) => ({
          id: item.id,
          name: item.fileName,
          kind: item.kind === "IMAGE" ? "Image" : "Document",
          size: formatBytes(item.fileSize),
          added: new Date(item.createdAt).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
          downloadPath: item.downloadPath,
        })),
      });
    } catch {
      set({ loading: false, error: true });
    }
  },
  setFilter: (filter) => set({ filter }),
  add: (file) =>
    set((state) => ({
      files: [
        {
          id: Date.now(),
          name: file.name,
          kind: file.type.startsWith("image/") ? "Image" : "Document",
          size: `${Math.max(1, Math.round(file.size / 1024))} KB`,
          added: "Just now",
        },
        ...state.files,
      ],
    })),
}));
