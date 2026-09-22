import path from "path";
import fs from "fs";
import crypto from "crypto";
import { spawnSync } from "child_process";
import dotenv from "dotenv";
import axios from "axios";

process.env.USE_COS = "false";
dotenv.config({ path: path.join(__dirname, "../.env") });

const PROMPT =
    "一只橙色虎斑猫坐在青瓷花瓶旁，窗边午后阳光，写实摄影，浅景深，画面干净，无文字无水印";
const SIZE = "1776x1776";
const QUALITY = "high"; // 用 high 更容易看出被降到 medium/low
const OUT_DIR = path.join(__dirname, "compare-out");
const META_DIR = path.join(OUT_DIR, "diag-meta");

function keyTag(key: string): string {
    if (!key) return "missing";
    return `len=${key.length},tail=${key.slice(-4)}`;
}

function bodyHash(body: Record<string, unknown>): string {
    return crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
}

function pngSize(buf: Buffer): { w: number; h: number } | null {
    if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function jpegSize(buf: Buffer): { w: number; h: number } | null {
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i < buf.length - 8) {
        if (buf[i] !== 0xff) {
            i += 1;
            continue;
        }
        const marker = buf[i + 1];
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
            return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        const len = buf.readUInt16BE(i + 2);
        i += 2 + len;
    }
    return null;
}

function imageInfo(buf: Buffer) {
    const dim = pngSize(buf) || jpegSize(buf);
    return {
        bytes: buf.length,
        width: dim?.w || 0,
        height: dim?.h || 0,
        format: pngSize(buf) ? "png" : jpegSize(buf) ? "jpeg" : "unknown",
    };
}

function curlTiming(url: string) {
    const r = spawnSync("curl", [
        "-sS", "-o", "/dev/null",
        "-m", "20",
        "-w", "%{http_code} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} ip=%{remote_ip} err=%{errormsg}",
        url,
    ], { encoding: "utf8" });
    return {
        url,
        ok: r.status === 0,
        status: r.status,
        stdout: (r.stdout || "").trim(),
        stderr: (r.stderr || "").trim().slice(0, 300),
    };
}

function pickUsage(data: any) {
    const usage = data?.usage;
    return {
        response_model: data?.model,
        response_quality: data?.quality,
        response_size: data?.size,
        response_output_format: data?.output_format,
        response_background: data?.background,
        cost: data?.cost,
        elapsed: data?.elapsed,
        usage,
        input_tokens: usage?.input_tokens ?? usage?.prompt_tokens,
        output_tokens: usage?.output_tokens ?? usage?.completion_tokens,
        total_tokens: usage?.total_tokens,
        output_tokens_details: usage?.output_tokens_details,
        quality_echo_match: data?.quality == null ? "not_echoed" : (data.quality === QUALITY ? "ok" : "TAMPERED_OR_DOWNRANKED"),
        size_echo_match: data?.size == null ? "not_echoed" : (data.size === SIZE ? "ok" : "TAMPERED_OR_DOWNRANKED"),
    };
}

async function downloadImage(url: string): Promise<Buffer> {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 120000, proxy: false });
    return Buffer.from(res.data);
}

type RunSpec = {
    label: string;
    hypothesis: "baseline_official" | "same_key_other_line" | "same_line_other_key" | "other_gateway";
    endpoint: string;
    keyName: string;
    key: string;
    body: Record<string, unknown>;
};

