---
name: storyboard-grid
title: 分镜成品图
description: >
  先抽取并确认角色锁定档案（发型/帽子/服装等），再拆镜批量出图；确认后写入分镜集合节点。
  在用户提到分镜、宫格、四格、故事板、每镜一张、批量分镜时使用。
artn:
  requires_agent: true
  allowed_scripts:
    - storyboard_grid_hint
  tools:
    - get_workflow_snapshot
    - run_controlled_script
    - create_image_pipeline
    - propose_generate
    - ask_user
---

# 分镜成品图（ARTN）

## 目标
批量产出 **N 张**彼此独立的单镜头成品图（N 由 AI 建议或用户指定并确认）。  
**角色外观必须全片锁定**（对齐原「角色场景分镜板」：先档案、再分镜）。  
画布：确认后写入 **1 个分镜集合节点**（按序可换行），并从 Dream 连线追源。

## 角色锁定（最高优先级）
参考原 Skill 的角色档案字段，每镜生成前必须固定：
- 发型发色、五官（含眼镜）
- **帽子：有则始终同款同色；无则始终不戴**（禁止镜间忽有忽无）
- 上衣 / 外套颜色与款式（禁止镜间换装）
- 配饰、体型、画风
- 有参考图时：每镜 `referenceNodeIds` 必须带上，作为身份锚点

仅允许跨镜变化：景别、动作、表情、姿态、构图、对白气泡。

## 固定步骤

### A. 规划（先锁定，再建任务）
1. `get_workflow_snapshot`：记下参考图 id、Dream id、模型/比例/画质。
2. `run_controlled_script`：`storyboard_grid_hint`，`input={ "phase":"plan", "story":"<原文>" }`
3. **必须** `ask_user`，把返回的 `characterBrief`（完整角色锁定档案）原文展示给用户核对/修改，并确认 `panels`。
4. 未确认前禁止 `create_image_pipeline` / `propose_generate`。

### B. 拆镜并挂起
5. `input={ "phase":"split", "story":"<原文>", "panels":N, "characterBrief":"<用户确认后的锁定档案>" }`
6. 对 `panelPrompts[]` 每一镜：
   - `create_image_pipeline`：`presentation:"images_only"`、`numImages=1`、`promptText`、**必填 `referenceNodeIds`**、建议 `panelIndex`、`sourceDreamNodeId`
   - `propose_generate({ jobId })`
7. 用户「确认并生成」→ 一个分镜集合节点，内含 N 镜。

## 禁止
- 禁止未确认角色锁定档案就拆镜出图。
- 禁止漏传角色参考图。
- 禁止在分镜提示词里改帽子/换外套/改发色。
- 禁止单任务 `numImages=N` 凑格；禁止拼成一张多格漫画页。
