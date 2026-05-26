import test from "node:test";
import assert from "node:assert/strict";
import { AnyfastGptImage2Adapter } from "../adapters/anyfast-gpt-image2.adapter";

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
