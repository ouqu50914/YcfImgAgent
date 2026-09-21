/**
 * 与 Backend controlled-script-registry 中 storyboard_grid_hint 对齐：
 * 一镜一图（多张独立成品图），非整图宫格拼版。
 */

export type StoryboardHintPayload = {
  hint: string;
  rows: number;
  cols: number;
  panels: number;
  numImages: number;
  mode: 'per_panel';
};

export function buildStoryboardGridHint(rows: number, cols: number, locale: 'zh' | 'en' = 'zh'): string {
  return buildStoryboardPanelHint({ rows, cols, locale }).hint;
}

export function buildStoryboardPanelHint(input: {
  rows?: number;
  cols?: number;
  panels?: number;
  locale?: 'zh' | 'en';
}): StoryboardHintPayload {
  let rows = Math.max(1, Math.min(6, Math.floor(Number(input.rows)) || 2));
  let cols = Math.max(1, Math.min(6, Math.floor(Number(input.cols)) || 2));
  let total = rows * cols;
  const panelsArg = Number(input.panels);
  if (Number.isFinite(panelsArg) && panelsArg >= 1) {
    total = Math.max(1, Math.min(12, Math.floor(panelsArg)));
    cols = Math.max(1, Math.ceil(Math.sqrt(total)));
    rows = Math.max(1, Math.ceil(total / cols));
  }
  const numImages = Math.min(8, total);
  const locale = input.locale === 'en' ? 'en' : 'zh';
  const hint =
    locale === 'en'
      ? `Output ${numImages} SEPARATE single-shot finished frames (${total} story beats` +
        (total > numImages ? `, this batch: first ${numImages}` : '') +
        `, reading order left-to-right then top-to-bottom). ` +
        `CRITICAL: EACH image must contain exactly ONE camera shot filling the whole frame. ` +
        `FORBIDDEN in every image: multi-panel comic pages, vertical strip grids, 2x2/3x3 collages, turnaround sheets, title bars, panel numbers. ` +
        `Keep character design consistent with references.`
      : `请输出【${numImages} 张】彼此独立的单镜头成品图（阅读顺序共 ${total} 镜` +
        (total > numImages ? `，本批先出前 ${numImages} 镜` : '') +
        `）。` +
        `硬性要求：每一张画面内只能有【一个】完整镜头（全幅），不是漫画页。` +
        `严禁：四格/多格拼版、竖条分镜格、九宫格整图、三视图/设定板、标题条、格号水印。` +
        `角色造型与参考图一致；画幅按节点比例满幅构图。`;
  return { hint, rows, cols, panels: total, numImages, mode: 'per_panel' };
}

/** 从文本里解析 2x2 / 2×2 / 四宫格 / 九宫格 / N宫格 等 */
export function detectGridLayout(text: string): { rows: number; cols: number; panels?: number } | null {
  const s = String(text || '');
  if (!s.trim()) return null;

  const nPanel = s.match(/(\d+)\s*宫格/);
  if (nPanel && !/\d\s*[x×*]\s*\d/.test(s)) {
    const n = Number(nPanel[1]);
    if (n >= 1 && n <= 12) {
      const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
      const rows = Math.max(1, Math.ceil(n / cols));
      return { rows, cols, panels: n };
    }
  }

  if (/九宫格|3\s*[x×*]\s*3/.test(s)) return { rows: 3, cols: 3, panels: 9 };
  if (/四宫格|四格漫画|2\s*[x×*]\s*2|2\s*\*\s*2/.test(s)) return { rows: 2, cols: 2, panels: 4 };
  if (/六宫格|2\s*[x×*]\s*3|3\s*[x×*]\s*2/.test(s)) {
    if (/3\s*[x×*]\s*2/.test(s)) return { rows: 3, cols: 2, panels: 6 };
    return { rows: 2, cols: 3, panels: 6 };
  }

  const m = s.match(/(\d)\s*[x×*]\s*(\d)\s*宫格/);
  if (m) {
    const rows = Number(m[1]);
    const cols = Number(m[2]);
    return { rows, cols, panels: rows * cols };
  }
  const m2 = s.match(/(\d)\s*[x×*]\s*(\d)/);
  if (m2 && /分镜|宫格|故事板|storyboard/i.test(s)) {
    const rows = Number(m2[1]);
    const cols = Number(m2[2]);
    return { rows, cols, panels: rows * cols };
  }
  return null;
}

/** 提示词是否已含足够强的「一镜一图」约束 */
export function promptHasGridConstraint(text: string, _rows?: number, _cols?: number): boolean {
  const s = String(text || '');
  return (
    /请输出【\d+ 张】彼此独立的单镜头成品图|请生成【\d+ 张】独立分镜成品图|Output \d+ SEPARATE single-shot|Generate \d+ SEPARATE finished storyboard/i.test(
      s
    ) || /【强制单镜头\s*\d+\/\d+】/.test(s)
  );
}

/** 保留剧情，追加一镜一图约束；若仍是旧「一张宫格」句则替换 */
export function appendGridHintToPrompt(promptText: string, rows: number, cols: number): string {
  const base = String(promptText || '').trim();
  const payload = buildStoryboardPanelHint({ rows, cols, locale: 'zh' });
  const hint = payload.hint;
  if (!base) return hint;

  let next = base
    .replace(/\n*【版式】[^\n]*/g, '')
    .replace(/\n*【分镜】[^\n]*/g, '')
    .replace(/请生成【一张】\d+×\d+ 宫格分镜图[^。\n]*。?/g, '')
    .replace(/Generate ONE image as a \d+x\d+ storyboard grid[^\n.]*/gi, '')
    .trim();

  if (promptHasGridConstraint(next)) return next;
  if (!next) return hint;
  return `${next.replace(/\s+$/, '')}\n\n【分镜】${hint}`;
}
