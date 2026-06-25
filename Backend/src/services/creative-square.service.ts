import { AppDataSource } from "../data-source";
import { WorkflowTemplate } from "../entities/WorkflowTemplate";
import { User } from "../entities/User";
import { getLastImageFromWorkflowData, parseWorkflowData } from "../utils/workflow-cover.util";

export type ProjectSource = 'template' | 'history';

export interface CreativeSquareProject {
    id: number;
    source: ProjectSource;
    name: string;
    cover_image?: string | undefined;
    updated_at: string;
    user_id: number;
}

export interface CreativeSquareMemberProject extends Omit<CreativeSquareProject, 'user_id'> {
    is_own: boolean;
}

export interface CreativeSquareMember {
    user_id: number;
    username: string;
    latest_project: Omit<CreativeSquareProject, 'user_id'>;
    project_count: number;
}

interface TemplateListRow {
    id: number;
    user_id: number;
    name: string;
    cover_image?: string | null;
    updated_at: Date;
    created_at: Date;
}

interface HistoryListRow {
    id: number;
    user_id: number;
    template_id?: number | null;
    snapshot_name?: string | null;
    cover_image?: string | null;
    updated_at: Date;
    created_at: Date;
}

export class CreativeSquareService {
    private templateRepo = AppDataSource.getRepository(WorkflowTemplate);
    private userRepo = AppDataSource.getRepository(User);

    /** 列表查询：不加载 workflow_data 大字段 */
    private async getActiveTemplatesForList(userId?: number): Promise<TemplateListRow[]> {
        const now = new Date();
        const qb = this.templateRepo
            .createQueryBuilder('t')
            .select([
                't.id',
                't.user_id',
                't.name',
                't.cover_image',
                't.updated_at',
                't.created_at',
            ])
            .where('t.expires_at IS NULL OR t.expires_at > :now', { now });

        if (userId != null) {
            qb.andWhere('t.user_id = :userId', { userId });
        }

        return qb.orderBy('t.updated_at', 'DESC').getMany();
    }

    /** 列表查询：用 JSON_EXTRACT 取封面，不加载完整 workflow_data */
    private async getHistoriesForList(userId?: number): Promise<HistoryListRow[]> {
        const params: unknown[] = [];
        let sql = `
            SELECT
                h.id,
                h.user_id,
                h.template_id,
                h.snapshot_name,
                h.updated_at,
                h.created_at,
                JSON_UNQUOTE(JSON_EXTRACT(h.workflow_data, '$.cover_image')) AS cover_image
            FROM workflow_history h
        `;
        if (userId != null) {
            sql += ' WHERE h.user_id = ?';
            params.push(userId);
        }
        sql += ' ORDER BY h.updated_at DESC, h.created_at DESC';

        const rows = await AppDataSource.query(sql, params) as Array<{
            id: string | number;
            user_id: string | number;
            template_id?: string | number | null;
            snapshot_name?: string | null;
            cover_image?: string | null;
            updated_at: Date | string;
            created_at: Date | string;
        }>;

        return rows.map((row) => ({
            id: Number(row.id),
            user_id: Number(row.user_id),
            template_id: row.template_id != null ? Number(row.template_id) : null,
            snapshot_name: row.snapshot_name ?? null,
            cover_image: row.cover_image || null,
            updated_at: new Date(row.updated_at),
            created_at: new Date(row.created_at),
        }));
    }

    private templateToProject(t: TemplateListRow): CreativeSquareProject {
        return {
            id: Number(t.id),
            source: 'template',
            name: t.name || '未命名工作流',
            ...(t.cover_image ? { cover_image: t.cover_image } : {}),
            updated_at: (t.updated_at || t.created_at).toISOString(),
            user_id: Number(t.user_id),
        };
    }

    private historyToProject(h: HistoryListRow): CreativeSquareProject {
        return {
            id: Number(h.id),
            source: 'history',
            name: h.snapshot_name || '自动保存工作流',
            ...(h.cover_image ? { cover_image: h.cover_image } : {}),
            updated_at: (h.updated_at || h.created_at).toISOString(),
            user_id: Number(h.user_id),
        };
    }

    private buildUserProjects(
        userId: number,
        templates: TemplateListRow[],
        histories: HistoryListRow[]
    ): CreativeSquareProject[] {
        const userTemplates = templates.filter((t) => Number(t.user_id) === userId);
        const userHistories = histories.filter((h) => Number(h.user_id) === userId);

        const projects: CreativeSquareProject[] = userTemplates.map((t) => this.templateToProject(t));

        const unboundHistories = userHistories.filter((h) => h.template_id == null);
        const grouped: Record<string, HistoryListRow> = {};
        for (const h of unboundHistories) {
            const cover = h.cover_image || `history_${h.id}`;
            const existing = grouped[cover];
            if (!existing) {
                grouped[cover] = h;
                continue;
            }
            const existingTime = new Date(existing.updated_at || existing.created_at).getTime();
            const currentTime = new Date(h.updated_at || h.created_at).getTime();
            if (currentTime > existingTime) {
                grouped[cover] = h;
            }
        }

        for (const h of Object.values(grouped)) {
            projects.push(this.historyToProject(h));
        }

        projects.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        return projects;
    }