async function runDirect(spec: RunSpec) {
    const started = Date.now();
    const t0 = Date.now();
    try {
        const res = await axios.post(spec.endpoint, spec.body, {
            timeout: 180000,
            proxy: false,
            headers: {
                Authorization: `Bearer ${spec.key}`,
                "Content-Type": "application/json",
            },
        });
        const ttfbish = Date.now() - t0;
        const data = res.data;
        const items = Array.isArray(data?.data) ? data.data : [];
        const urls = items.map((it: any) => it?.url).filter((u: unknown) => typeof u === "string");
        const b64s = items.map((it: any) => it?.b64_json).filter((u: unknown) => typeof u === "string");
        let buf: Buffer | null = null;
        if (b64s[0]) buf = Buffer.from(b64s[0], "base64");
        else if (urls[0]) buf = await downloadImage(urls[0]);
        const echo = pickUsage(data);
        let info = { bytes: 0, width: 0, height: 0, format: "none" as string };
        let file: string | undefined;
        if (buf) {
            info = imageInfo(buf);
            fs.mkdirSync(OUT_DIR, { recursive: true });
            const ext = info.format === "jpeg" ? "jpg" : "png";
            file = path.join(OUT_DIR, `${spec.label}.${ext}`);
            fs.writeFileSync(file, buf);
        }
        const verdict = {
            resolution_ok: info.width === 1776 && info.height === 1776,
            quality_echo: echo.quality_echo_match,
            size_echo: echo.size_echo_match,
            likely:
                echo.quality_echo_match === "TAMPERED_OR_DOWNRANKED" || echo.size_echo_match === "TAMPERED_OR_DOWNRANKED"
                    ? "param_tamper_or_key_downrank"
                    : info.width > 0 && info.width < 1776
                        ? "key_downrank_or_resize"
                        : "line_or_sampling",
        };
        const row = {
            ok: !!buf,
            label: spec.label,
            hypothesis: spec.hypothesis,
            latency_ms: Date.now() - started,
            http_ms: ttfbish,
            endpoint: spec.endpoint,
            key: spec.keyName,
            key_tag: keyTag(spec.key),
            request_model: spec.body.model,
            request_quality: spec.body.quality,
            request_size: spec.body.size,
            body_hash: bodyHash({ ...spec.body, model: "NORMALIZED" }),
            via: b64s[0] ? "b64_json" : urls[0] ? "url" : "empty",
            url_host: urls[0] ? (() => { try { return new URL(urls[0]).host; } catch { return "bad_url"; } })() : undefined,
            file,
            ...info,
            ...echo,
            verdict,
            response_id: data?.id || data?.task_id,
        };
        fs.mkdirSync(META_DIR, { recursive: true });
        fs.writeFileSync(path.join(META_DIR, `${spec.label}.json`), JSON.stringify(row, null, 2));
        console.log(JSON.stringify(row));
        return row;
    } catch (e: any) {
        const status = e?.response?.status;
        const responseData = e?.response?.data;
        const row = {
            ok: false,
            label: spec.label,
            hypothesis: spec.hypothesis,
            latency_ms: Date.now() - started,
            endpoint: spec.endpoint,
            key: spec.keyName,
            key_tag: keyTag(spec.key),
            request_model: spec.body.model,
            status,
            code: e?.code,
            error: responseData?.error?.message || responseData?.message || e?.message,
            response_data: responseData,
            networkish: !e?.response && (e?.code === "ECONNABORTED" || e?.code === "ENOTFOUND" || e?.code === "ECONNRESET" || e?.code === "ETIMEDOUT"),
        };
        fs.mkdirSync(META_DIR, { recursive: true });
        fs.writeFileSync(path.join(META_DIR, `${spec.label}.json`), JSON.stringify(row, null, 2));
        console.log(JSON.stringify(row));
        return row;
    }
}

