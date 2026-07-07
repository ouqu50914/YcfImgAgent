import request from '@/utils/request.ts';

export type GenerationSkillScope = 'image' | 'video' | 'both';
export type GenerationSkillFormat = 'plain' | 'agent_skill' | 'cursor_skill';
export type GenerationSkillApplyMode = 'merge' | 'preprocess';

export interface GenerationSkill {
    id: number;
    user_id: number;
    name: string;
    content: string;
    scope: GenerationSkillScope;
    description?: string;
    format: GenerationSkillFormat;
    apply_mode: GenerationSkillApplyMode;
    metadata_json?: string;
    source_path?: string;
    created_at: string;
    updated_at: string;
}

export interface CreateSkillParams {
    name: string;
    content: string;
    scope?: GenerationSkillScope;
    description?: string;
    format?: GenerationSkillFormat;
    apply_mode?: GenerationSkillApplyMode;
    metadata_json?: string;
    source_path?: string;
}

export interface UpdateSkillParams {
    name?: string;
    content?: string;
    scope?: GenerationSkillScope;
    description?: string;
    format?: GenerationSkillFormat;
    apply_mode?: GenerationSkillApplyMode;
    metadata_json?: string;
    source_path?: string;
}

export type SkillApplyItem = {
    name?: string;
    content: string;
    format?: GenerationSkillFormat;
    apply_mode?: GenerationSkillApplyMode;
    description?: string;
};

export const createGenerationSkill = (data: CreateSkillParams) => {
    return request.post('/prompt/skills', data);
};

export const getGenerationSkills = (scope?: GenerationSkillScope) => {
    return request.get('/prompt/skills', { params: scope ? { scope } : undefined });
};

export const getGenerationSkill = (id: number) => {
    return request.get(`/prompt/skills/${id}`);
};

export const updateGenerationSkill = (id: number, data: UpdateSkillParams) => {
    return request.put(`/prompt/skills/${id}`, data);
};

export const deleteGenerationSkill = (id: number) => {
    return request.delete(`/prompt/skills/${id}`);
};

export const searchGenerationSkills = (keyword: string, scope?: GenerationSkillScope) => {
    return request.get('/prompt/skills/search', { params: { keyword, ...(scope ? { scope } : {}) } });
};

export const importGenerationSkills = (skills: CreateSkillParams[]) => {
    return request.post('/prompt/skills/import', { skills });
};

export const checkSkillsUsability = (skills: CreateSkillParams[]) => {
    return request.post<{ message: string; data: SkillImportPreviewItem[] }>(
        '/prompt/skills/check-usability',
        { skills }
    );
};

export type SkillImportPreviewItem = {
    skill: CreateSkillParams;
    usability: {
        usable: boolean;
        level: 'ok' | 'warn' | 'block';
        category: string;
        reason: string;
    };
};

export type SkillMarketplaceSource = {
    id: string;
    name: string;
    description: string;
    homepage: string;
    standard: string;
};

export type SkillMarketplaceItem = {
    slug: string;
    name: string;
    description?: string;
    installUrl: string;
};

export const getSkillMarketplace = () => {
    return request.get<{ message: string; data: SkillMarketplaceSource[] }>('/prompt/skills/marketplace');
};

export const getSkillMarketplaceItems = (sourceId: string) => {
    return request.get<{ message: string; data: SkillMarketplaceItem[] }>(
        `/prompt/skills/marketplace/${sourceId}/items`
    );
};

export const previewRemoteSkills = (url: string) => {
    return request.post<{ message: string; data: SkillImportPreviewItem[] }>(
        '/prompt/skills/preview-remote',
        { url },
        { timeout: 180000 }
    );
};

export const importRemoteSkills = (url: string) => {
    return request.post<{ message: string; data: GenerationSkill[] }>('/prompt/skills/import-remote', { url });
};

export function isAgentSkillFormat(format?: string): boolean {
    return format === 'agent_skill' || format === 'cursor_skill';
}

export type BuiltinGenerationSkill = {
    slug: string;
    name: string;
    description: string;
    scope: GenerationSkillScope;
    format: GenerationSkillFormat;
    apply_mode: GenerationSkillApplyMode;
    content: string;
    skill_type: string;
    metadata_json: string;
};

export const getBuiltinSkills = () => {
    return request.get<{ message: string; data: BuiltinGenerationSkill[] }>('/prompt/skills/builtin');
};

export const installBuiltinSkill = (slug: string) => {
    return request.post<{ message: string; data: GenerationSkill }>(
        `/prompt/skills/builtin/${slug}/install`
    );
};

export const applySkillsToPrompt = (data: {
    skills: SkillApplyItem[];
    userPrompt: string;
    target: 'image' | 'video';
}) => {
    return request.post<{ message: string; data: { prompt: string; usedPreprocess: boolean } }>(
        '/prompt/skills/apply',
        data
    );
};

export const SKILL_LIMITS = {
    NAME_MAX: 100,
    CONTENT_MAX: 20000,
    DESCRIPTION_MAX: 200,
    IMPORT_BATCH_MAX: 50,
} as const;
