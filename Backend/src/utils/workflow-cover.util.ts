/** 解析 workflow_data（字符串或对象） */
export function parseWorkflowData(raw: string | object | null | undefined): Record<string, any> | null {
    if (!raw) return null;
    if (typeof raw === 'object') return raw as Record<string, any>;
    try {
        return JSON.parse(raw) as Record<string, any>;
    } catch {
        return null;
    }
}

/** 从工作流节点中取最后一张图片（按 position.x/y 降序，与前端 getLastImageFromWorkflow 一致） */
export function getLastImageFromWorkflowData(workflowData: Record<string, any> | null | undefined): string | undefined {
    if (!workflowData) return undefined;
    const nodes = workflowData.nodes || [];
    const imageNodes = nodes
        .filter((node: any) =>
            node.type === 'image' && (node.data?.imageUrl || node.data?.image_url)
        )
        .sort((a: any, b: any) => {
            const ax = a.position?.x ?? 0;
            const bx = b.position?.x ?? 0;
            if (ax !== bx) return bx - ax;
            const ay = a.position?.y ?? 0;
            const by = b.position?.y ?? 0;
            return by - ay;
        });

    if (imageNodes.length > 0) {
        const url = imageNodes[0].data?.imageUrl || imageNodes[0].data?.image_url;
        return url || undefined;
    }
    return undefined;
}

/** 封面优先级：最后一张图片节点 > workflow_data.cover_image > DB cover_image */
export function getProjectCover(
    workflowDataRaw: string | object | null | undefined,
    dbCoverImage?: string | null
): string | undefined {
    const workflowData = parseWorkflowData(workflowDataRaw);
    const lastImage = getLastImageFromWorkflowData(workflowData);
    if (lastImage) return lastImage;
    if (workflowData?.cover_image) return workflowData.cover_image;
    if (dbCoverImage) return dbCoverImage;
    return undefined;
}
