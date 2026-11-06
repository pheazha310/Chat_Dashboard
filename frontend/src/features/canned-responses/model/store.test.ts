import { beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({
  listTemplates: vi.fn(),
  createTemplateRequest: vi.fn(),
  updateTemplateRequest: vi.fn(),
  deactivateTemplateRequest: vi.fn(),
}));
const notify = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/rest", () => rest);
vi.mock("@/shared/ui", () => ({ notify }));

import {
  createTemplate,
  deactivateTemplate,
  loadTemplates,
  searchTemplates,
  updateTemplate,
  useTemplatesStore,
  type Template,
} from "./store";

const template = (id: string, title: string, patch: Partial<Template> = {}): Template => ({
  id,
  title,
  content: `${title} text`,
  shortcut: null,
  scope: "PERSONAL",
  createdBy: "me",
  isActive: true,
  permissions: { canEdit: true },
  ...patch,
});
const held = () => useTemplatesStore.getState().templates.map((t) => t.title);

beforeEach(() => {
  vi.clearAllMocks();
  useTemplatesStore.setState({ templates: [], status: "idle" });
});

describe("loading", () => {
  it("loads templates in title order", async () => {
    rest.listTemplates.mockResolvedValue([template("2", "Zeta"), template("1", "Alpha")]);
    await loadTemplates();
    expect(held()).toEqual(["Alpha", "Zeta"]);
    expect(useTemplatesStore.getState().status).toBe("ready");
  });

  it("flags a failed load", async () => {
    rest.listTemplates.mockRejectedValue(new Error("offline"));
    await loadTemplates();
    expect(useTemplatesStore.getState().status).toBe("error");
  });
});

describe("changes", () => {
  it("creates a personal or shared template with a trimmed shortcut, and keeps the list sorted", async () => {
    useTemplatesStore.setState({ templates: [template("1", "Mid")], status: "ready" });
    rest.createTemplateRequest.mockResolvedValue(template("2", "Alpha"));
    await expect(
      createTemplate({ title: " Alpha ", content: " text ", shortcut: " /a ", shared: false }),
    ).resolves.toBe(true);
    expect(rest.createTemplateRequest).toHaveBeenCalledWith({
      title: "Alpha",
      content: "text",
      shortcut: "/a",
      scope: "PERSONAL",
    });
    expect(held()).toEqual(["Alpha", "Mid"]);
    await createTemplate({ title: "S", content: "c", shortcut: " ", shared: true });
    expect(rest.createTemplateRequest).toHaveBeenLastCalledWith({ title: "S", content: "c", scope: "SHARED" });
  });

  it("explains a refusal and keeps the list", async () => {
    rest.createTemplateRequest.mockRejectedValue(new Error("The shortcut /a is already used by another template"));
    await expect(createTemplate({ title: "A", content: "c", shortcut: "/a", shared: false })).resolves.toBe(false);
    expect(notify).toHaveBeenCalledWith("The shortcut /a is already used by another template");
    expect(held()).toEqual([]);
  });

  it("replaces an edited template and drops a deactivated one only after the server confirms", async () => {
    useTemplatesStore.setState({ templates: [template("1", "A"), template("2", "B")], status: "ready" });
    rest.updateTemplateRequest.mockResolvedValue(template("1", "A2"));
    await updateTemplate("1", { title: "A2" });
    expect(held()).toEqual(["A2", "B"]);

    rest.deactivateTemplateRequest.mockRejectedValueOnce(new Error("no"));
    await deactivateTemplate("2");
    expect(held()).toEqual(["A2", "B"]);
    rest.deactivateTemplateRequest.mockResolvedValueOnce({});
    await deactivateTemplate("2");
    expect(held()).toEqual(["A2"]);
  });
});

describe("searchTemplates", () => {
  const list = [
    template("1", "Greeting", { shortcut: "/hi" }),
    template("2", "Docs", { content: "Please send your SALARY slip" }),
  ];
  it("matches title, text and shortcut ignoring case", () => {
    expect(searchTemplates(list, "greet").map((t) => t.id)).toEqual(["1"]);
    expect(searchTemplates(list, "salary").map((t) => t.id)).toEqual(["2"]);
    expect(searchTemplates(list, "/HI").map((t) => t.id)).toEqual(["1"]);
    expect(searchTemplates(list, "  ")).toBe(list);
    expect(searchTemplates(list, "zzz")).toEqual([]);
  });
});
