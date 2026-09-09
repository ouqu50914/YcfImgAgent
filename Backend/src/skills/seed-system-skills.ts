import fs from "fs";
import path from "path";
import { AppDataSource } from "../data-source";
import { SkillDefinition } from "../entities/SkillDefinition";
import { parseSkillMarkdown } from "./parse-skill-md";

/**
 * Seed Backend/skills/system/.../SKILL.md as global if missing
 */
export async function seedSystemSkills(): Promise<void> {
    if (process.env.SKILL_REGISTRY_ENABLED === "false") return;
    const root = path.join(process.cwd(), "skills", "system");
    if (!fs.existsSync(root)) return;

    const repo = AppDataSource.getRepository(SkillDefinition);
    const dirs = await fs.promises.readdir(root, { withFileTypes: true });
    for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const mdPath = path.join(root, d.name, "SKILL.md");
        if (!fs.existsSync(mdPath)) continue;
        try {
            const raw = await fs.promises.readFile(mdPath, "utf8");
            const parsed = parseSkillMarkdown(raw);
            const exists = await repo.findOne({
                where: { name: parsed.name, visibility: "global" },
            });
            if (exists) continue;
            const row = repo.create({
                owner_user_id: 0,
                name: parsed.name,
                description: parsed.description,
                body_md: parsed.body,
                frontmatter_json: parsed.frontmatter,
                visibility: "global",
                status: "active",
                compat_flags: { system: true },
                package_key: null,
                assets_json: [],
            });
            await repo.save(row);
            console.log(`[bootstrap] 已 seed 系统 Skill: ${parsed.name}`);
        } catch (e: any) {
            console.warn(`[bootstrap] seed Skill 失败 ${d.name}:`, e?.message || e);
        }
    }
}
