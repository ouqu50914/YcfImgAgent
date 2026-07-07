export type SkillUsabilityLevel = 'ok' | 'warn' | 'block';

export type SkillUsabilityResult = {
    usable: boolean;
    level: SkillUsabilityLevel;
    category: string;
    reason: string;
};

export type SkillImportPreviewItem = {
    skill: Record<string, unknown>;
    usability: SkillUsabilityResult;
};

export function usabilityLabel(result: SkillUsabilityResult): string {
    if (result.level === 'ok') return '可用';
    if (result.level === 'warn') return '谨慎使用';
    return '不可用';
}

export function usabilityTagType(result: SkillUsabilityResult): 'success' | 'warning' | 'danger' {
    if (result.level === 'ok') return 'success';
    if (result.level === 'warn') return 'warning';
    return 'danger';
}

export function hasBlockedSkills(items: Array<{ usability: SkillUsabilityResult }>): boolean {
    return items.some((x) => !x.usability.usable);
}
