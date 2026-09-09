import { Request, Response } from "express";
import {
    AgentChatMessage,
    AgentSseEvent,
    isAgentChatEnabled,
    WorkflowAgentService,
} from "../services/workflow-agent.service";

const agentService = new WorkflowAgentService();

function writeSse(res: Response, event: AgentSseEvent) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function userIdOf(req: Request): number {
    return Number((req as any).user?.userId || (req as any).user?.id);
}

/**
 * 启动一轮 Agent：返回 SSE。若模型要调客户端工具，下发 tool_call 后 done（wait_client）。
 * 客户端执行后调用 /agent/continue。
 */
export const agentChatStream = async (req: Request, res: Response) => {
    if (!isAgentChatEnabled()) {
        return res.status(503).json({ message: "Agent 聊天未启用（AGENT_CHAT_ENABLED=false）" });
    }
    try {
        const userId = userIdOf(req);
        const { message, history, workflowContext, skillIds, mediaUrls } = req.body || {};
        if (!message || typeof message !== "string") {
            return res.status(400).json({ message: "message 不能为空" });
        }

        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        (res as any).flushHeaders?.();

        let messages = await agentService.buildInitialMessages({
            userId,
            message,
            history,
            workflowContext,
            skillIds: Array.isArray(skillIds) ? skillIds.map(Number).filter(Boolean) : [],
        });

        // mediaUrls 仅作上下文提示（多模态完整支持可后续加强）
        if (Array.isArray(mediaUrls) && mediaUrls.length) {
            messages.push({
                role: "system",
                content: `用户附带媒体 URL：${JSON.stringify(mediaUrls).slice(0, 2000)}`,
            });
        }

        await runUntilClientOrDone(userId, messages, res);
    } catch (e: any) {
        if (!res.headersSent) {
            return res.status(500).json({ message: e.message || "Agent 失败" });
        }
        writeSse(res, { type: "error", message: e.message || "Agent 失败" });
        res.end();
    }
};

export const agentChatContinue = async (req: Request, res: Response) => {
    if (!isAgentChatEnabled()) {
        return res.status(503).json({ message: "Agent 聊天未启用" });
    }
    try {
        const userId = userIdOf(req);
        const { messages, tool_results, round } = req.body || {};
        if (!Array.isArray(messages)) {
            return res.status(400).json({ message: "messages 必填" });
        }
        const currentRound = Number(round) || 1;
        if (currentRound > agentService.maxRounds) {
            return res.status(200).json({
                events: [{ type: "done", text: "已达工具轮次上限，请根据当前画布继续操作。" }],
                messages,
                round: currentRound,
            });
        }

        const nextMessages: AgentChatMessage[] = [...messages];
        if (Array.isArray(tool_results)) {
            for (const tr of tool_results) {
                nextMessages.push({
                    role: "tool",
                    tool_call_id: String(tr.tool_call_id || tr.id || ""),
                    content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content ?? {}),
                });
            }
        }

        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        (res as any).flushHeaders?.();

        await runUntilClientOrDone(userId, nextMessages, res, currentRound);
    } catch (e: any) {
        if (!res.headersSent) {
            return res.status(500).json({ message: e.message || "Agent continue 失败" });
        }
        writeSse(res, { type: "error", message: e.message || "Agent continue 失败" });
        res.end();
    }
};

async function runUntilClientOrDone(
    userId: number,
    messages: AgentChatMessage[],
    res: Response,
    startRound = 1
) {
    let round = startRound;
    let msgs = messages;

    while (round <= agentService.maxRounds) {
        const result = await agentService.runModelTurn(msgs);

        if (result.text) {
            writeSse(res, { type: "text_delta", text: result.text });
        }

        const calls = result.toolCalls || [];
        if (!calls.length) {
            writeSse(res, { type: "done", text: result.text || "" });
            // 附带 messages 供调试：用注释帧
            res.write(
                `data: ${JSON.stringify({ type: "state", messages: msgs.concat([{ role: "assistant", content: result.text || "" }]), round })}\n\n`
            );
            res.end();
            return;
        }

        const assistantWithCalls: AgentChatMessage = {
            role: "assistant",
            content: result.text || "",
            tool_calls: calls,
        };
        msgs = [...msgs, assistantWithCalls];

        const clientCalls: typeof calls = [];
        for (const call of calls) {
            if (call.name === "ask_user") {
                const q = String(call.arguments?.question || "请补充信息");
                msgs.push({
                    role: "tool",
                    tool_call_id: call.id,
                    content: JSON.stringify({ status: "waiting_user", question: q }),
                });
                writeSse(res, { type: "ask_user", question: q });
                writeSse(res, { type: "done", text: q });
                res.write(`data: ${JSON.stringify({ type: "state", messages: msgs, round, waiting_user: true })}\n\n`);
                res.end();
                return;
            }

            const serverResult = await agentService.tryServerTool(userId, call.name, call.arguments);
            if (serverResult != null) {
                msgs.push({
                    role: "tool",
                    tool_call_id: call.id,
                    content: serverResult,
                });
                continue;
            }
            clientCalls.push(call);
        }

        if (clientCalls.length) {
            for (const c of clientCalls) {
                writeSse(res, {
                    type: "tool_call",
                    id: c.id,
                    name: c.name,
                    arguments: c.arguments,
                });
            }
            res.write(
                `data: ${JSON.stringify({ type: "state", messages: msgs, round, wait_client: true })}\n\n`
            );
            writeSse(res, { type: "done", text: result.text || "" });
            res.end();
            return;
        }

        // 全部服务端工具已执行，继续下一轮
        round += 1;
    }

    writeSse(res, { type: "done", text: "已达工具轮次上限。" });
    res.write(`data: ${JSON.stringify({ type: "state", messages: msgs, round })}\n\n`);
    res.end();
}
