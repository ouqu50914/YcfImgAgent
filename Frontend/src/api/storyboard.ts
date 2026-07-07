import request from '@/utils/request.ts';
import type { SkillApplyItem } from '@/api/skill';

export type StoryboardPhase = 'split' | 'prompts' | 'full';

export type StoryboardShot = {
    id: string;
    sequence: number;
    title?: string;
    scriptExcerpt: string;
    shotDescription: string;
    camera?: string;
    durationSec: number;
    prompt: string;
    negativePrompt?: string;
    referenceImageUrl?: string | null;
    /** 是否选中用于生成视频 */
    selected?: boolean;
};

export type StoryboardTemplate = 'default' | 'four_panel_comic';

export const generateStoryboard = (data: {
    script: string;
    skills?: SkillApplyItem[];
    maxShots?: number;
    aspectRatio?: string;
    template?: StoryboardTemplate;
    phase?: StoryboardPhase;
    shots?: StoryboardShot[];
}) => {
    return request.post<{ message: string; data: { shots: StoryboardShot[]; phase?: StoryboardPhase } }>(
        '/prompt/storyboard/generate',
        data,
        { timeout: 180000 }
    );
};
