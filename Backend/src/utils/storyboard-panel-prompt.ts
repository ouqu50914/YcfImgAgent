/**
 * 批量「一镜一图」时：为第 i 张注入强制单镜头约束，避免模型把同一条 Prompt 画成四格漫画。
 */
export function looksLikeStoryboardBatchPrompt(prompt: string): boolean {
    const s = String(prompt || "");
    return /独立分镜|分镜成品|storyboard|一镜一图|【分镜】|阅读顺序共\s*\d+\s*镜/i.test(s);
}

export function injectStoryboardPanelIndex(prompt: string, indexZeroBased: number, total: number): string {
    const totalSafe = Math.max(1, Math.floor(total) || 1);
    const i = Math.min(totalSafe, Math.max(1, Math.floor(indexZeroBased) + 1));
    const base = String(prompt || "").trim();
    const header =
        `【强制单镜头 ${i}/${totalSafe}】本张是独立成品图，不是漫画页。` +
        `画面内只能有【一个】完整镜头/场景（全幅），禁止：四格/多格拼版、竖条分镜格、九宫格、把多段剧情画进同一张、分镜序号水印。` +
        `只表现第 ${i} 个情节节拍；角色造型与参考图一致；画幅按接口给定比例（如 9:16）满幅构图。\n\n`;
    // 去掉容易诱发「整页漫画」的旧整图宫格句，保留剧情
    const cleaned = base
        .replace(/请生成【一张】\d+×\d+ 宫格分镜图[^。\n]*。?/g, "")
        .replace(/Generate ONE image as a \d+x\d+ storyboard grid[^\n.]*/gi, "")
        .trim();
    return header + cleaned;
}