    private async buildMembersFromData(
        templates: TemplateListRow[],
        histories: HistoryListRow[],
        activeUsers: Array<Pick<User, 'id' | 'username'>>
    ): Promise<{ list: CreativeSquareMember[] }> {
        const userMap = new Map<number, string>();
        for (const u of activeUsers) {
            userMap.set(Number(u.id), u.username);
        }

        const userIds = new Set<number>();
        for (const t of templates) userIds.add(Number(t.user_id));
        for (const h of histories) userIds.add(Number(h.user_id));

        const members: CreativeSquareMember[] = [];
        for (const userId of userIds) {
            if (!userMap.has(userId)) continue;
            const projects = this.buildUserProjects(userId, templates, histories);
            if (projects.length === 0) continue;

            const latest = projects[0]!;
            members.push({
                user_id: userId,
                username: userMap.get(userId)!,
                latest_project: {
                    id: latest.id,
                    source: latest.source,
                    name: latest.name,
                    ...(latest.cover_image ? { cover_image: latest.cover_image } : {}),
                    updated_at: latest.updated_at,
                },
                project_count: projects.length,
            });
        }

        members.sort(
            (a, b) =>
                new Date(b.latest_project.updated_at).getTime() -
                new Date(a.latest_project.updated_at).getTime()
        );

        return { list: members };
    }

    /** 获取创意广场成员列表 */
    async getMembers(): Promise<{ list: CreativeSquareMember[] }> {
        const [templates, histories, activeUsers] = await Promise.all([
            this.getActiveTemplatesForList(),
            this.getHistoriesForList(),
            this.userRepo.find({ where: { status: 1 }, select: ['id', 'username'] }),
        ]);

        return this.buildMembersFromData(templates, histories, activeUsers);
    }

    /** 获取某成员的全部项目（仅查该用户数据） */
    async getMemberProjects(
        targetUserId: number,
        currentUserId: number
    ): Promise<{ list: CreativeSquareMemberProject[] }> {
        const user = await this.userRepo.findOne({
            where: { id: targetUserId, status: 1 },
            select: ['id'],
        });
        if (!user) {
            throw new Error('成员不存在');
        }

        const [templates, histories] = await Promise.all([
            this.getActiveTemplatesForList(targetUserId),
            this.getHistoriesForList(targetUserId),
        ]);

        const projects = this.buildUserProjects(targetUserId, templates, histories);
        const list: CreativeSquareMemberProject[] = projects.map((p) => ({
            id: p.id,
            source: p.source,
            name: p.name,
            ...(p.cover_image ? { cover_image: p.cover_image } : {}),
            updated_at: p.updated_at,
            is_own: targetUserId === currentUserId,
        }));

        return { list };
    }

    /** Fork 读取项目数据（任意已登录用户可读，不增加 usage_count） */
    async getProjectForFork(
        source: ProjectSource,
        id: number
    ): Promise<{ name: string; workflow_data: any; cover_image?: string; owner_id: number }> {
        if (source === 'template') {
            const template = await this.templateRepo.findOne({ where: { id } });
            if (!template) throw new Error('项目不存在');
            const now = new Date();
            if (template.expires_at && template.expires_at <= now) {
                throw new Error('项目已过期');
            }
            const workflowData = parseWorkflowData(template.workflow_data);
            if (!workflowData) throw new Error('工作流数据无效');
            const cover = template.cover_image || workflowData.cover_image || getLastImageFromWorkflowData(workflowData);
            return {
                name: template.name,
                workflow_data: workflowData,
                ...(cover ? { cover_image: cover } : {}),
                owner_id: Number(template.user_id),
            };
        }

        const historyRows = await AppDataSource.query(
            `SELECT id, user_id, snapshot_name, workflow_data FROM workflow_history WHERE id = ? LIMIT 1`,
            [id]
        ) as Array<{ id: number; user_id: number; snapshot_name?: string; workflow_data: string }>;

        const history = historyRows[0];
        if (!history) throw new Error('项目不存在');

        const workflowData = parseWorkflowData(history.workflow_data);
        if (!workflowData) throw new Error('工作流数据无效');
        const cover = workflowData.cover_image || getLastImageFromWorkflowData(workflowData);
        return {
            name: history.snapshot_name || '自动保存工作流',
            workflow_data: workflowData,
            ...(cover ? { cover_image: cover } : {}),
            owner_id: Number(history.user_id),
        };
    }
}
