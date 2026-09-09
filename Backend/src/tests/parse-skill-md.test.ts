import { parseSkillMarkdown, detectHasScripts } from "../skills/parse-skill-md";
import assert from "assert";
import { describe, it } from "node:test";

describe("parseSkillMarkdown", () => {
    it("parses frontmatter", () => {
        const raw = `---
name: demo-skill
description: A demo skill for tests
---

# Hello
Body here
`;
        const p = parseSkillMarkdown(raw);
        assert.equal(p.name, "demo-skill");
        assert.equal(p.description, "A demo skill for tests");
        assert.match(p.body, /Hello/);
    });

    it("rejects missing name", () => {
        assert.throws(() => parseSkillMarkdown(`---\ndescription: x\n---\nbody`), /name/);
    });

    it("detects scripts", () => {
        assert.equal(detectHasScripts(["SKILL.md", "scripts/run.py"]), true);
        assert.equal(detectHasScripts(["SKILL.md", "references/a.md"]), false);
    });
});
