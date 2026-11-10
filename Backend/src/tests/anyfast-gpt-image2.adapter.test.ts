import test from "node:test";
import assert from "node:assert/strict";
import { AnyfastGptImage2Adapter } from "../adapters/anyfast-gpt-image2.adapter";
import { AceGptImage2Adapter } from "../adapters/ace-gpt-image2.adapter";
import { calcNanoGenerateCredits, buildCreditUsageApiType, isGptImage26Model } from "../utils/nano-credit.util";
import { GPT26_GIF, normalizeGpt26FrameCount, normalizeGpt26FrameDurationMs, normalizeGpt26GifSize, buildGpt26GifParams } from "../utils/image-format";

// 1x1 PNG
const PNG_DATA_URL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("AnyfastGptImage2Adapter: 编辑输入仅接受 PNG/JPEG", () => {
    const adapter = new AnyfastGptImage2Adapter() as any;
    assert.doesNotThrow(() => adapter.assertEditInputMime("image/png"));
    assert.doesNotThrow(() => adapter.assertEditInputMime("image/jpeg"));
    assert.doesNotThrow(() => adapter.assertEditInputMime("image/jpg"));
    assert.throws(
        () => adapter.assertEditInputMime("image/webp"),
        (err: Error) => err.message.includes("PNG/JPEG")
    );
});

test("AnyfastGptImage2Adapter: buildEditForm 单图使用 image 字段", async () => {
    const adapter = new AnyfastGptImage2Adapter() as any;
    const { summary } = await adapter.buildEditForm(
        { prompt: "替换背景" },
        [PNG_DATA_URL],
        "gpt-image-2",
        1,
        "1024x1024",
        "png"
    );
    assert.equal(summary.image_field, "image");
    assert.equal(summary.reference_image_count, 1);
    assert.equal(summary.model, "gpt-image-2");
    assert.equal(summary.response_format, undefined);
});

test("AnyfastGptImage2Adapter: buildEditForm 多图使用 image[] 字段", async () => {
    const adapter = new AnyfastGptImage2Adapter() as any;
    const { summary } = await adapter.buildEditForm(
        { prompt: "合成图片" },
        [PNG_DATA_URL, PNG_DATA_URL],
        "gpt-image-2",
        1,
        "1024x1024",
        "png"
    );
    assert.equal(summary.image_field, "image[]");
    assert.equal(summary.reference_image_count, 2);
});

test("AnyfastGptImage2Adapter: buildEditForm gpt-image-2-c 设置 response_format=url", async () => {
    const adapter = new AnyfastGptImage2Adapter() as any;
    const { summary } = await adapter.buildEditForm(
        { prompt: "编辑图片" },
        [PNG_DATA_URL],
        "gpt-image-2-c",
        1,
        "1024x1024",
        "png"
    );
    assert.equal(summary.model, "gpt-image-2-c");
    assert.equal(summary.response_format, "url");
});

test("AnyfastGptImage2Adapter: generateImage 有参考图时走 edits 端点", async () => {
    const adapter = new AnyfastGptImage2Adapter() as any;
    let capturedEndpoint = "";
    adapter.postUpstream = async (endpoint: string) => {
        capturedEndpoint = endpoint;
        return { original_id: "test-id", images: ["/uploads/test.png"] };
    };

    await adapter.generateImage(
        {
            prompt: "编辑",
            imageUrl: PNG_DATA_URL,
            model: "gpt-image-2-c",
            size: "1024x1024",
        },
        "fake-key",
        ""
    );

    assert.match(capturedEndpoint, /\/v1\/images\/edits$/);
});

test("AnyfastGptImage2Adapter: generateImage 无参考图时走 generations 端点", async () => {
    const adapter = new AnyfastGptImage2Adapter() as any;
    let capturedEndpoint = "";
    adapter.postUpstream = async (endpoint: string) => {
        capturedEndpoint = endpoint;
        return { original_id: "test-id", images: ["/uploads/test.png"] };
    };

    await adapter.generateImage(
        {
            prompt: "文生图",
            model: "gpt-image-2",
            size: "1024x1024",
        },
        "fake-key",
        ""
    );

    assert.match(capturedEndpoint, /\/v1\/images\/generations$/);
});

