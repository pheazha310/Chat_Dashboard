import { beforeEach, describe, expect, it } from "vitest";
import { useSharedFilesStore } from "./store";

beforeEach(() => useSharedFilesStore.setState({ filter: "All" }));

describe("useSharedFilesStore", () => {
  it("adds an uploaded image first, classified as Image", () => {
    const file = new File([new Uint8Array(4096)], "id.png", { type: "image/png" });
    useSharedFilesStore.getState().add(file);
    expect(useSharedFilesStore.getState().files[0]).toMatchObject({ name: "id.png", kind: "Image", size: "4 KB" });
  });

  it("classifies non-images as Document and reports at least 1 KB", () => {
    useSharedFilesStore.getState().add(new File(["x"], "note.pdf", { type: "application/pdf" }));
    expect(useSharedFilesStore.getState().files[0]).toMatchObject({ kind: "Document", size: "1 KB" });
  });

  it("changes the filter", () => {
    useSharedFilesStore.getState().setFilter("Images");
    expect(useSharedFilesStore.getState().filter).toBe("Images");
  });
});
