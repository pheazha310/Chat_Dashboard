/**
 * Older uploads stored UTF-8 file names that had been read as Latin-1 ("ð\u009f\u0093¦ Day 1 â\u0080\u0093 …").
 * If every character fits in one byte and the bytes form valid UTF-8, the name was garbled that way: decode it again.
 * Names that are already correct (including real accented Latin text) fail the UTF-8 check and are returned as is.
 */
export function repairFileName(name: string): string {
  if (!/[\u0080-ÿ]/.test(name)) return name;
  const bytes = new Uint8Array(name.length);
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code > 0xff) return name;
    bytes[i] = code;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return name;
  }
}

/** "scan.final.pdf" -> "PDF"; a name without a dot -> "FILE". */
export function fileExtension(name: string): string {
  return name.includes(".") ? (name.split(".").pop() ?? "").toUpperCase() : "FILE";
}