test("AnyfastGptImage2Adapter: generateImage img2.5 无参考图时走 generations 并透传上游模型名", async () => {
    const adapter = new AnyfastGptImage2Adapter() as any;
    let capturedEndpoint = "";
    let capturedSummary: Record<string, unknown> | undefined;
    adapter.postUpstream = async (
        endpoint: string,
        _payload: unknown,
        _headers: unknown,
        _key: string,
        _mode: string,
        upstreamModel: string,
        requestSummary: Record<string, unknown>
    ) => {
        capturedEndpoint = endpoint;
        capturedSummary = { ...requestSummary, model: upstreamModel };
        return { original_id: "test-id", images: ["/uploads/test.png"] };
    };

    await adapter.generateImage(
        {
            prompt: "文生图",
            model: "gpt-image-2.5-sunburst",
            size: "1024x1024",
        },
        "fake-key",
        ""
    );

    assert.match(capturedEndpoint, /\/v1\/images\/generations$/);
    assert.equal(capturedSummary?.model, "gpt-image-2.5-sunburst");
});

test("AnyfastGptImage2Adapter: buildEditForm img2.5-fast 透传 flare 模型名", async () => {
    const adapter = new AnyfastGptImage2Adapter() as any;
    const { summary } = await adapter.buildEditForm(
        { prompt: "编辑图片" },
        [PNG_DATA_URL],
        "gpt-image-2.5-flare",
        1,
        "1024x1024",
        "png"
    );
    assert.equal(summary.model, "gpt-image-2.5-flare");
    assert.equal(summary.response_format, undefined);
});

// ---- GPT2.6 official 接入回归 ----
test("AceGptImage2Adapter: GPT2.6 映射到 :official 官方通道模型名", () => {
    const adapter = new AceGptImage2Adapter() as any;
    assert.equal(adapter.resolveUpstreamModel("gpt-image-2.6-flare"), "gpt-image-2.6-flare:official");
    assert.equal(adapter.resolveUpstreamModel("gpt-image-2.6-sunburst"), "gpt-image-2.6-sunburst:official");
});

test("AnyfastGptImage2Adapter: GPT2.6 透传模型名", async () => {
    const adapter = new AnyfastGptImage2Adapter() as any;
    const { summary } = await adapter.buildEditForm(
        { prompt: "编辑图片" },
        [PNG_DATA_URL],
        "gpt-image-2.6-flare",
        1,
        "1024x1024",
        "png"
    );
    assert.equal(summary.model, "gpt-image-2.6-flare");
});

