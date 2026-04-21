import { AppDataSource } from "../data-source";
import { WorkflowTemplate } from "../entities/WorkflowTemplate";

/** 图片生成 api_type（image_result.api_type） */
const IMAGE_API_TYPES = new Set(["dream", "nano"]);

/** 视频生成 provider（video_task.provider） */
const VIDEO_PROVIDERS = new Set(["kling", "seedance", "pixverse"]);

function isImageApiType(p: string): boolean {
    return IMAGE_API_TYPES.has(p.trim().toLowerCase());
}

function isVideoProvider(p: string): boolean {
    return VIDEO_PROVIDERS.has(p.trim().toLowerCase());
}

/** 仅展示「项目仍存在」或「未关联项目」的记录；模板已删（含过期自动删）则 template_id 成孤儿，不展示 */
const IMAGE_TEMPLATE_EXISTS =
    "(ir.template_id IS NULL OR EXISTS (SELECT 1 FROM workflow_template wtpl WHERE wtpl.id = ir.template_id))";
const VIDEO_TEMPLATE_EXISTS =
    "(vt.template_id IS NULL OR EXISTS (SELECT 1 FROM workflow_template wtpl WHERE wtpl.id = vt.template_id))";

export interface GenerationRecordQuery {
    page?: number;
    pageSize?: number;
    from?: string;
    to?: string;
    kind?: "image" | "video" | "all";
    userId?: number;
    roleId?: number;
    templateId?: number;
    /** 模型/渠道：图片为 api_type（dream/nano），视频为 provider（kling/seedance/pixverse） */
    provider?: string;
}

export interface GenerationRecordRow {
    id: string;
    kind: "image" | "video";
    created_at: Date;
    user_id: number;
    username: string;
    user_role_id: number;
    /** 图片：dream/nano；视频：provider */
    model_or_provider: string;
    type_label: string;
    credits_spent: number | null;
    generation_duration_ms: number | null;
    status: string;
    prompt: string | null;
    result_urls: string[];
    template_id: number | null;
}

export class GenerationRecordService {
    private templateRepo = AppDataSource.getRepository(WorkflowTemplate);

    async assertCanUseTemplateFilter(viewerId: number, isSuperAdmin: boolean, templateId: number): Promise<void> {
        const t = await this.templateRepo.findOne({
            where: { id: templateId },
            select: ["id", "user_id"],
        });
        if (!t) {
            throw Object.assign(new Error("项目不存在"), { status: 404 });
        }
        if (!isSuperAdmin && Number(t.user_id) !== Number(viewerId)) {
            throw Object.assign(new Error("无权按该项目筛选"), { status: 403 });
        }
    }

    private imageStatusLabel(s: number): string {
        if (s === 0) return "进行中";
        if (s === 1) return "成功";
        if (s === 2) return "失败";
        return String(s);
    }

    private parseImageUrls(imageUrl: string | null, allImagesJson: string | null): string[] {
        const out: string[] = [];
        if (imageUrl && typeof imageUrl === "string" && imageUrl.trim()) {
            out.push(imageUrl.trim());
        }
        if (allImagesJson && typeof allImagesJson === "string") {
            try {
                const parsed = JSON.parse(allImagesJson);
                if (Array.isArray(parsed)) {
                    for (const u of parsed) {
                        if (typeof u === "string" && u.trim() && !out.includes(u.trim())) {
                            out.push(u.trim());
                        }
                    }
                }
            } catch {
                // ignore
            }
        }
        return out;
    }

    private parseVideoUrls(raw: unknown): string[] {
        if (raw == null) return [];
        if (Array.isArray(raw)) {
            return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
        }
        if (typeof raw === "string") {
            try {
                const j = JSON.parse(raw);
                if (Array.isArray(j)) {
                    return j.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
                }
            } catch {
                // ignore
            }
        }
        return [];
    }

