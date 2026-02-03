import axios from 'axios';

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
                    timeout: 30000
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