async function main() {
    const keys = {
        ACE_IMG2_API_KEY: process.env.ACE_IMG2_API_KEY || "",
        ACE_API_KEY: process.env.ACE_API_KEY || "",
        GPT_IMG2_API_KEY: process.env.GPT_IMG2_API_KEY || "",
        ANYFAST_API_KEY: process.env.ANYFAST_API_KEY || "",
    };
    const aceBase = (process.env.ACE_IMG2_BASE_URL || "https://api.acedata.cloud/openai/images").replace(/\/$/, "");
    const afBase = (process.env.GPT_IMG2_BASE_URL || "https://www.anyfast.ai").replace(/\/$/, "");

    const common: Record<string, unknown> = {
        prompt: `${PROMPT}。输出尺寸：${SIZE}。`,
        n: 1,
        size: SIZE,
        quality: QUALITY,
        output_format: "png",
        moderation: "auto",
    };

    console.log(JSON.stringify({
        phase: "network",
        probes: [
            curlTiming("https://api.acedata.cloud/"),
            curlTiming("https://api.acedata.cloud/openai/images/generations"),
            curlTiming(afBase + "/"),
            curlTiming(afBase + "/v1/images/generations"),
        ],
    }));

    const specs: RunSpec[] = [
        {
            label: "A-ace-official-img2key",
            hypothesis: "baseline_official",
            endpoint: `${aceBase}/generations`,
            keyName: "ACE_IMG2_API_KEY",
            key: keys.ACE_IMG2_API_KEY,
            body: { ...common, model: "gpt-image-2.5-flare:official" },
        },
        {
            label: "B-ace-reverse-img2key",
            hypothesis: "same_key_other_line",
            endpoint: `${aceBase}/generations`,
            keyName: "ACE_IMG2_API_KEY",
            key: keys.ACE_IMG2_API_KEY,
            body: { ...common, model: "gpt-image-2.5-flare:reverse" },
        },
        {
            label: "C-ace-official-apikey",
            hypothesis: "same_line_other_key",
            endpoint: `${aceBase}/generations`,
            keyName: "ACE_API_KEY",
            key: keys.ACE_API_KEY,
            body: { ...common, model: "gpt-image-2.5-flare:official" },
        },
        {
            label: "D-anyfast-gptimg2key",
            hypothesis: "other_gateway",
            endpoint: `${afBase}/v1/images/generations`,
            keyName: "GPT_IMG2_API_KEY",
            key: keys.GPT_IMG2_API_KEY,
            body: { ...common, model: "gpt-image-2.5-flare" },
        },
    ];

    console.log(JSON.stringify({
        phase: "plan",
        quality: QUALITY,
        size: SIZE,
        body_hash_without_model: bodyHash(common),
        keys: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, keyTag(v)])),
        matrix: [
            "A 官转基线：Ace :official + ACE_IMG2",
            "B 同 Key 换线路：Ace :reverse + ACE_IMG2 → 差在线路不是 Key",
            "C 同线路换 Key：Ace :official + ACE_API_KEY → 差在 Key 降权",
            "D 转 API：AnyFast 同参数 → 网关/参数回写",
        ],
    }));

    const rows = [];
    for (const spec of specs) {
        rows.push(await runDirect(spec));
    }

    const a: any = rows.find((r: any) => r.label?.startsWith("A-"));
    const b: any = rows.find((r: any) => r.label?.startsWith("B-"));
    const c: any = rows.find((r: any) => r.label?.startsWith("C-"));
    const d: any = rows.find((r: any) => r.label?.startsWith("D-"));
    const locate = {
        param_tamper:
            [a, b, c, d].some((r: any) => r?.quality_echo_match === "TAMPERED_OR_DOWNRANKED" || r?.size_echo_match === "TAMPERED_OR_DOWNRANKED")
                ? "YES: 响应 quality/size 与请求不一致"
                : "NO: 有回写的渠道均匹配 high/1776x1776；无回写则看像素",
        key_downrank:
            a?.ok && c?.ok && a?.width === c?.width && a?.response_quality === c?.response_quality
                ? (a?.output_tokens && c?.output_tokens && a.output_tokens !== c.output_tokens
                    ? "POSSIBLE: 同线路不同 Key 的 usage/token 不同"
                    : "UNLIKELY: 同 official 两条 Key 分辨率/回写质量一致")
                : (c?.ok === false && a?.ok ? "C Key 失败，可能无权限/欠费，不是画质降权" : "see rows"),
        network:
            rows.some((r: any) => r.networkish)
                ? "YES: 存在超时/DNS/连接重置"
                : "UNLIKELY: 四格均完成 HTTP；若仅延迟高看 latency_ms",
        line_sampling:
            a?.ok && b?.ok
                ? "Ace official vs reverse 已出图，构图差属于线路抽样"
                : (b?.ok === false ? "reverse 线路不可用或模型名不被接受" : "see B"),
        anyfast_vs_official: d?.ok && a?.ok
            ? `D ${d.width}x${d.height} q=${d.response_quality || "no_echo"} tokens=${d.output_tokens}; A ${a.width}x${a.height} q=${a.response_quality || "no_echo"} tokens=${a.output_tokens}`
            : "see A/D",
    };
    console.log(JSON.stringify({ phase: "locate", locate }));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