    private buildImageWhere(
        isSuperAdmin: boolean,
        viewerUserId: number,
        q: GenerationRecordQuery
    ): { clause: string; params: unknown[] } {
        const parts = ["1=1"];
        const params: unknown[] = [];
        if (!isSuperAdmin) {
            parts.push("ir.user_id = ?");
            params.push(viewerUserId);
        } else if (q.userId != null && q.userId > 0) {
            parts.push("ir.user_id = ?");
            params.push(q.userId);
        }
        if (isSuperAdmin && (q.roleId === 1 || q.roleId === 2)) {
            parts.push("u.role_id = ?");
            params.push(q.roleId);
        }
        if (q.from) {
            parts.push("ir.created_at >= ?");
            params.push(q.from);
        }
        if (q.to) {
            parts.push("ir.created_at <= ?");
            params.push(q.to);
        }
        if (q.templateId != null && q.templateId > 0) {
            parts.push("ir.template_id = ?");
            params.push(q.templateId);
        }
        if (q.provider && typeof q.provider === "string" && q.provider.trim()) {
            const p = q.provider.trim();
            if (isImageApiType(p)) {
                parts.push("ir.api_type = ?");
                params.push(p.toLowerCase());
            } else {
                parts.push("1=0");
            }
        }
        parts.push(IMAGE_TEMPLATE_EXISTS);
        return { clause: parts.join(" AND "), params };
    }

    private buildVideoWhere(
        isSuperAdmin: boolean,
        viewerUserId: number,
        q: GenerationRecordQuery
    ): { clause: string; params: unknown[] } {
        const parts = ["1=1"];
        const params: unknown[] = [];
        if (!isSuperAdmin) {
            parts.push("vt.user_id = ?");
            params.push(viewerUserId);
        } else if (q.userId != null && q.userId > 0) {
            parts.push("vt.user_id = ?");
            params.push(q.userId);
        }
        if (isSuperAdmin && (q.roleId === 1 || q.roleId === 2)) {
            parts.push("u2.role_id = ?");
            params.push(q.roleId);
        }
        if (q.from) {
            parts.push("vt.created_at >= ?");
            params.push(q.from);
        }
        if (q.to) {
            parts.push("vt.created_at <= ?");
            params.push(q.to);
        }
        if (q.templateId != null && q.templateId > 0) {
            parts.push("vt.template_id = ?");
            params.push(q.templateId);
        }
        if (q.provider && typeof q.provider === "string" && q.provider.trim()) {
            const p = q.provider.trim();
            if (isVideoProvider(p)) {
                parts.push("vt.provider = ?");
                params.push(p.toLowerCase());
            } else {
                parts.push("1=0");
            }
        }
        parts.push(VIDEO_TEMPLATE_EXISTS);
        return { clause: parts.join(" AND "), params };
    }

