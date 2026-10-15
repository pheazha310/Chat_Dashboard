import { create } from "zustand";

export type SharedFile = {
  id: number;
  name: string;
  kind: "Document" | "Image";
  size: string;
  added: string;
};
export type MediaFilter = "All" | "Documents" | "Images";

type FilesState = {
  files: SharedFile[];
  filter: MediaFilter;
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
