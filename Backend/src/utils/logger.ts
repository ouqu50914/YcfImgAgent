/**
 * 全局 console 时间戳包装。
 *
 * 在 index.ts 最顶部 import 一次即可让所有 console.log/warn/error/info/debug
 * 自动带上 [YYYY-MM-DD HH:mm:ss.SSS] 北京时间戳，便于按时间排查问题。
 *
 * 不用引入额外日志库：复用已安装的 dayjs（含 utc / timezone 插件）。
 * 可通过环境变量控制：
 *   LOG_TZ=Asia/Shanghai      时区（默认北京时间）
 *   LOG_TIMESTAMP=false        关闭时间戳（恢复原生 console 行为）
 */
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.LOG_TZ || "Asia/Shanghai";
const ENABLED = (process.env.LOG_TIMESTAMP ?? "true") !== "false";

function stamp(): string {
    return dayjs().tz(TZ).format("YYYY-MM-DD HH:mm:ss.SSS");
}

if (ENABLED) {
    const orig = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.debug.bind(console),
    };

    console.log = (...args: unknown[]) => orig.log(`[${stamp()}]`, ...args);
    console.info = (...args: unknown[]) => orig.info(`[${stamp()}]`, ...args);
    console.warn = (...args: unknown[]) => orig.warn(`[${stamp()}]`, ...args);
    console.error = (...args: unknown[]) => orig.error(`[${stamp()}]`, ...args);
    console.debug = (...args: unknown[]) => orig.debug(`[${stamp()}]`, ...args);
}

export {};
