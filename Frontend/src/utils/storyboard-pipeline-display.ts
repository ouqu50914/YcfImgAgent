import type { StoryboardShot } from '@/api/storyboard';

export function formatShotsAsSplitText(shots: StoryboardShot[]): string {
    return shots
        .map((s) => {
            const head = `【第 ${s.sequence} 镜${s.title ? ` · ${s.title}` : ''}】`;
            return `${head}\n${s.shotDescription || ''}`;
        })
        .join('\n\n');
}

export function formatShotsAsPromptText(shots: StoryboardShot[]): string {
    return shots
        .map((s) => {
            const head = `【第 ${s.sequence} 镜${s.title ? ` · ${s.title}` : ''}】`;
            const desc = s.shotDescription ? `${s.shotDescription}\n\n` : '';
            return `${head}\n${desc}提示词：\n${s.prompt || ''}`;
        })
        .join('\n\n---\n\n');
}

export function isComicPipelineSkill(skills: Array<{ name?: string; content: string }>): boolean {
    return skills.some((s) => {
        const head = `${s.name || ''} ${s.content.slice(0, 400)}`;
        return /四格漫画|comic|起承转合|条漫/i.test(head);
    });
}

export type PromptPipelineStep =
    | 'idle'
    | 'running'
    | 'split_review'
    | 'prompt_review'
    | 'generating'
    | 'done'
    | 'error';

export type PipelineStageKind = 'split' | 'prompts';

export type PromptPipelineData = {
    step: PromptPipelineStep;
    autoProceed: boolean;
    template: 'four_panel_comic' | 'default';
    originalScript: string;
    shots: StoryboardShot[];
    statusMessage?: string;
    activeShotIndex?: number;
};

export function getDefaultPipelineData(): PromptPipelineData {
    return {
        step: 'idle',
        autoProceed: true,
        template: 'four_panel_comic',
        originalScript: '',
        shots: [],
        statusMessage: '',
        activeShotIndex: 0,
    };
}

export function readPipelineFromNodeData(data: unknown): PromptPipelineData {
    const d = data as { pipeline?: Partial<PromptPipelineData> } | undefined;
    const p = d?.pipeline;
    if (!p || typeof p !== 'object') return getDefaultPipelineData();
    return {
        ...getDefaultPipelineData(),
        ...p,
        shots: Array.isArray(p.shots) ? p.shots : [],
    };
}
