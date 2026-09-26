import { describe, expect, it } from "vitest";
import { readImportedVault } from "./importedVault";

describe("browser file import", () => {
  it("preserves content and disambiguates filenames without modifying the originals", async () => {
    const selected = [
      new File(["---\ntags: [学习]\n---\n# 读书"], "读书.md", { lastModified: 1000 }),
      new File(["second document"], "读书.txt", { lastModified: 2000 })
    ];
    const vault = await readImportedVault(selected);
    expect(vault?.sourceKind).toBe("browser-import");
    expect(vault?.files.map((file) => file.path)).toEqual(["读书.md", "读书 (2).md"]);
    expect(vault?.files[0].content).toBe(await selected[0].text());
    expect(vault?.files[1].content).toBe("second document");
    expect(selected[1].name).toBe("读书.txt");
  });

  it("returns no replacement when the picker is cancelled", async () => {
    expect(await readImportedVault([])).toBeNull();
  });

  it("excludes sensitive paths before reading their content", async () => {
    const sensitive = new File(["secret"], "账号密码.md");
    sensitive.text = () => { throw new Error("must not read"); };
    const vault = await readImportedVault([sensitive, new File(["# Public"], "读书.md")]);
    expect(vault?.files).toHaveLength(1);
    expect(vault?.safetyManifest.excluded).toHaveLength(1);
    expect(vault?.unsupportedReason).toContain("排除 1");
  });

  it("rejects unsupported, binary, oversized and excessive selections before replacing the vault", async () => {
    await expect(readImportedVault([new File(["not a PDF"], "a.pdf")])).rejects.toThrow("支持 Markdown");
    await expect(readImportedVault([new File(["a\0b"], "a.md")])).rejects.toThrow("文本");
    await expect(readImportedVault([new File([new Uint8Array(2 * 1024 * 1024 + 1)], "a.md")])).rejects.toThrow("2 MB");
    await expect(readImportedVault(Array.from({ length: 51 }, () => new File(["a"], "a.md")))).rejects.toThrow("50");
    await expect(readImportedVault(Array.from({ length: 6 }, () => new File([new Uint8Array(2 * 1024 * 1024)], "a.md")))).rejects.toThrow("10 MB");
  });
});