test("GPT2.6 积分：low 10 / medium 14 / high 18，且不受渠道 hint 影响", () => {
    for (const model of ["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]) {
        assert.equal(calcNanoGenerateCredits({ model, quality: "low" }), 10);
        assert.equal(calcNanoGenerateCredits({ model, quality: "medium" }), 14);
        assert.equal(calcNanoGenerateCredits({ model, quality: "high" }), 18);
        assert.equal(calcNanoGenerateCredits({ model, quality: "high", imageCount: 2 }), 36);
        assert.equal(calcNanoGenerateCredits({ model, quality: "high", providerHint: "ace" }), 18);
    }
    assert.equal(buildCreditUsageApiType("nano", "gpt-image-2.6-flare", "ace"), "img2.6-fast");
    assert.equal(buildCreditUsageApiType("nano", "gpt-image-2.6-sunburst", "ace"), "img2.6");
});

test("GPT2.6 与 GPT2.6 pro 都禁用 AnyFast 兜底（两个模型必须同步）", () => {
    // image.service.ts 的 fallback 判断依赖此白名单；漏掉 sunburst 会让 pro 回退到无 2.6 渠道的 AnyFast
    assert.equal(isGptImage26Model("gpt-image-2.6-flare"), true);
    assert.equal(isGptImage26Model("gpt-image-2.6-sunburst"), true);
    assert.equal(isGptImage26Model("gpt-image-2.5-flare"), false);
    assert.equal(isGptImage26Model("gpt-image-2.5-sunburst"), false);
    assert.equal(isGptImage26Model("gpt-image-2"), false);
    assert.equal(isGptImage26Model(undefined), false);
});

// ---- GPT Image 2.6 原生 GIF 动图回归（上游文档规则）----
test("GIF 参数规则：帧数 2–16 默认 9，帧时长 10ms 取整默认 200，默认尺寸预设 512x512", () => {
    assert.equal(GPT26_GIF.DEFAULT_SIZE, "512x512");
    assert.equal(normalizeGpt26FrameCount(undefined), 9);
    assert.equal(normalizeGpt26FrameCount(1), 2);
    assert.equal(normalizeGpt26FrameCount(99), 16);
    assert.equal(normalizeGpt26FrameCount(7.6), 8);
    assert.equal(normalizeGpt26FrameDurationMs(undefined), 200);
    assert.equal(normalizeGpt26FrameDurationMs(5), 20);
    assert.equal(normalizeGpt26FrameDurationMs(203), 200);
    assert.deepEqual(buildGpt26GifParams({ frameCount: 12 }), {
        size: "512x512",
        frame_count: 12,
        frame_duration_ms: 200,
    });
});

test("GIF size 可显式指定：合法尺寸透传，省略/auto/非法/超预算回退 512x512 预设", () => {
    // 文档原文：「GIF 的 size 省略或为 auto 时使用 512x512 预设」——512 只是默认值，不是固定值
    assert.equal(normalizeGpt26GifSize(undefined), "512x512");
    assert.equal(normalizeGpt26GifSize("auto"), "512x512");
    assert.equal(normalizeGpt26GifSize("AUTO"), "512x512");
    assert.equal(normalizeGpt26GifSize("1024x1024"), "1024x1024"); // 文档已验证 2 帧可用
    assert.equal(normalizeGpt26GifSize("1024X768"), "1024x768");
    assert.equal(normalizeGpt26GifSize("512×512"), "512x512");
    assert.equal(normalizeGpt26GifSize("4K"), "512x512");          // 静态 4K 规格不能直接套用
    assert.equal(normalizeGpt26GifSize("4096x4096"), "512x512");   // 文档明确超出当前像素上限
    assert.equal(normalizeGpt26GifSize("64x9999"), "512x512");
    assert.deepEqual(buildGpt26GifParams({ size: "1024x1024", frameCount: 2 }), {
        size: "1024x1024",
        frame_count: 2,
        frame_duration_ms: 200,
    });
});

test("Ace / AnyFast 放行 output_format=gif，静态图仍拒绝 512x512（不改动既有尺寸规则）", () => {
    const ace = new AceGptImage2Adapter() as any;
    const af = new AnyfastGptImage2Adapter() as any;
    assert.equal(ace.normalizeOutputFormat("gif"), "gif");
    assert.equal(af.normalizeOutputFormat("gif"), "gif");
    assert.equal(af.normalizeEditOutputFormat("gif"), "gif");
    assert.equal(ace.normalizeOutputFormat("svg"), "png");
    assert.throws(
        () => ace.validateAndNormalizeSize("512x512", "1:1", "medium"),
        (err: Error) => err.message.includes("655360")
    );
    assert.throws(
        () => af.validateAndNormalizeSize("512x512", "1:1", "medium"),
        (err: Error) => err.message.includes("655360")
    );
});

test("AnyfastGptImage2Adapter: GIF 请求体带 512x512 预设 / frame_count / frame_duration_ms", () => {
    const adapter = new AnyfastGptImage2Adapter() as any;
    const body = adapter.buildGenerationBody(
        { prompt: "动图", frameCount: 12, frameDurationMs: 250 },
        "gpt-image-2.6-flare",
        1,
        "512x512",
        "medium",
        "gif",
        "auto"
    );
    assert.equal(body.output_format, "gif");
    assert.equal(body.size, "512x512");
    assert.equal(body.frame_count, 12);
    assert.equal(body.frame_duration_ms, 250);
    assert.equal(body.n, 1); // n 是返回的 GIF 文件数，不是动画帧数
});

test("AnyfastGptImage2Adapter: GIF 请求体可透传 1024x1024 自定义尺寸", () => {
    const adapter = new AnyfastGptImage2Adapter() as any;
    const body = adapter.buildGenerationBody(
        { prompt: "动图", size: "1024x1024", frameCount: 2 },
        "gpt-image-2.6-flare",
        1,
        "1024x1024",
        "medium",
        "gif",
        "auto"
    );
    assert.equal(body.size, "1024x1024");
    assert.equal(body.frame_count, 2);
    assert.equal(body.frame_duration_ms, 200);
});
