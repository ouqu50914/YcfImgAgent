import { AiProvider, AiResponse, GenerateParams } from "./ai-provider.interface";

export class NanoAdapter implements AiProvider {
    async generateImage(params: GenerateParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        console.log(`[NanoAPI] 收到请求: ${params.prompt}`);
        
        // Nano 假设更快，模拟 1秒 延迟
        await new Promise(resolve => setTimeout(resolve, 1000));

        return {
            original_id: `nano_task_${Date.now()}`,
            images: [`https://via.placeholder.com/512x512.png?text=Nano+AI+Result`]
        };
    }
}