/** 与后端 image_result.generation_key 列长度一致 */
export const IMAGE_GENERATION_KEY_MAX_LENGTH = 64;

/**
 * 生图幂等 key：用于占位节点、刷新恢复、按 key 查询最终结果。
 * 不嵌入节点 id，避免超长；仅依赖时间戳 + 随机串保证唯一。
 */
export function createImageGenerationKey(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 10);
    const key = `ig_${ts}_${rand}`;
    return key.length <= IMAGE_GENERATION_KEY_MAX_LENGTH
        ? key
        : key.slice(0, IMAGE_GENERATION_KEY_MAX_LENGTH);
}
