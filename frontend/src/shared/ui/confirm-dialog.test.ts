import { beforeEach, describe, expect, it } from "vitest";
import { confirmAction, promptAction, useConfirmStore } from "./confirm-dialog";

describe("promptAction", () => {
  beforeEach(() => useConfirmStore.setState({ request: null }));

  it("opens a request with a text field and resolves the typed text", async () => {
    const result = promptAction({ title: "Why?", inputLabel: "Reason" });
    expect(useConfirmStore.getState().request?.input).toMatchObject({ label: "Reason" });
    useConfirmStore.getState().settle(true, "  spam links ");
    await expect(result).resolves.toBe("spam links");
  });

  it("resolves null when cancelled", async () => {
    const result = promptAction({ title: "Why?", inputLabel: "Reason" });
    useConfirmStore.getState().settle(false, "typed");
    await expect(result).resolves.toBeNull();
  });
});

describe("confirmAction", () => {
  beforeEach(() => useConfirmStore.setState({ request: null }));

  it("opens a request with the given text", () => {
    void confirmAction({ title: "Delete this message?", confirmLabel: "Delete" });
    expect(useConfirmStore.getState().request).toMatchObject({ title: "Delete this message?", confirmLabel: "Delete" });
  });

  it("resolves true when confirmed and closes", async () => {
    const result = confirmAction({ title: "Delete?" });
    useConfirmStore.getState().settle(true);
    await expect(result).resolves.toBe(true);
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it("resolves false when cancelled", async () => {
    const result = confirmAction({ title: "Delete?" });
    useConfirmStore.getState().settle(false);
    await expect(result).resolves.toBe(false);
  });

  it("cancels a pending request when a new one opens", async () => {
    const first = confirmAction({ title: "First" });
    void confirmAction({ title: "Second" });
    await expect(first).resolves.toBe(false);
    expect(useConfirmStore.getState().request?.title).toBe("Second");
  });
});
