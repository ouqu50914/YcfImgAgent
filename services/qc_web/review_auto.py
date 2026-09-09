#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
review_auto.py — 游戏美术素材自动质检工具 v2（纯文字质检单）
============================================================
用法：
  python3 review_auto.py --req <需求图URL或路径(可选)> --eff <效果图URL或路径> \
      [--key <API_KEY>] [--base <API_BASE>] [--max-side 768] [--quality 80] \
      [--out review_out.json]

流程（全自动）：
  0) L0 程序化预检（OpenCV，零token）：分辨率/尺寸命名/清晰度/黑边白边/纯色低信息
     → 任一 fail 直接「打回」，不进模型
  1) 下载/读取需求图（可选）+ 效果图，自动压缩（短边≤max-side, JPEG q80）
  2) GPT-6-Astra 分段评审（短提示词模式，规避网关断连）：
     段1 [2图,可选] 需求对照（视觉点/构图/文字要求/风格/尺寸）
     段2 [1图] 文字+合规检查（逐字/乱码/违规内容/广告法禁用词/多语言）
     段3 [1图] 9维评分 v2（composition/color/lighting/subject/craft/
                  text_typo/selling_point/creativity/persp_prop）
     段3.5 [1图] 人物/透视/比例专项（角色比例/动态/AI生成缺陷，无人物自动放行）
     段4 [1图] 问题清单（位置/原因/改法）
  3) 合并计算加权总分，veto 判定，输出纯文字质检单（stdout）+ JSON（--out）
