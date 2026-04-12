import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("legacy naming audit", () => {
  it("does not contain legacy project identifiers in tracked text files", () => {
    const patterns = [
      ["Ans", "ubpedia"].join(""),
      ["ans", "ubpedia"].join(""),
      ["ANS", "UBPEDIA"].join(""),
      ["enzo", ".local"].join(""),
      ["enzo", "-vault"].join(""),
      ["open", "claw"].join(""),
      ["com", ".enzo"].join(""),
    ];

    try {
      const output = execFileSync(
        "git",
        ["grep", "-n", "-I", ...patterns.flatMap((pattern) => ["-e", pattern]), "--", "."],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      expect(output.trim()).toBe("");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 1
      ) {
        expect(true).toBe(true);
        return;
      }

      throw error;
    }
  });
});
