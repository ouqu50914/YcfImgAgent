import type {
    GenerationSkillApplyMode,
    GenerationSkillFormat,
    GenerationSkillScope,
    SkillApplyItem,
} from '@/api/skill';
import { applySkillsToPrompt, isAgentSkillFormat } from '@/api/skill';

export type SkillFragment = {
    name?: string;
    content: string;
    scope?: GenerationSkillScope;
    format?: GenerationSkillFormat;
    apply_mode?: GenerationSkillApplyMode;
    description?: string;
    skillId?: number | null;
};

export type SkillNodeData = {
    skillId?: number | null;
    name?: string;
    content?: string;
    scope?: GenerationSkillScope;
    format?: GenerationSkillFormat;
    apply_mode?: GenerationSkillApplyMode;
    description?: string;
};

export type PromptNodeSkillData = {
    attachedSkills?: SkillFragment[];
};

export function getAttachedSkillsFromPromptData(data: unknown): SkillFragment[] {
    if (!data || typeof data !== 'object') return [];
    const list = (data as PromptNodeSkillData).attachedSkills;
    if (!Array.isArray(list)) return [];
    return list
        .filter((item) => item && typeof item.content === 'string' && item.content.trim())
        .map((item) => ({
            skillId: item.skillId ?? null,
            name: typeof item.name === 'string' ? item.name : undefined,
            content: item.content.trim(),
            scope: item.scope,
            format: item.format || 'plain',
            apply_mode:
                item.apply_mode ||
                (isAgentSkillFormat(item.format) ? 'preprocess' : 'merge'),
            description: typeof item.description === 'string' ? item.description : undefined,
        }));
}

function skillDedupeKey(skill: SkillFragment): string {
    if (skill.skillId != null) return `id:${skill.skillId}`;
    return `c:${skill.name || ''}:${skill.content.slice(0, 120)}`;
}

function pushSkillUnique(skills: SkillFragment[], seen: Set<string>, skill: SkillFragment) {
    const key = skillDedupeKey(skill);
    if (seen.has(key)) return;
    seen.add(key);
    skills.push(skill);
}

export function getSkillTextFromNodeData(data: unknown): string {
    if (!data || typeof data !== 'object') return '';
    const d = data as SkillNodeData;
    return typeof d.content === 'string' ? d.content.trim() : '';
}

export function skillAppliesToScope(
    skillScope: GenerationSkillScope | undefined,
    target: 'image' | 'video'
): boolean {
    if (!skillScope || skillScope === 'both') return true;
    return skillScope === target;
}

export function readConnectedSkillsFromEdges(params: {
    targetNodeId: string;
    edges: Array<{ source: string; target: string }>;
    nodes: Array<{ id: string; type?: string; data?: unknown }>;
    targetScope: 'image' | 'video';
}): SkillFragment[] {
    const { targetNodeId, edges, nodes, targetScope } = params;
    const skills: SkillFragment[] = [];
    const seen = new Set<string>();

    for (const edge of edges) {
        if (edge.target !== targetNodeId) continue;
        const sourceNode = nodes.find((n) => n.id === edge.source);
        if (!sourceNode) continue;

        if (sourceNode.type === 'skill') {
            const data = sourceNode.data as SkillNodeData | undefined;
            const content = getSkillTextFromNodeData(data);
            if (!content) continue;
            if (!skillAppliesToScope(data?.scope, targetScope)) continue;

            pushSkillUnique(skills, seen, {
                skillId: data?.skillId ?? null,
                name: typeof data?.name === 'string' ? data.name : undefined,
                content,
                scope: data?.scope,
                format: data?.format || 'plain',
                apply_mode:
                    data?.apply_mode ||
                    (isAgentSkillFormat(data?.format) ? 'preprocess' : 'merge'),
                description: typeof data?.description === 'string' ? data.description : undefined,
            });
            continue;
        }

        if (sourceNode.type === 'prompt') {
            for (const attached of getAttachedSkillsFromPromptData(sourceNode.data)) {
                if (!skillAppliesToScope(attached.scope, targetScope)) continue;
                pushSkillUnique(skills, seen, attached);
            }
        }
    }

    return skills;
}

export function mergeSkillWithPrompt(skills: SkillFragment[], userPrompt: string): string {
    const prompt = userPrompt.trim();
    const blocks = skills
        .map((skill) => {
            const header = skill.name ? `【Skill: ${skill.name}】` : '【Skill】';
            return `${header}\n${skill.content.trim()}`;
        })
        .filter(Boolean);

    if (blocks.length === 0) return prompt;
    if (!prompt) return blocks.join('\n\n');
    return `${blocks.join('\n\n')}\n\n---\n\n${prompt}`;
}

export function hasPromptOrSkill(userPrompt: string, skills: SkillFragment[]): boolean {
    return userPrompt.trim().length > 0 || skills.some((s) => s.content.trim().length > 0);
}

/** 分镜/四格漫画类 Skill 应走分镜节点，不宜直连生图节点一键生成 */
export function isStoryboardPipelineSkill(skills: SkillFragment[]): boolean {
    return skills.some((s) => {
        const head = `${s.name || ''} ${s.content.slice(0, 400)}`;
        return /四格漫画|分镜|storyboard|comic|条漫|起承转合/i.test(head);
    });
}

function toApplyItems(skills: SkillFragment[]): SkillApplyItem[] {
    return skills.map((s) => ({
        name: s.name,
        content: s.content,
        format: s.format,
        apply_mode: s.apply_mode,
        description: s.description,
    }));
}

/** 解析最终 prompt：preprocess 模式走 Gemini，merge 模式本地拼接 */
export async function resolvePromptWithSkills(params: {
    skills: SkillFragment[];
    userPrompt: string;
    target: 'image' | 'video';
}): Promise<string> {
    const { skills, userPrompt, target } = params;
    if (!skills.length) return userPrompt.trim();

    const needsApi =
        skills.some((s) => s.apply_mode === 'preprocess') ||
        skills.some((s) => isAgentSkillFormat(s.format) && s.apply_mode !== 'merge');

    if (!needsApi) {
        return mergeSkillWithPrompt(skills, userPrompt);
    }

    try {
        const res = await applySkillsToPrompt({
            skills: toApplyItems(skills),
            userPrompt,
            target,
        });
        const prompt = (res as { data?: { prompt?: string } })?.data?.prompt;
        if (typeof prompt === 'string' && prompt.trim()) return prompt.trim();
    } catch (error) {
        console.warn('[skill-prompt] apply API 失败，回退 merge', error);
    }

    return mergeSkillWithPrompt(skills, userPrompt);
}
