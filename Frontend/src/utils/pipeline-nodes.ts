import type { GraphEdge, GraphNode } from '@vue-flow/core';
import type { StoryboardShot } from '@/api/storyboard';
import type { SkillFragment } from '@/utils/skill-prompt';
import type { PromptPipelineData } from '@/utils/storyboard-pipeline-display';

export type PipelineStage = 'split' | 'prompts';

export type PipelineStageNodeData = {
    pipelineStage: PipelineStage;
    pipelineRootId: string;
    shots: StoryboardShot[];
    pipeline: PromptPipelineData;
    attachedSkills: SkillFragment[];
    text: string;
};

const STAGE_GAP_X = 460;

export function findDownstreamDreamId(
    startNodeId: string,
    edges: GraphEdge[],
    nodes: GraphNode[]
): string | null {
    const queue = [startNodeId];
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        for (const e of edges.filter((x) => x.source === id)) {
            const target = nodes.find((n) => n.id === e.target);
            if (!target) continue;
            if (target.type === 'dream') return target.id;
            if (target.type === 'prompt' || target.type === 'storyboard') {
                queue.push(target.id);
            }
        }
    }
    return null;
}

export function getDirectTargetId(sourceId: string, edges: GraphEdge[]): string | null {
    const edge = edges.find((e) => e.source === sourceId);
    return edge?.target ?? null;
}

export type SpawnStageNodeParams = {
    fromNodeId: string;
    stage: PipelineStage;
    text: string;
    shots: StoryboardShot[];
    pipeline: PromptPipelineData;
    rootNodeId: string;
    attachedSkills: SkillFragment[];
    nodes: GraphNode[];
    edges: GraphEdge[];
    addNodes: (nodes: GraphNode[]) => void;
    addEdges: (edges: GraphEdge[]) => void;
    removeEdges: (ids: string[]) => void;
};

export function spawnPipelineStageNode(params: SpawnStageNodeParams): string {
    const {
        fromNodeId,
        stage,
        text,
        shots,
        pipeline,
        rootNodeId,
        attachedSkills,
        nodes,
        edges,
        addNodes,
        addEdges,
        removeEdges,
    } = params;

    const fromNode = nodes.find((n) => n.id === fromNodeId);
    if (!fromNode) throw new Error('找不到上游节点');

    const oldEdge = edges.find((e) => e.source === fromNodeId);
    const downstreamId = oldEdge?.target ?? null;

    const newId = `prompt_${stage}_${Date.now()}`;
    const step = stage === 'split' ? 'split_review' : 'prompt_review';

    addNodes([
        {
            id: newId,
            type: 'prompt',
            position: {
                x: fromNode.position.x + STAGE_GAP_X,
                y: fromNode.position.y,
            },
            data: {
                text,
                pipelineStage: stage,
                pipelineRootId: rootNodeId,
                shots,
                attachedSkills,
                pipeline: { ...pipeline, step },
            },
        } as GraphNode,
    ]);

    if (oldEdge) {
        removeEdges([oldEdge.id]);
    }

    addEdges([
        {
            id: `edge_${fromNodeId}_${newId}`,
            source: fromNodeId,
            target: newId,
            sourceHandle: 'source',
            targetHandle: 'prompt-target',
            type: 'default',
            animated: true,
        },
    ]);

    if (downstreamId) {
        addEdges([
            {
                id: `edge_${newId}_${downstreamId}`,
                source: newId,
                target: downstreamId,
                sourceHandle: 'source',
                targetHandle: 'target',
                type: 'default',
                animated: true,
            },
        ]);
    }

    return newId;
}
