import axios from 'axios';

type ChatMessageRole = 'user' | 'assistant' | 'system';

interface ChatMessage {
    role: ChatMessageRole;
    content: string;
}

interface GeminiChatOptions {
    temperature?: number;
    maxTokens?: number;
    debugTag?: string;
}

export type OptimizePromptResult = {
    /** 正向提示词（写入 Prompt 节点） */
    optimized: string;
    /** 负面提示词 */
    negative: string;
    /** 模型原始全文（含标题） */
    raw: string;
};

export class PromptService {
    /**
     * 优化提示词（默认走 GPT-6 / AceData chat-completions）
     */
    async optimizePrompt(
        originalPrompt: string,
        options?: {
            apiType?: 'dream' | 'nano' | string;
            style?: string;
            /** 画布上可用的参考图/视频别名，如 图1、图2、视频1 */
            imageAliases?: string[];
        }
    ): Promise<OptimizePromptResult> {
        const API_KEY =
            process.env.WORKFLOW_AGENT_GPT6_API_KEY ||
            process.env.API_KEY ||
            process.env.ACE_API_KEY ||
            process.env.CHATGPT_API_KEY ||
            process.env.DEEPSEEK_API_KEY ||
            process.env.GEMINI_CHAT_API_KEY;
        const API_BASE = (
            process.env.WORKFLOW_AGENT_GPT6_API_BASE ||
            process.env.API_BASE ||
            process.env.QC_API_BASE ||
            process.env.CHATGPT_API_URL ||
            process.env.DEEPSEEK_API_URL ||
            'https://api.acedata.cloud/v1'
        ).replace(/\/$/, '');
        // AceData chat-completions：若配置了完整 URL 则用之，否则拼 /chat/completions
        const API_URL = /\/chat\/completions/i.test(API_BASE)
            ? API_BASE
            : `${API_BASE}/chat/completions`;
        const MODEL = (
            process.env.WORKFLOW_AGENT_GPT6_MODEL ||
            process.env.CHATGPT_MODEL ||
            process.env.DEEPSEEK_MODEL ||
            'gpt-6-astra'
        ).trim();

        if (!API_KEY) {
            console.log('[PromptService] 未配置 GPT-6/聊天 API Key，使用简单优化');
            return this.toOptimizeResult(this.simpleOptimize(originalPrompt, options));
        }

        try {
            const systemPrompt = this.buildSystemPrompt(options);
            const aliases = (options?.imageAliases || [])
                .map((a) => String(a || '').trim())
                .filter(Boolean);
            const aliasBlock =
                aliases.length > 0
                    ? `\n\n【可用参考资源别名】（必须原样保留，可合理安排引用位置）：${aliases.join('、')}`
                    : '\n\n【可用参考资源别名】：无（不要编造 图N / @图N）';
            const mediaHint = this.isVideoOptimizeTarget(options?.apiType, originalPrompt)
                ? '\n【媒体类型】文生视频：请按规则补充运镜与持续动作。'
                : '\n【媒体类型】文生图：以单帧画面描述为主；规则中的视频项可省略。';

            const response = await axios.post(
                API_URL,
                {
                    model: MODEL,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        {
                            role: 'user',
                            content:
                                `请优化以下提示词。不要解释，只按约定格式输出【正向提示词】与【负面提示词】。${mediaHint}${aliasBlock}\n\n` +
                                `【原文】\n${originalPrompt}`,
                        },
                    ],
                    temperature: 0.5,
                    max_tokens: 2000,
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${API_KEY}`,
                    },
                    timeout: Number(process.env.PROMPT_OPTIMIZE_TIMEOUT_MS || '120000'),
                }
            );

            let optimizedPrompt = response.data?.choices?.[0]?.message?.content?.trim() || '';
            // 去掉偶发的 markdown 围栏
            optimizedPrompt = optimizedPrompt
                .replace(/^```(?:text|markdown|md)?\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();

            if (optimizedPrompt) {
                return this.parseOptimizeOutput(optimizedPrompt);
            }
            console.warn('[PromptService] 大模型返回为空，使用简单优化');
            return this.toOptimizeResult(this.simpleOptimize(originalPrompt, options));
        } catch (error: any) {
            console.error('[PromptService] GPT-6 优化失败:', error?.message || error);
            return this.toOptimizeResult(this.simpleOptimize(originalPrompt, options));
        }
    }

    /**
     * 使用 Ace Data Gemini chat-completions 进行对话
     * 约定环境变量：
     * - GEMINI_CHAT_API_KEY: Ace Data 提供的 API Key
     * - GEMINI_CHAT_API_URL: 完整的 chat-completions 接口地址
     * - GEMINI_CHAT_MODEL:   使用的模型名称
     */
    async chatWithGemini(
        messages: ChatMessage[],
        options?: GeminiChatOptions
    ): Promise<string> {
        const API_KEY = process.env.GEMINI_CHAT_API_KEY;
        const API_URL = process.env.GEMINI_CHAT_API_URL;
        const MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-1.5-flash';

        if (!API_KEY || !API_URL) {
            throw new Error('Gemini 聊天服务未正确配置，请先设置 GEMINI_CHAT_API_KEY 与 GEMINI_CHAT_API_URL');
        }

        const payload: any = {
            model: MODEL,
            messages,
        };

        if (typeof options?.temperature === 'number') {
            payload.temperature = options.temperature;
        }
        if (typeof options?.maxTokens === 'number') {
            // Ace Data 文档如使用 max_tokens，则沿用；否则可根据实际字段名调整
            payload.max_tokens = options.maxTokens;
        }

        const debugTag = options?.debugTag || "default";
        const previewMessage = messages[messages.length - 1]?.content || "";
        console.log("[PromptService] Gemini chat 请求", {
            debug_tag: debugTag,
            url: API_URL,
            model: MODEL,
            message_count: messages.length,
            preview: previewMessage.slice(0, 220),
            temperature: payload.temperature,
            max_tokens: payload.max_tokens,
        });

        try {
            const response = await axios.post(
                API_URL,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_KEY}`,
                    },
                    // 强制直连，不使用系统代理（如 HTTPS_PROXY）
                    proxy: false,
                    timeout: 180000,
                }
            );
            console.log("[PromptService] Gemini chat 响应", {
                debug_tag: debugTag,
                status: response.status,
                has_choices: Array.isArray(response.data?.choices),
                top_level_keys: response.data && typeof response.data === "object" ? Object.keys(response.data) : [],
            });

            const data = response.data;

            let reply: unknown =
                // OpenAI 兼容格式
                data?.choices?.[0]?.message?.content ??
                data?.choices?.[0]?.text ??
                // Gemini 官方 candidates 格式
                (Array.isArray(data?.candidates) &&
                    data.candidates[0]?.content &&
                    Array.isArray(data.candidates[0].content.parts)
                    ? data.candidates[0].content.parts
                        .map((p: any) => p?.text || '')
                        .join('\n')
                    : undefined) ??
                // 更简单的字段
                data?.reply ??
                data?.message ??
                (typeof data === 'string' ? data : '');

            if (!reply || typeof reply !== 'string' || !reply.trim()) {
                throw new Error('Gemini 返回数据格式异常');
            }

            console.log("[PromptService] Gemini chat 解析成功", {
                debug_tag: debugTag,
                reply_preview: reply.trim().slice(0, 220),
            });
            return reply;
        } catch (error: any) {
            console.error('[PromptService] Gemini chat-completions 调用失败:', {
                debug_tag: debugTag,
                message: error?.message || error,
                status: error?.response?.status,
                response_data: error?.response?.data,
            });
            throw new Error('Gemini 聊天服务调用失败，请稍后重试');
        }
    }

    private isVideoOptimizeTarget(apiType?: string, originalPrompt?: string): boolean {
        const t = String(apiType || '');
        if (/video|kling|runway|luma|pixverse|可灵|海螺|vidu|sora/i.test(t)) return true;
        return /文生视频|生成视频|视频提示词|镜头运动|运镜/i.test(String(originalPrompt || ''));
    }

    private defaultNegativePrompt(): string {
        return '畸形, 多余手指, 肢体扭曲, 面部崩坏, 模糊, 低清晰度, 过曝, 欠曝, 水印, 文字, logo, 字幕, 噪点, 闪烁, 抖动, 画面撕裂, 重复肢体';
    }

    private toOptimizeResult(positive: string, negative?: string): OptimizePromptResult {
        const optimized = String(positive || '').trim();
        const neg = String(negative || this.defaultNegativePrompt()).trim();
        return {
            optimized,
            negative: neg,
            raw: `【正向提示词】\n${optimized}\n\n【负面提示词】\n${neg}`,
        };
    }

    /** 从模型输出中拆出正向/负面 */
    private parseOptimizeOutput(raw: string): OptimizePromptResult {
        const text = String(raw || '').trim();
        if (!text) {
            return this.toOptimizeResult('');
        }

        const positiveMatch = text.match(
            /【\s*正向提示词\s*】\s*([\s\S]*?)(?=【\s*负面提示词\s*】|$)/i
        );
        const negativeMatch = text.match(/【\s*负面提示词\s*】\s*([\s\S]*?)$/i);

        let positive = (positiveMatch?.[1] || '').trim();
        let negative = (negativeMatch?.[1] || '').trim();

        // 兼容英文/无标题格式
        if (!positive) {
            const enPos = text.match(
                /(?:^|\n)\s*(?:positive\s*prompt|positive)\s*[:：]\s*([\s\S]*?)(?=(?:\n\s*(?:negative\s*prompt|negative)\s*[:：])|$)/i
            );
            const enNeg = text.match(
                /(?:^|\n)\s*(?:negative\s*prompt|negative)\s*[:：]\s*([\s\S]*?)$/i
            );
            positive = (enPos?.[1] || '').trim();
            negative = (enNeg?.[1] || negative).trim();
        }

        if (!positive) {
            // 整段当作正向，避免空结果
            positive = text
                .replace(/【\s*正向提示词\s*】/gi, '')
                .replace(/【\s*负面提示词\s*】[\s\S]*$/gi, '')
                .trim();
        }

        return this.toOptimizeResult(positive, negative || undefined);
    }

    private buildSystemPrompt(options?: {
        apiType?: 'dream' | 'nano' | string;
        style?: string;
        imageAliases?: string[];
    }): string {
        let prompt =
            '你是专业的AI绘图/视频提示词优化专家。\n' +
            '任务：将用户输入的简单描述，改写为适合文生图/文生视频的高质量提示词。\n\n';

        if (options?.apiType) {
            prompt += `目标模型侧：${options.apiType}\n`;
        }
        if (options?.style) {
            prompt += `风格偏好：${options.style}\n`;
        }

        prompt += `
规则：
1. 保留用户原始核心主体、场景、动作，不能擅自修改用户需求。
2. 结构化扩充，依次补充：主体细节、环境场景、镜头与构图、光影色彩、艺术风格、画质参数。
3. 文生视频额外增加：镜头运动、运镜方式、画面稳定性、持续动作描述，避免瞬间跳变。
4. 用词简短，逗号分隔，不要长句子。
5. 生成对应的负面提示词，过滤畸形、模糊、水印、文字、扭曲、闪烁等问题。
6. 不要额外解释，只输出【正向提示词】和【负面提示词】。
7. 控制总长度，不要超过模型prompt上限。

平台补充（必须遵守）：
- 用户文中已有的「图1」「@图1」「视频1」等参考别名必须原样保留；只能使用【可用参考资源别名】列表中的名称，禁止虚构不存在的 图N。
- 输出格式必须为：
【正向提示词】
...
【负面提示词】
...`;

        return prompt;
    }

    /**
     * 简单优化（当没有大模型API时使用）
     */
    private simpleOptimize(
        originalPrompt: string,
        options?: {
            apiType?: 'dream' | 'nano' | string;
            style?: string;
            imageAliases?: string[];
        }
    ): string {
        let optimized = originalPrompt.trim();
        
        // 添加一些通用的优化建议
        const enhancements = [];
        
        if (options?.style) {
            enhancements.push(`${options.style} style`);
        }
        
        // 如果提示词太短，添加一些通用描述
        if (optimized.length < 20) {
            enhancements.push('high quality, detailed');
        }
        
        if (enhancements.length > 0) {
            optimized = `${optimized}, ${enhancements.join(', ')}`;
        }
        
        return optimized;
    }
}
