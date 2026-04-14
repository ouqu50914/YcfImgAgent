import test from "node:test";
import assert from "node:assert/strict";
import { MidjourneyAdapter } from "../adapters/midjourney.adapter";

test("MidjourneyAdapter: 能从不同响应结构提取图片 URL", () => {
    const adapter = new MidjourneyAdapter() as any;

    const urls1 = adapter.extractImageUrls({
        image_url: "https://a.example.com/thumb.png",
        raw_image_url: "https://a.example.com/raw.png",
        sub_image_urls: ["https://a.example.com/sub1.png"],
    });
    assert.deepEqual(urls1, [
        "https://a.example.com/thumb.png",
        "https://a.example.com/raw.png",
        "https://a.example.com/sub1.png",
    ]);

    const urls2 = adapter.extractImageUrls({
        response: {
            image_url: "https://b.example.com/thumb.png",
            raw_image_url: "https://b.example.com/raw.png",
        },
    });
    assert.deepEqual(urls2, [
        "https://b.example.com/thumb.png",
        "https://b.example.com/raw.png",
    ]);
});

test("MidjourneyAdapter: 错误消息归一化优先使用 error.message", () => {
    const adapter = new MidjourneyAdapter() as any;
    const message = adapter.normalizeErrorMessage(
        { error: { message: "upstream failed" }, code: "x" },
        "fallback"
    );
    assert.equal(message, "upstream failed");
});

test("MidjourneyAdapter: imagine 未返回图片时走 tasks retrieve 兜底", async () => {
    const adapter = new MidjourneyAdapter() as any;

    adapter.submitImagine = async () => ({ taskId: "task-123" });
    adapter.retrieveTask = async (taskId: string) => {
        assert.equal(taskId, "task-123");
        return [
            "https://c.example.com/a.png",
            "https://c.example.com/b.png",
        ];
    };
    adapter.downloadAndSaveImage = async (u: string) => `/uploads/${u.split("/").pop()}`;

    const res = await adapter.generateImage(
        { prompt: "a cat", mode: "fast" },
        "fake-key",
        "https://api.acedata.cloud"
    );

    assert.ok(res.original_id.length > 0);
    assert.deepEqual(res.images, ["/uploads/a.png", "/uploads/b.png"]);
});