    async list(viewerUserId: number, isSuperAdmin: boolean, q: GenerationRecordQuery) {
        const page = Math.max(1, Number(q.page) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
        const kind = q.kind === "image" || q.kind === "video" ? q.kind : "all";

        if (q.templateId != null && q.templateId > 0) {
            await this.assertCanUseTemplateFilter(viewerUserId, isSuperAdmin, q.templateId);
        }

        const imgW = this.buildImageWhere(isSuperAdmin, viewerUserId, q);
        const vidW = this.buildVideoWhere(isSuperAdmin, viewerUserId, q);

        let countSql: string;
        let countParams: unknown[];

        if (kind === "image") {
            countSql = `
        SELECT COUNT(*) AS cnt FROM image_result ir
        INNER JOIN sys_user u ON u.id = ir.user_id
        WHERE ${imgW.clause}`;
            countParams = [...imgW.params];
        } else if (kind === "video") {
            countSql = `
        SELECT COUNT(*) AS cnt FROM video_task vt
        INNER JOIN sys_user u2 ON u2.id = vt.user_id
        WHERE ${vidW.clause}`;
            countParams = [...vidW.params];
        } else {
            countSql = `
        SELECT COUNT(*) AS cnt FROM (
          SELECT ir.id FROM image_result ir INNER JOIN sys_user u ON u.id = ir.user_id WHERE ${imgW.clause}
          UNION ALL
          SELECT vt.id FROM video_task vt INNER JOIN sys_user u2 ON u2.id = vt.user_id WHERE ${vidW.clause}
        ) c`;
            countParams = [...imgW.params, ...vidW.params];
        }

        const countRows = await AppDataSource.query(countSql, countParams);
        const total = Number(countRows?.[0]?.cnt ?? 0);

        const offset = (page - 1) * pageSize;
        let listSql: string;
        let listParams: unknown[];

        if (kind === "image") {
            listSql = `
        SELECT ir.id AS eid, 'image' AS kind, ir.created_at AS sort_at,
          ir.user_id AS user_id, u.username AS username, u.role_id AS user_role_id,
          ir.api_type AS model_or_provider, COALESCE(ir.operation_type, 'generate') AS op_type,
          ir.status AS image_status, ir.credits_spent AS credits_spent, ir.template_id AS template_id,
          (
            SELECT MAX(ol.created_at)
            FROM operation_log ol
            WHERE ol.user_id = ir.user_id
              AND ol.operation_type = 'generate'
              AND CAST(JSON_UNQUOTE(JSON_EXTRACT(ol.details, '$.imageId')) AS UNSIGNED) = ir.id
          ) AS image_echo_at,
          NULL AS video_finished_at,
          ir.prompt AS prompt_text, ir.image_url AS image_url, ir.all_images AS all_images_json,
          CAST(NULL AS CHAR) AS video_type, CAST(NULL AS CHAR) AS video_status_str, CAST(NULL AS CHAR) AS video_urls_json
        FROM image_result ir
        INNER JOIN sys_user u ON u.id = ir.user_id
        WHERE ${imgW.clause}
        ORDER BY ir.created_at DESC
        LIMIT ? OFFSET ?`;
            listParams = [...imgW.params, pageSize, offset];
        } else if (kind === "video") {
            listSql = `
        SELECT vt.id AS eid, 'video' AS kind, vt.created_at AS sort_at,
          vt.user_id AS user_id, u2.username AS username, u2.role_id AS user_role_id,
          vt.provider AS model_or_provider, vt.type AS op_type,
          NULL AS image_status, vt.credits_spent AS credits_spent, vt.template_id AS template_id,
          NULL AS image_echo_at,
          vt.finished_at AS video_finished_at,
          CAST(vt.request_params AS CHAR) AS prompt_text, CAST(NULL AS CHAR) AS image_url, CAST(NULL AS CHAR) AS all_images_json,
          vt.type AS video_type, vt.status AS video_status_str, CAST(vt.video_urls AS CHAR) AS video_urls_json
        FROM video_task vt
        INNER JOIN sys_user u2 ON u2.id = vt.user_id
        WHERE ${vidW.clause}
        ORDER BY vt.created_at DESC
        LIMIT ? OFFSET ?`;
            listParams = [...vidW.params, pageSize, offset];
        } else {
            // UNION ALL 两侧字符串列必须同 collation，否则 MySQL 报 Illegal mix of collations
            const sqlU8 = (expr: string) => `CONVERT(${expr} USING utf8mb4) COLLATE utf8mb4_unicode_ci`;
            listSql = `
        SELECT * FROM (
          SELECT ir.id AS eid, 'image' COLLATE utf8mb4_unicode_ci AS kind, ir.created_at AS sort_at,
            ir.user_id AS user_id, ${sqlU8("u.username")} AS username, u.role_id AS user_role_id,
            ${sqlU8("ir.api_type")} AS model_or_provider, ${sqlU8("COALESCE(ir.operation_type, 'generate')")} AS op_type,
            ir.status AS image_status, ir.credits_spent AS credits_spent, ir.template_id AS template_id,
            (
              SELECT MAX(ol.created_at)
              FROM operation_log ol
              WHERE ol.user_id = ir.user_id
                AND ol.operation_type = 'generate'
                AND CAST(JSON_UNQUOTE(JSON_EXTRACT(ol.details, '$.imageId')) AS UNSIGNED) = ir.id
            ) AS image_echo_at,
            NULL AS video_finished_at,
            ${sqlU8("ir.prompt")} AS prompt_text, ${sqlU8("ir.image_url")} AS image_url, ${sqlU8("ir.all_images")} AS all_images_json,
            ${sqlU8("CAST(NULL AS CHAR)")} AS video_type, ${sqlU8("CAST(NULL AS CHAR)")} AS video_status_str, ${sqlU8("CAST(NULL AS CHAR)")} AS video_urls_json
          FROM image_result ir
          INNER JOIN sys_user u ON u.id = ir.user_id
          WHERE ${imgW.clause}
          UNION ALL
          SELECT vt.id AS eid, 'video' COLLATE utf8mb4_unicode_ci AS kind, vt.created_at AS sort_at,
            vt.user_id AS user_id, ${sqlU8("u2.username")} AS username, u2.role_id AS user_role_id,
            ${sqlU8("vt.provider")} AS model_or_provider, ${sqlU8("vt.type")} AS op_type,
            NULL AS image_status, vt.credits_spent AS credits_spent, vt.template_id AS template_id,
            NULL AS image_echo_at,
            vt.finished_at AS video_finished_at,
            ${sqlU8("CAST(vt.request_params AS CHAR)")} AS prompt_text, ${sqlU8("CAST(NULL AS CHAR)")} AS image_url, ${sqlU8("CAST(NULL AS CHAR)")} AS all_images_json,
            ${sqlU8("vt.type")} AS video_type, ${sqlU8("vt.status")} AS video_status_str, ${sqlU8("CAST(vt.video_urls AS CHAR)")} AS video_urls_json
          FROM video_task vt
          INNER JOIN sys_user u2 ON u2.id = vt.user_id
          WHERE ${vidW.clause}
        ) merged
        ORDER BY merged.sort_at DESC
        LIMIT ? OFFSET ?`;
            listParams = [...imgW.params, ...vidW.params, pageSize, offset];
        }

        const raw = await AppDataSource.query(listSql, listParams);

        const items: GenerationRecordRow[] = (raw as any[]).map((row) => {
            const kindRaw = row.kind;
            const kindRow = (typeof kindRaw === "string" ? kindRaw : String(kindRaw ?? "")).trim() as "image" | "video";
            let prompt: string | null =
                row.prompt_text != null && String(row.prompt_text).trim() ? String(row.prompt_text).trim() : null;
            if (kindRow === "video" && prompt && prompt.startsWith("{")) {
                try {
                    const o = JSON.parse(prompt);
                    if (o && typeof o.prompt === "string") {
                        prompt = o.prompt;
                    }
                } catch {
                    // keep raw
                }
            }
            let result_urls: string[] = [];
            let statusStr = "";
            let typeLabel = "";
            const sortAtMs = new Date(row.sort_at).getTime();
            const endAtRaw = kindRow === "image" ? row.image_echo_at : row.video_finished_at;
            let generationDurationMs: number | null = null;
            if (endAtRaw != null) {
                const endAtMs = new Date(endAtRaw).getTime();
                if (Number.isFinite(sortAtMs) && Number.isFinite(endAtMs)) {
                    generationDurationMs = Math.max(0, Math.round(endAtMs - sortAtMs));
                }
            }
            if (kindRow === "image") {
                result_urls = this.parseImageUrls(row.image_url, row.all_images_json);
                statusStr = this.imageStatusLabel(Number(row.image_status));
                const op = String(row.op_type || "generate");
                typeLabel = `图片 · ${op}`;
            } else {
                result_urls = this.parseVideoUrls(row.video_urls_json);
                statusStr = String(row.video_status_str || "pending");
                typeLabel = `视频 · ${String(row.model_or_provider || "")} · ${String(row.video_type || row.op_type || "")}`;
            }
            return {
                id: `${kindRow}-${row.eid}`,
                kind: kindRow,
                created_at: row.sort_at,
                user_id: Number(row.user_id),
                username: String(row.username || ""),
                user_role_id: Number(row.user_role_id),
                model_or_provider: String(row.model_or_provider || ""),
                type_label: typeLabel,
                credits_spent: row.credits_spent != null ? Number(row.credits_spent) : null,
                generation_duration_ms: generationDurationMs,
                status: statusStr,
                prompt,
                result_urls,
                template_id: row.template_id != null ? Number(row.template_id) : null,
            };
        });

        return {
            items,
            total,
            page,
            pageSize,
        };
    }
}