============================================================
"""
import argparse, base64, io, json, os, re, sys, time, urllib.request
from PIL import Image

# ---- 9 维评分权重 v2（卖点传达最高；persp_prop 透视/比例/人物动态为硬检查项）----
WEIGHTS = {
    "composition": 0.16, "color": 0.10, "lighting": 0.06,
    "subject": 0.16, "craft": 0.08, "text_typo": 0.10,
    "selling_point": 0.18, "creativity": 0.05,
    "persp_prop": 0.11,   # 透视/比例/人物动态/AI生成缺陷（严格检查）
}
PASS_LINE = 7.0

# ---- L0 程序化预检阈值（按项目 profile 可调）----
PRECHECK = {
    "min_short_side": 640,        # 短边下限
    "lap_blur": 120,              # 拉普拉斯方差 < 此值 → 模糊打回
    "lap_warn": 250,              # < 此值 → 告警
    "edge_black": 0.15,           # 边缘黑边率 > 此值 → 打回
    "edge_white": 0.20,           # 边缘白边率 > 此值（非白底图）→ 打回
    "std_low": 12,                # 灰度标准差 < 此值 → 纯色/低信息
}
# 广告法禁用词（本地词库，段2 模型列字后本地比对）
BANNED_WORDS = ["第一", "国家级", "顶级", "绝对", "首选", "唯一", "全球",
                "全网", "百分百", "最佳", "极品", "史无前例"]


def load_image(src):
    """从 URL 或本地路径读图，返回 PIL.Image"""
    if src.startswith(("http://", "https://")):
        req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        return Image.open(io.BytesIO(data)).convert("RGB")
    return Image.open(src).convert("RGB")


def compress(im, max_side=768, quality=80):
    """等比压缩到短边 <= max_side，JPEG 压缩，返回 (base64_data_url, 实际尺寸)"""
    w, h = im.size
    if min(w, h) > max_side:
        scale = max_side / min(w, h)
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/jpeg;base64,{b64}", im.size


def parse_named_size(path):
    """从文件名提取尺寸标注，如 xxx_1920x1080.jpg → (1920,1080)"""
    m = re.search(r"(\d{3,5})\s*[xX×]\s*(\d{3,5})", os.path.basename(str(path)))
    return (int(m.group(1)), int(m.group(2))) if m else None


def tech_precheck(path, im):
    """L0 程序化预检：返回 (fails, warns)；任一 fail → 打回。
    无 opencv 时降级为仅分辨率/文件名/基础统计检查。"""
    import numpy as np
    try:
        import cv2
        has_cv2 = True
    except Exception:
        cv2 = None
        has_cv2 = False

    fails, warns = [], []
    w, h = im.size
    short = min(w, h)
    # 1. 分辨率
    if short < PRECHECK["min_short_side"]:
        fails.append(f"分辨率不足：{w}x{h}，短边{short} < 最低{PRECHECK['min_short_side']}")
    # 2. 文件名尺寸标注 vs 实际
    named = parse_named_size(path)
    if named:
        nw, nh = named
        if (w, h) != (nw, nh):
            ratio_ok = abs(w / nw - h / nh) < 0.02
            if ratio_ok and w >= nw and h >= nh:
                warns.append(f"尺寸标注{nw}x{nh}，实际{w}x{h}（超清原图，比例一致，需确认交付尺寸）")
            else:
                fails.append(f"尺寸不符：标注{nw}x{nh}，实际{w}x{h}")
    gray = np.asarray(im.convert("L"))
    hh, ww = gray.shape
    # 3. 清晰度（拉普拉斯方差）— 需要 OpenCV
    if has_cv2:
        lap = cv2.Laplacian(gray, cv2.CV_64F).var()
        if lap < PRECHECK["lap_blur"]:
            fails.append(f"清晰度不足（拉普拉斯方差{lap:.0f} < {PRECHECK['lap_blur']}）")
        elif lap < PRECHECK["lap_warn"]:
            warns.append(f"清晰度偏低（{lap:.0f}）")
    else:
        warns.append("未安装 opencv-python，已跳过清晰度/黑白边 L0 预检")
    # 4. 黑边/白边（边缘2%区域）
    k = max(1, int(0.02 * min(ww, hh)))
    edges = np.concatenate([gray[:k, :].ravel(), gray[-k:, :].ravel(),
                            gray[:, :k].ravel(), gray[:, -k:].ravel()])
    dark = float((edges < 20).mean())
    white = float((edges > 235).mean())
    if dark > PRECHECK["edge_black"]:
        fails.append(f"边缘黑边/裁切嫌疑（黑边率{dark:.0%} > {PRECHECK['edge_black']:.0%}）")
    if white > PRECHECK["edge_white"] and gray.mean() < 225:
        if white > 0.50:
            warns.append(f"疑似截图/带窗口边框（白边率{white:.0%}），建议裁剪后重新上传")
        else:
            fails.append(f"边缘白边嫌疑（白边率{white:.0%} > {PRECHECK['edge_white']:.0%}）")
    # 5. 纯色/低信息
    std = float(gray.std())
    if std < PRECHECK["std_low"]:
        fails.append(f"画面信息量过低/疑似纯色（灰度标准差{std:.1f} < {PRECHECK['std_low']}）")
    return fails, warns


def call_astra(key, base, parts, temp=0.0, timeout=60):
    """单次调用 gpt-6-astra，短提示词模式"""
    payload = {"model": "gpt-6-astra",
               "messages": [{"role": "user", "content": parts}],
               "temperature": temp}
    req = urllib.request.Request(
        base.rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read().decode())
    return d["choices"][0]["message"]["content"]


def call_retry(key, base, parts, retries=3, fail_silent=False):
    """带退避重试的调用（网关偶发 RemoteDisconnected）；fail_silent 时最终失败返回空串而非崩溃"""
    for i in range(retries + 1):
        try:
            return call_astra(key, base, parts)
        except Exception as e:
            if i == retries:
                if fail_silent:
                    print(f"  [warn] 该段连续失败 {retries+1} 次，已降级跳过：{type(e).__name__}")
                    return ""
                raise
            print(f"  [retry {i+1}] {type(e).__name__}: {e}")
            time.sleep(4 + i * 3)


def parse_scores(text):
    """从模型输出中解析 8 维分数，如 composition:8,color:9,..."""
    scores = {}
    for k in WEIGHTS:
        m = re.search(rf"{k}\s*[:：]\s*(\d+(?:\.\d+)?)", text, re.I)
        if m:
            scores[k] = float(m.group(1))
    return scores


def weighted_total(scores):
    return round(sum(WEIGHTS.get(k, 0) * v for k, v in scores.items()), 2)


def check_banned(text):
    """本地广告法禁用词比对：返回命中的词列表
    （先剔除否定/引用句式，避免把模型复述的禁用词列表当命中）"""
    hits = []
    for w in BANNED_WORDS:
        if w in _strip_negation(text):
            hits.append(w)
    return hits


def _strip_negation(text):
    """剔除"未发现…等"否定/引用句式，防止模型复述检查项时被正则误命中
    （边界含句号/分号/换行或文本末尾；否定词后最多取 60 字符）"""
    return re.sub(r"(?:未发现|未检测到|未显示|不存在|未见|无)[^。\n；;]{0,60}?(?:等)?(?:[。\n；;]|$)", "", text)


def parse_languages(text):
    """从段2输出解析语种清单（如"语种: 简中,英文,繁中"）"""
    m = re.search(r"语种\s*[:：]\s*([^\n。；;]+)", text)
    if not m:
        return []
    langs = [x.strip() for x in re.split(r"[,，、/]", m.group(1)) if x.strip()]
    return langs


def build_report(req_text, text_check, scores_text, issues_text, size,
                 req_provided=True, precheck=None, persp_text="", aesthetic_text=""):
    """合并各段结果，生成结构化质检单"""
    scores = parse_scores(scores_text)
    total = weighted_total(scores)
    fails, warns = (precheck or ([], []))
    combined = text_check + "\n" + issues_text + "\n" + persp_text + "\n" + aesthetic_text
    combined_clean = _strip_negation(combined)
    issues_clean = _strip_negation(issues_text)
    persp_clean = _strip_negation(persp_text)
    veto = []
    # 乱码/伪文字
    if re.search(r"(?:存在|有|出现|发现|疑似).{0,10}(?:乱码|伪英文|伪文字)", combined_clean) or \
       re.search(r"水印", issues_text) or re.search(r"乱码|伪英文", issues_clean):
        veto.append("乱码/AI伪影/水印")
    # 违规内容
    if re.search(r"(?:存在|有|出现|发现).{0,10}(?:血腥|色情|裸露|违禁|暴力|政治敏感)", combined_clean) or \
       re.search(r"血腥|色情|裸露|违禁品|政治敏感", issues_clean):
        veto.append("违规内容")
    # 广告法禁用词（本地词库）
    banned = check_banned(text_check + issues_text)
    if banned:
        veto.append(f"广告法禁用词（{','.join(banned[:3])}）")
    # 畸形结构
    if "畸形" in combined_clean:
        veto.append("畸形结构")
    # 主体裁切（只认角色/主体被切，避免"前景被画框截断"这类构图问题误杀）
    if re.search(r"(?:切头|切手|主体.{0,6}(?:被切|截断|裁断)|角色.{0,6}(?:被切|截断|裁断))", combined_clean):
        veto.append("主体裁切")
    # 人物/透视/比例/合理性/逻辑/AI生成缺陷（段3.5 结构化清单）
    # 判定规则：①硬伤单杀（结构错误/尺度逻辑错误/物理错误/行为错误/光影错误）②"有问题"子项计数 ≥2
    if persp_clean:
        hard = re.search(
            r"(?:多指|六指|手指粘连|肢体畸形|肢体错位|骨骼错位|多余肢体|透视矛盾|消失点(?:错误|冲突|不一|矛盾)|"
            r"结构穿透|融合变形|比例失调|比例失衡|头身比异常|比例不合理|狗比人大|大人坐儿童车|门比人矮|"
            r"反重力|无支撑|穿模|反关节|不可能姿势|光源矛盾|阴影方向错误|缺失投影|业态不匹配|功能不合理|"
            r"栏杆外|护栏外|悬空区域|不可达区域|橱窗内|屋顶|边缘无防护|站在栏杆|坐在栏杆外|"
            r"缺腿|3条腿|三条腿|桌子缺腿|椅子缺腿|车轮缺失|部件缺失|部件残缺|结构不完整|少一条腿|腿数不对)", persp_clean)
        issue_cnt = len(re.findall(r"有问题|异常|不一致|不统一|失调|失衡|错位|矛盾|悬空|漂浮|穿透", persp_clean))
        if hard or issue_cnt >= 2:
            veto.append("人物比例/透视/AI缺陷")
    # 依赖需求图的规则：只有提供需求图才判定
    if req_provided:
        req_clean = _strip_negation(req_text)
        if re.search(r"(?:违反|不符合|不满足|违背).{0,15}(?:无文案|仅.{0,6}logo)|(?:无文案|仅.{0,6}logo).{0,15}(?:违反|不符合|不满足)", req_clean + combined_clean) or \
           re.search(r"应去掉|应删除|应清理|应去除|去文字化", req_text + issues_text):
            veto.append("违反无文案/仅logo需求")
        # 需求指定了文字/logo/招牌要求，效果图不符（如：英文logo应在最下面却放左上角）
        if re.search(r"(?:logo|文案|文字|招牌).{0,20}(?:不符|违反|错误|不满足)|(?:要求|指定|需求).{0,15}(?:英文|中文|logo|文案).{0,20}(?:却|但).{0,20}(?:不符|不一致|放在|位于)", req_clean):
            veto.append("违反指定文字/logo要求")
    # 判定：预检 fail → 打回；veto/低分 → 返工；否则通过
    if fails:
        verdict = "打回"
    elif veto or total < PASS_LINE:
        verdict = "返工"
    else:
        verdict = "通过"
    # 联动：透视/比例 veto 触发时，persp_prop 分压至 6.5 上限（防模型评分与检查矛盾）
    if "人物比例/透视/AI缺陷" in veto and scores.get("persp_prop", 0) > 6.5:
        scores["persp_prop"] = 6.5
        total = weighted_total(scores)
    return {
        "size": list(size),
        "req_provided": req_provided,
        "precheck": {"fails": fails, "warns": warns, "ok": not fails},
        "req_check": req_text,
        "text_check": text_check,
        "languages": parse_languages(text_check),
        "persp_check": persp_text,
        "aesthetic_check": aesthetic_text,
        "scores": scores,
        "weighted_total": total,
        "pass_line": PASS_LINE,
        "verdict": verdict,
        "veto_hits": veto,
        "issues": issues_text,
    }


def main():
    ap = argparse.ArgumentParser(description="游戏美术素材自动质检 v2（GPT-6-Astra）")
    ap.add_argument("--req", default=None, help="需求图 URL 或本地路径（可选，不提供则自动跳过需求对照）")
    ap.add_argument("--eff", required=True, help="效果图 URL 或本地路径")
    ap.add_argument("--key", default=os.environ.get("API_KEY", ""))
    ap.add_argument("--base", default="https://api.acedata.cloud/v1")
    ap.add_argument("--max-side", type=int, default=768, help="压缩后短边上限，默认768")
    ap.add_argument("--quality", type=int, default=80, help="JPEG质量，默认80")
    ap.add_argument("--out", default="review_out.json", help="输出JSON路径")
    args = ap.parse_args()

    req_provided = bool(args.req)
    print(f"[1/6] 读取图片 ...")
    if req_provided:
        req_im = load_image(args.req)
        print(f"  需求图原始尺寸: {req_im.size}")
    else:
        req_im = None
        print("  未提供需求图 → 自动跳过需求对照环节")
    eff_im = load_image(args.eff)
    print(f"  效果图原始尺寸: {eff_im.size}")

    print(f"[2/6] L0 程序化预检（零token）...")
    fails, warns = tech_precheck(args.eff, eff_im)
    if fails:
        for f in fails:
            print(f"  [FAIL] {f}")
    if warns:
        for w in warns:
            print(f"  [WARN] {w}")
    if not fails and not warns:
        print("  预检通过")
    time.sleep(1)

    print(f"[3/6] 自动压缩（短边≤{args.max_side}, q{args.quality}）...")
    if req_provided:
        req_b64, req_size = compress(req_im, args.max_side, args.quality)
    else:
        req_b64, req_size = None, None
    eff_b64, eff_size = compress(eff_im, args.max_side, args.quality)
    if req_provided:
        print(f"  压缩后: 需求 {req_size} | 效果 {eff_size}")
    else:
        print(f"  压缩后: 效果 {eff_size}")

    print("[4/6] GPT-6-Astra 分段评审 ...")
    # 段1: 需求对照（2图，仅当提供需求图）
    if req_provided:
        r1 = call_retry(args.key, args.base, [
            {"type": "text", "text": "图1是需求说明（含文字需求与参考预览）。图2是效果图。对照需求逐项简短检查：1)核心视觉点是否达成？2)构图/视角是否与参考一致？3)画面文字是否符合需求（logo位置/中英文要求/是否要求无文案）？4)风格画风是否符合（如欧卡画风）？5)尺寸比例是否符合需求？"},
            {"type": "image_url", "image_url": {"url": req_b64}},
            {"type": "image_url", "image_url": {"url": eff_b64}},
        ])
        print("  段1 需求对照:", r1[:200], "..." if len(r1) > 200 else "")
        time.sleep(2)
    else:
        r1 = "（未提供需求图，已跳过需求对照）"
        print("  段1 需求对照: 跳过")

    # 段2: 文字+合规检查（1图）——逐区域扫描，识别不清必须标注；失败时降级重试
    r2 = call_retry(args.key, args.base, [
        {"type": "text", "text": "逐区域扫描这张图所有文字（顶部/上部/中部/下部/底部/左侧/右侧），列出可辨识文字（不超过20条）：内容+位置+分类（logo/招牌/正文/小字/装饰/疑似乱码/无法确认）。看不清的标'（模糊）'，不得跳过关键文字。再查：1)违规内容（血腥/色情/裸露/违禁品/政治敏感）2)广告法禁用词（最/第一/顶级/国家级/绝对）3)多语言正确性。最后一行：语种: 简中,英文,繁中（无文字写'语种: 无文字'）。简短。"},
        {"type": "image_url", "image_url": {"url": eff_b64}},
    ], fail_silent=True)
    if not r2.strip():
        print("  段2 主调用失败，降级短提示词重试...")
        r2 = call_retry(args.key, args.base, [
            {"type": "text", "text": "列出这张图所有可辨识文字（logo/招牌/小字），看不清的标'模糊'。查：违规内容/广告法禁用词/多语言。最后一行：语种: 简中,英文,繁中。简短。"},
            {"type": "image_url", "image_url": {"url": eff_b64}},
        ], fail_silent=True)
        if not r2.strip():
            r2 = "（文字识别调用失败，请重试或人工检查）"
    print("  段2 文字+合规:", r2[:200], "..." if len(r2) > 200 else "")
    time.sleep(2)

    # 段3: 9维评分 v2（1图）
    r3 = call_retry(args.key, args.base, [
        {"type": "text", "text": "给这张游戏宣传图9个维度各打1-10分，只输出 composition:8,color:7,lighting:6,subject:8,craft:6,text_typo:9,selling_point:7,creativity:7,persp_prop:6 格式。"},
        {"type": "image_url", "image_url": {"url": eff_b64}},
    ])
    print("  段3 评分:", r3[:200], "..." if len(r3) > 200 else "")
    time.sleep(2)

    # 段3.5: 透视/比例/合理性/结构完整性专项（1图）——结构化清单，逐项判定
    r35 = call_retry(args.key, args.base, [
        {"type": "text", "text": "检查这张图透视、比例、合理性逻辑、空间位置与结构完整性，逐项只答'正常'或'有问题+简短说明'，最后一行'综合判定: 正常或有问题+位置'。无人物项标'无人物'。识别不清的结构标注'（细节不足）'。重点抓：尺度不合理(狗比人大/大人坐儿童车/门比人矮)、反重力/穿模/悬空、人物脚部未踩实/站在不合理位置(护栏/扶梯边缘/空中)、空间位置不合理(人物或桌椅在栏杆外侧/护栏外/楼层边缘悬空侧/橱窗内/屋顶/不可达区域/边缘无防护；特别检查高处楼层栏杆内外侧，人物和桌椅必须在栏杆内侧安全区域)、业态陈列不匹配、反关节/不可能姿势、光源矛盾/阴影错、透视矛盾/近大远小错、结构不完整(椅子缺腿/3条腿/桌子缺腿/车轮缺失/部件残缺/多肢缺肢)。清单：1)头身比 2)人体结构 3)角色间尺度 4)人物道具尺度 5)视平线消失点 6)近大远小 7)地面透视 8)遮挡接触 9)重心 10)脚部接触 11)姿态行为 12)手指肢体 13)物理逻辑 14)场景逻辑 15)空间位置 16)光影逻辑 17)结构完整"},
        {"type": "image_url", "image_url": {"url": eff_b64}},
    ], fail_silent=True)
    print("  段3.5 透视/比例/合理性/结构:", r35[:200], "..." if len(r35) > 200 else "")
    time.sleep(2)

    # 段3.6: 美术审美专项（1图）——黑白灰/色彩/视觉中心/负空间/笔触/风格统一
    r36 = call_retry(args.key, args.base, [
        {"type": "text", "text": "检查这张图美术审美，逐项只答'正常'或'有问题+简短说明'，最后一行'综合判定: 正常或有问题+位置'。重点抓：黑白灰缺失/发灰/对比不足、色彩杂乱/冷暖失衡、主次不分/多焦点、拥挤或空旷、笔触不统一、风格混搭、氛围不符。清单：1)黑白灰 2)色彩关系 3)视觉中心 4)负空间 5)笔触质感 6)风格统一 7)色彩数量 8)氛围情绪"},
        {"type": "image_url", "image_url": {"url": eff_b64}},
    ], fail_silent=True)
    print("  段3.6 美术审美:", r36[:200], "..." if len(r36) > 200 else "")
    time.sleep(2)

    # 段4: 问题清单（1图）
    r4 = call_retry(args.key, args.base, [
        {"type": "text", "text": "列出这张效果图2-3个最需要修改的问题，每条含：位置、原因、改法。简短。"},
        {"type": "image_url", "image_url": {"url": eff_b64}},
    ])
    print("  段4 问题:", r4[:200], "..." if len(r4) > 200 else "")

    print("[5/6] 合并质检单 ...")
    report = build_report(r1, r2, r3, r4, eff_size, req_provided=req_provided,
                          precheck=(fails, warns), persp_text=r35, aesthetic_text=r36)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print("[6/6] 输出文字质检单")
    print("=" * 64)
    print("【美术质检单 v2】")
    print(f"  尺寸: {report['size'][0]}×{report['size'][1]} ｜ 判定: {report['verdict']} ｜ "
          f"加权总分: {report['weighted_total']} / 通过线 {report['pass_line']}")
    if fails:
        print("  🚫 L0 预检未通过，已打回：")
        for f in fails:
            print(f"    - {f}")
    if warns:
        print("  ⚠️ L0 告警：")
        for w in warns:
            print(f"    - {w}")
    if report["veto_hits"]:
        print(f"  命中硬规则: {', '.join(report['veto_hits'])}")
    if not report["req_provided"]:
        print("  ⚠️ 未提供需求图：需求对照已跳过，无文案类规则未检测")
    print("-" * 64)
    print("【需求对照核验】")
    print(report["req_check"])
    print("-" * 64)
    print("【文字+合规检查】")
    print(report["text_check"])
    print("-" * 64)
    print("【语种识别】")
    print("  " + ("、".join(report["languages"]) if report["languages"] else "（未识别到）"))
    print("-" * 64)
    print("【人物/透视/比例/合理性专项】")
    print(report["persp_check"] if report["persp_check"] else "（无人物或未检查）")
    print("-" * 64)
    print("【美术审美专项】")
    print(report["aesthetic_check"] if report["aesthetic_check"] else "（未检查）")
    print("-" * 64)
    print("【9维评分 v2】")
    print("  " + ", ".join(f"{k}:{v}" for k, v in sorted(report["scores"].items())))
    print("-" * 64)
    print("【问题详解】")
    print(report["issues"])
    print("=" * 64)
    print(f"完整结果已保存: {args.out}")


if __name__ == "__main__":
    main()
