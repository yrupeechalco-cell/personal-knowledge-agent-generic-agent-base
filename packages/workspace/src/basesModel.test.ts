import { parseNote } from "@knowledge-agent/core";
import { describe, expect, it } from "vitest";
import {
  collectBasePropertyColumns,
  filterAndSortBaseNotes,
  normalizeBaseViewSettings
} from "./basesModel";

const notes = [
  parseNote({ path: "B.md", content: "---\nstatus: active\nscore: 2\n---\n# Beta\n#project" }),
  parseNote({ path: "A.md", content: "---\nstatus: draft\nscore: 10\n---\n# Alpha\n#study" })
];

describe("bases model", () => {
  it("collects property columns with stable inferred types", () => {
    expect(collectBasePropertyColumns(notes)).toEqual([
      { key: "score", type: "number", count: 2 },
      { key: "status", type: "text", count: 2 }
    ]);
  });

  it("filters across metadata and sorts numeric properties as numbers", () => {
    expect(filterAndSortBaseNotes(notes, {
      query: "project",
      sortKey: "score",
      sortDirection: "desc",
      visibleProperties: []
    }).map((note) => note.path)).toEqual(["B.md"]);
    expect(filterAndSortBaseNotes(notes, {
      query: "",
      sortKey: "score",
      sortDirection: "desc",
      visibleProperties: []
    }).map((note) => note.path)).toEqual(["A.md", "B.md"]);
  });

  it("drops missing columns from persisted settings", () => {
    expect(normalizeBaseViewSettings({
      query: "alpha",
      sortKey: "missing",
      sortDirection: "desc",
      visibleProperties: ["status", "missing"]
    }, ["status"])).toEqual({
      query: "alpha",
      sortKey: "title",
      sortDirection: "desc",
      visibleProperties: ["status"]
    });
  });
});
