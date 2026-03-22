import { spawnSync } from "child_process";

const MAX_FRAMES_PER_VIDEO = 4;
const MAX_FRAME_BYTES = 900 * 1024;
const FFMPEG_TIMEOUT_MS = 120_000;

function binOk(name: string): boolean {
    const r = spawnSync(name, ["-version"], { encoding: "utf8", timeout: 5000 });
    return r.status === 0;
}

/** 默认关闭：视频识别走 Generate Content 的 file_uri，不转图片。仅当显式设为 true 时才截帧走 chat/completions */
export function isFfmpegVideoFramesEnabled(): boolean {
    if (process.env.GEMINI_VIDEO_USE_FFMPEG !== "true") return false;
    return binOk("ffmpeg") && binOk("ffprobe");
}

/**
 * 用 ffprobe 获取远程视频时长（秒），失败返回 null
 */
function probeDurationSec(videoUrl: string): number | null {
    const r = spawnSync(
        "ffprobe",
        [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            videoUrl,
        ],
        { encoding: "utf8", timeout: 45000, maxBuffer: 1024 * 1024 }
    );
    if (r.status !== 0 || !r.stdout) return null;
    const n = parseFloat(String(r.stdout).trim());
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

/**
 * 在指定时刻截取一帧 JPEG 到内存（pipe）
 */
function grabJpegFrameAtSec(videoUrl: string, sec: number): Buffer | null {
    const r = spawnSync(
        "ffmpeg",
        [
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            String(Math.max(0, sec)),
            "-i",
            videoUrl,
            "-frames:v",
            "1",
            "-vf",
            "scale=w=min(768\\,iw):h=-2",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "-q:v",
            "4",
            "pipe:1",
        ],
        { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: MAX_FRAME_BYTES * 2 }
    );
    if (r.status !== 0 || !r.stdout || r.stdout.length === 0) return null;
    const buf = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout);
    if (buf.length > MAX_FRAME_BYTES) return null;
    return buf;
}

/**
 * 从单个视频 URL 抽取若干关键帧（JPEG），用于走 chat/completions 的 image_url 多模态。
 */
export function extractVideoKeyFramesJpeg(videoUrl: string): Buffer[] {
    if (!isFfmpegVideoFramesEnabled()) return [];

    const duration = probeDurationSec(videoUrl);
    let timesSec: number[];
    if (duration != null && duration > 1) {
        timesSec = [0.08, 0.32, 0.58, 0.82].map((r) => Math.min(duration * r, Math.max(0, duration - 0.2)));
    } else {
        timesSec = [0.5, 2, 5, 12];
    }

    const out: Buffer[] = [];
    const seen = new Set<string>();
    for (const t of timesSec) {
        if (out.length >= MAX_FRAMES_PER_VIDEO) break;
        const key = t.toFixed(2);
        if (seen.has(key)) continue;
        seen.add(key);
        const buf = grabJpegFrameAtSec(videoUrl, t);
        if (buf && buf.length > 0) out.push(buf);
    }
    return out;
}
