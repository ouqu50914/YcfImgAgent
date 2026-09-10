import {
    parseSkillMarkdown,
    detectHasScripts,
    detectExecutableScripts,
    resolveSkillDisplayName,
} from "../skills/parse-skill-md";
import assert from "assert";
import { describe, it } from "node:test";

describe("parseSkillMarkdown", () => {
    it("parses frontmatter", () => {
        const raw = `---
name: demo-skill
title: 演示技能
description: A demo skill for tests
---

# Hello
Body here
`;
        const p = parseSkillMarkdown(raw);
        assert.equal(p.name, "demo-skill");
        assert.equal(p.title, "演示技能");
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

    it("executable scripts vs hub gui js", () => {
        assert.equal(detectExecutableScripts(["SKILL.md", "scripts/run.py"]), true);
        assert.equal(detectExecutableScripts(["SKILL.md", "scripts/index.js"]), false);
        assert.equal(detectExecutableScripts(["SKILL.md", "scripts/app.css"]), false);
    });

    it("resolveSkillDisplayName prefers title then h1", () => {
        assert.equal(
            resolveSkillDisplayName({
                name: "ecommerce-poster",
                frontmatter_json: { title: "电商主图" },
                description: "desc",
                body_md: "# 其它",
            }),
            "电商主图"
        );
        assert.equal(
            resolveSkillDisplayName({
                name: "art-qc-review",
                description: "长描述不会用整段",
                body_md: "# 美术质检\n\n正文",
            }),
            "美术质检"
        );
    });
});
