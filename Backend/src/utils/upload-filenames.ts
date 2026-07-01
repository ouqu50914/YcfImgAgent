/** 从 workflow JSON / URL 字符串中收集 uploads/ 根目录下的文件名（不含 chat-temp 子路径） */
export function collectUploadFilenamesFromWorkflow(workflowData: unknown, coverImage?: string | null): string[] {
    const names: string[] = [];
    const add = (url: string | undefined | null) => {
        if (!url || typeof url !== "string") return;
        const m = url.match(/\/uploads\/([^/?]+)/);
        if (m && m[1]) names.push(m[1]);
    };
    add(coverImage);
    if (workflowData && typeof workflowData === "object") {
        const data = workflowData as { nodes?: unknown[]; cover_image?: string };
        const nodes = data.nodes || [];
        for (const node of nodes) {
            const d = (node as { data?: Record<string, unknown> })?.data;
            if (!d) continue;
            add(d.imageUrl as string);
            add(d.originalImageUrl as string);
            add(d.image_url as string);
            if (Array.isArray(d.imageUrls)) for (const u of d.imageUrls) add(u as string);
            const lr = d.layerResult as { layers?: Array<{ url?: string }> } | undefined;
            if (lr?.layers && Array.isArray(lr.layers)) {
                for (const layer of lr.layers) add(layer?.url);
            }
            add(d.videoUrl as string);
        }
        add(data.cover_image);
    }
    return [...new Set(names)];
}

/** 从任意字符串（URL、JSON）中提取 uploads/ 根目录文件名 */
export function collectUploadFilenamesFromText(text: string | null | undefined): string[] {
    if (!text || typeof text !== "string") return [];
    const names: string[] = [];
    const re = /\/uploads\/([^/?"'\\]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m[1]) names.push(m[1]);
    }
    return names;
}

export function mergeUploadFilenames(...groups: string[][]): Set<string> {
    const set = new Set<string>();
    for (const g of groups) {
        for (const n of g) {
            if (n) set.add(n);
        }
    }
    return set;
}
