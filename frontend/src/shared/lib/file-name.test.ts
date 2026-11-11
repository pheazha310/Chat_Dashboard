import { describe, expect, it } from "vitest";
import { fileExtension, repairFileName } from "./file-name";

const garble = (text: string) => String.fromCharCode(...new TextEncoder().encode(text));

describe("repairFileName", () => {
  it("restores UTF-8 names that were read as Latin-1", () => {
    for (const name of ["📦 Day 1 – 10 Questions (1).pdf", "ឯកសារ.pdf", "café.pdf"]) {
      expect(repairFileName(garble(name))).toBe(name);
    }
  });

  it("leaves correct names alone", () => {
    for (const name of ["scan.png", "📦 Day 1.pdf", "ឯកសារ.pdf", "Ünïcode ok.pdf", "résumé.pdf"]) {
      expect(repairFileName(name)).toBe(name);
    }
  });
});

describe("fileExtension", () => {
  it("returns the upper-case extension or FILE", () => {
    expect(fileExtension("a.b.pdf")).toBe("PDF");
    expect(fileExtension("README")).toBe("FILE");
  });
});
