import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { uploadFile } from "../upload.middleware.js";

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function upload(fileName: string): Promise<string> {
  const app = express();
  app.post("/", uploadFile, (req, res) => {
    res.json({ name: req.file?.originalname });
  });
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;

  const form = new FormData();
  form.append("file", new Blob(["%PDF-1.7"], { type: "application/pdf" }), fileName);
  const response = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: form });
  return ((await response.json()) as { name: string }).name;
}

describe("uploadFile", () => {
  it("keeps non-ASCII file names (emoji, dashes, Khmer) intact", async () => {
    expect(await upload("📦 Day 1 – 10 Questions (1).pdf")).toBe("📦 Day 1 – 10 Questions (1).pdf");
    expect(await upload("ឯកសារ.pdf")).toBe("ឯកសារ.pdf");
  });
});
