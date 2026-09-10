---
name: art-qc-review
title: 美术质检
description: >
  美术质检流程：为已生成效果图创建 Review 节点并可选连接需求参考图。
  在用户提到质检、审核、打回、返工、评分时使用。
---

# 美术质检

## 目标
在画布上挂接 Review 节点，由用户点击「执行审核」。你不要假装已经打出分数。

## 步骤
1. 用 get_workflow_snapshot 找到效果图 ImageNode。
2. 调用 create_review_pipeline，传入 effectNodeId；若有需求/参考图一并传入 reqNodeIds。
3. 告知用户：审核约 1–3 分钟，请在 Review 节点点击执行。
