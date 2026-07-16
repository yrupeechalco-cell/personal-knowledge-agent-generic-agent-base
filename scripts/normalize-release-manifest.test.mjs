import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeReleaseManifest } from "./normalize-release-manifest.mjs";

function manifest() {
  return {
    version: "0.2.4",
    platforms: {
      "windows-x86_64": { signature: "signed-one", url: "old" },
      "windows-x86_64-nsis": { signature: "signed-one", url: "old" }
    }
  };
}

test("normalizes every Windows platform to one exact installer URL", () => {
  const url = "https://github.com/example/project/releases/download/app-v0.2.4/Agent_0.2.4_x64-setup.exe";
  const normalized = normalizeReleaseManifest(manifest(), url);

  assert.equal(normalized.platforms["windows-x86_64"].url, url);
  assert.equal(normalized.platforms["windows-x86_64-nsis"].url, url);
});

test("rejects a URL formed by joining multiple installer names", () => {
  assert.throws(
    () => normalizeReleaseManifest(
      manifest(),
      "https://github.com/example/project/releases/download/app-v0.2.4/Agent_0.2.4_x64-setup.exe knowledge-agent_0.2.4_x64-setup.exe"
    ),
    /without whitespace/
  );
});

test("rejects unsigned platform entries", () => {
  const broken = manifest();
  broken.platforms["windows-x86_64"].signature = "";
  assert.throws(
    () => normalizeReleaseManifest(broken, "https://github.com/example/project/releases/download/app-v0.2.4/Agent_0.2.4_x64-setup.exe"),
    /without a signature/
  );
});
