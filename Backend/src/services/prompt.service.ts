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

export class PromptService {
    /**
     * 优化提示词
     * 支持对接ChatGPT/DeepSeek等大模型API
     */
    async optimizePrompt(
        originalPrompt: string,
        options?: {
            apiType?: 'dream' | 'nano'; // 针对哪个API优化
            style?: string; // 风格偏好
        }
    ): Promise<string> {
        // 获取大模型API配置
        const API_KEY = process.env.CHATGPT_API_KEY || process.env.DEEPSEEK_API_KEY;
        const API_URL = process.env.CHATGPT_API_URL || process.env.DEEPSEEK_API_URL || 'https://api.openai.com/v1/chat/completions';
        const MODEL = process.env.CHATGPT_MODEL || process.env.DEEPSEEK_MODEL || 'gpt-3.5-turbo';

        if (!API_KEY) {
            // 如果没有配置大模型API，返回优化后的提示词（简单处理）
            console.log('[PromptService] 未配置大模型API，使用简单优化');
            return this.simpleOptimize(originalPrompt, options);
        }

        try {
            // 构造优化提示词的系统提示
            const systemPrompt = this.buildSystemPrompt(options);
            
            const response = await axios.post(
                API_URL,
                {
                    model: MODEL,
                    messages: [
                        {
                            role: 'system',
                            content: systemPrompt
                        },
                        {
                            role: 'user',
                            content: `请优化以下提示词，使其更适合AI生图：\n\n${originalPrompt}`
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 500
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_KEY}`
                    },
                    timeout: 1800000
                }
            );

            const optimizedPrompt = response.data.choices?.[0]?.message?.content?.trim();
            
            if (optimizedPrompt) {
                return optimizedPrompt;
            } else {
                console.warn('[PromptService] 大模型返回格式异常，使用简单优化');
                return this.simpleOptimize(originalPrompt, options);
            }
        } catch (error: any) {
            console.error('[PromptService] 大模型API调用失败:', error.message);
            // 降级到简单优化
            return this.simpleOptimize(originalPrompt, options);
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
            return reply.trim();
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

    /**
     * 构建系统提示词
     */
    private buildSystemPrompt(options?: { apiType?: 'dream' | 'nano'; style?: string }): string {
        let prompt = '你是一个专业的AI生图提示词优化专家。你的任务是优化用户提供的提示词，使其更加详细、准确，能够生成高质量的图片。\n\n';
        
        if (options?.apiType) {
            prompt += `目标API: ${options.apiType === 'dream' ? '即梦AI' : 'Nano AI'}\n`;
        }
        
        if (options?.style) {
            prompt += `风格偏好: ${options.style}\n`;
        }
        
        prompt += `\n优化要求：
1. 保持原意，不要改变核心内容
2. 添加更多细节描述（颜色、光线、构图等）
3. 使用英文关键词（如果原提示词是中文，可以保留中文但添加英文关键词）
4. 确保提示词清晰、具体
5. 返回优化后的提示词，不要添加解释性文字`;

        return prompt;
    }

    /**
     * 简单优化（当没有大模型API时使用）
     */
    private simpleOptimize(
        originalPrompt: string,
        options?: { apiType?: 'dream' | 'nano'; style?: string }
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
