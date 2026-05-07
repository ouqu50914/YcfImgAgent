import ExcelJS from "exceljs";
import type { CreditUsageSummaryRow } from "./admin.service";

export class ExportService {
    buildCreditUsageCsv(rows: CreditUsageSummaryRow[]): Buffer {
        const headers = ["用户ID", "用户名", "模型", "消耗积分", "记录数", "开始时间", "结束时间"];
        const lines = [headers.map(this.escapeCsvCell).join(",")];
        for (const row of rows) {
            const values = [
                String(row.userId),
                row.username,
                row.model,
                String(row.totalCredits),
                String(row.recordCount),
                row.from,
                row.to,
            ];
            lines.push(values.map(this.escapeCsvCell).join(","));
        }
        return Buffer.from(`\uFEFF${lines.join("\n")}`, "utf-8");
    }

    async buildCreditUsageXlsx(rows: CreditUsageSummaryRow[]): Promise<Buffer> {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("积分消耗汇总");
        const orderedModels = this.getModelOrder(rows);
        const modelLabels = this.getModelLabels();
        const grouped = this.groupRowsByUser(rows, orderedModels);
        const totalCols = 2 + orderedModels.length * 2 + 2;
        const from = rows[0]?.from ?? "";
        const to = rows[0]?.to ?? "";
        const titleText = `用户积分消耗对比汇总 / ${this.getPeriodLabel(from, to)}`;

        sheet.views = [{ state: "frozen", ySplit: 3 }];
        sheet.addRow([]);
        sheet.addRow([]);
        sheet.addRow([]);

        // 标题行
        sheet.mergeCells(1, 1, 1, totalCols);
        const titleCell = sheet.getCell(1, 1);
        titleCell.value = titleText;
        titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
        titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3B64" } };
        titleCell.alignment = { vertical: "middle", horizontal: "left" };
        sheet.getRow(1).height = 28;

        // 表头（第2行分组 + 第3行子标题）
        sheet.getCell(2, 1).value = "用户ID";
        sheet.getCell(2, 2).value = "用户名";
        sheet.mergeCells(2, 1, 3, 1);
        sheet.mergeCells(2, 2, 3, 2);

        let col = 3;
        const modelHeaderColors = ["FF1F4E78", "FF2E7D32", "FF5E35B1", "FFB26A00", "FF00796B", "FFB71C1C", "FF455A64"];
        orderedModels.forEach((model, idx) => {
            const label = modelLabels[model] ?? model;
            sheet.mergeCells(2, col, 2, col + 1);
            sheet.getCell(2, col).value = label;
            sheet.getCell(3, col).value = "积分";
            sheet.getCell(3, col + 1).value = "次数";
            const color = modelHeaderColors[idx % modelHeaderColors.length] ?? "FF1F4E78";
            this.paintHeaderCell(sheet.getCell(2, col), color);
            this.paintHeaderCell(sheet.getCell(2, col + 1), color);
            col += 2;
        });
        sheet.mergeCells(2, col, 2, col + 1);
        sheet.getCell(2, col).value = "总计";
        sheet.getCell(3, col).value = "积分";
        sheet.getCell(3, col + 1).value = "次数";
        this.paintHeaderCell(sheet.getCell(2, col), "FF546E7A");
        this.paintHeaderCell(sheet.getCell(2, col + 1), "FF546E7A");

        for (let i = 1; i <= totalCols; i += 1) {
            const c2 = sheet.getCell(2, i);
            const c3 = sheet.getCell(3, i);
            if (!c2.fill || !("fgColor" in c2.fill) || !c2.fill.fgColor) {
                this.paintHeaderCell(c2, "FF1F4E78");
            }
            c3.font = { bold: true, color: { argb: "FFFFFFFF" } };
            c3.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2C5A87" } };
            c3.alignment = { vertical: "middle", horizontal: "center" };
        }
        sheet.getRow(2).height = 24;
        sheet.getRow(3).height = 22;

        // 数据行
        let currentRow = 4;
        const modelTotals = new Map<string, { credits: number; count: number }>();
        let grandCredits = 0;
        let grandCount = 0;
        for (const user of grouped) {
            const rowValues: Array<string | number> = [user.userId, user.username];
            let userCredits = 0;
            let userCount = 0;
            for (const model of orderedModels) {
                const hit = user.models.get(model) ?? { credits: 0, count: 0 };
                rowValues.push(hit.credits, hit.count);
                userCredits += hit.credits;
                userCount += hit.count;
                const total = modelTotals.get(model) ?? { credits: 0, count: 0 };
                total.credits += hit.credits;
                total.count += hit.count;
                modelTotals.set(model, total);
            }
            rowValues.push(userCredits, userCount);
            grandCredits += userCredits;
            grandCount += userCount;
            const row = sheet.insertRow(currentRow, rowValues);
            const zebra = currentRow % 2 === 0 ? "FFF5F9FF" : "FFFFFFFF";
            row.eachCell((cell, colNumber) => {
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
                cell.border = this.defaultBorder();
                if (colNumber === 2) {
                    cell.alignment = { vertical: "middle", horizontal: "left" };
                } else {
                    cell.alignment = { vertical: "middle", horizontal: "right" };
                }
            });
            currentRow += 1;
        }

        // 总计行
        const summaryValues: Array<string | number> = ["", "所有用户总计"];
        for (const model of orderedModels) {
            const total = modelTotals.get(model) ?? { credits: 0, count: 0 };
            summaryValues.push(total.credits, total.count);
        }
        summaryValues.push(grandCredits, grandCount);
        const summaryRow = sheet.insertRow(currentRow + 1, summaryValues);
        summaryRow.height = 24;
        summaryRow.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3B64" } };
            cell.border = this.defaultBorder();
            if (colNumber === 2) {
                cell.alignment = { vertical: "middle", horizontal: "left" };
            } else {
                cell.alignment = { vertical: "middle", horizontal: "right" };
            }
        });

        // 列宽
        sheet.getColumn(1).width = 10;
        sheet.getColumn(2).width = 14;
        for (let i = 3; i <= totalCols; i += 1) {
            sheet.getColumn(i).width = 9;
        }

        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }

    private getModelOrder(rows: CreditUsageSummaryRow[]): string[] {
        const preferred = [
            "dream",
            "nano",
            "gpt-image-2",
            "gemini-3.1-flash-image-preview",
            "gemini-3-pro-image-preview",
            "midjourney",
            "kling",
            "seedance",
            "pixverse",
        ];
        const fromRows = Array.from(new Set(rows.map((r) => String(r.model || "").trim().toLowerCase()).filter(Boolean)));
        const set = new Set<string>([...preferred, ...fromRows]);
        return Array.from(set);
    }

    private getModelLabels(): Record<string, string> {
        return {
            dream: "Dream(文生图)",
            nano: "Gemini(AI对话)",
            "gpt-image-2": "GPT-Image-2(绘图)",
            "gemini-3.1-flash-image-preview": "Gemini-3.1-Flash-Image",
            "gemini-3-pro-image-preview": "Gemini-3-Pro-Image",
            "gpt-image-2 (ace)": "GPT-Image-2(Ace)",
            "gpt-image-2 (anyfast)": "GPT-Image-2(AnyFast)",
            "nano (ace)": "Nano(Ace)",
            "nano (anyfast)": "Nano(AnyFast)",
            "gemini-3.1-flash-image-preview (anyfast)": "Gemini-3.1-Flash(AnyFast)",
            "gemini-3-pro-image-preview (anyfast)": "Gemini-3-Pro(AnyFast)",
            "dream (dream)": "Dream(Dream)",
            "midjourney (midjourney)": "Midjourney(Midjourney)",
            "kling (kling)": "Kling(Kling)",
            "seedance (seedance)": "Seedance(Seedance)",
            "pixverse (pixverse)": "Pixverse(Pixverse)",
            midjourney: "Midjourney(绘图)",
            kling: "Kling(视频)",
            seedance: "Seedance(视频)",
            pixverse: "Pixverse(视频)",
        };
    }

    private groupRowsByUser(rows: CreditUsageSummaryRow[], models: string[]) {
        const map = new Map<number, { userId: number; username: string; models: Map<string, { credits: number; count: number }> }>();
        rows.forEach((row) => {
            const userId = Number(row.userId);
            const model = String(row.model || "").trim().toLowerCase();
            if (!userId || !model) return;
            const hit = map.get(userId) ?? { userId, username: row.username, models: new Map() };
            hit.username = row.username;
            hit.models.set(model, { credits: Number(row.totalCredits || 0), count: Number(row.recordCount || 0) });
            map.set(userId, hit);
        });
        const users = Array.from(map.values()).sort((a, b) => a.userId - b.userId);
        users.forEach((u) => {
            models.forEach((m) => {
                if (!u.models.has(m)) u.models.set(m, { credits: 0, count: 0 });
            });
        });
        return users;
    }

    private paintHeaderCell(cell: ExcelJS.Cell, colorArgb: string) {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colorArgb } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = this.defaultBorder();
    }

    private defaultBorder(): Partial<ExcelJS.Borders> {
        return {
            top: { style: "thin", color: { argb: "FFBFC9D4" } },
            left: { style: "thin", color: { argb: "FFBFC9D4" } },
            bottom: { style: "thin", color: { argb: "FFBFC9D4" } },
            right: { style: "thin", color: { argb: "FFBFC9D4" } },
        };
    }

    private getPeriodLabel(from: string, to: string): string {
        const fromDate = new Date(from);
        const toDate = new Date(to);
        if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return "时间范围";
        const sameMonth = fromDate.getFullYear() === toDate.getFullYear() && fromDate.getMonth() === toDate.getMonth();
        if (sameMonth) {
            return `${fromDate.getFullYear()}年${fromDate.getMonth() + 1}月`;
        }
        return `${fromDate.getFullYear()}-${this.pad2(fromDate.getMonth() + 1)}-${this.pad2(fromDate.getDate())} ~ ${toDate.getFullYear()}-${this.pad2(toDate.getMonth() + 1)}-${this.pad2(toDate.getDate())}`;
    }

    private pad2(n: number): string {
        return String(n).padStart(2, "0");
    }

    private escapeCsvCell(value: string): string {
        const escaped = value.replace(/"/g, "\"\"");
        if (escaped.includes(",") || escaped.includes("\"") || escaped.includes("\n")) {
            return `"${escaped}"`;
        }
        return escaped;
    }
}
