#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
qc_web.py — 游戏美术素材自动质检 · 自由画布版 v5
================================================================
v5 审核流程重构：
  1. 上传效果图到画布
  2. hover 效果图 → 右侧边缘中间出现绿色圆点
  3. 拖拽绿点向外 → 弹出"自动审核"按钮
  4. 点击"自动审核" → 弹出审核配置 UI 框
  5. UI 框内：需求图拖放区（可选，无则显示"无需求参考图"）+ 执行按钮
  6. 点击执行 → 开始审核，结果卡片从效果图延伸出来
================================================================
"""
import base64, io, json, os, re, time, uuid
from PIL import Image, ImageDraw, ImageFont
from flask import Flask, request, jsonify, send_from_directory

import review_auto

HOST = os.environ.get("QC_HOST", "0.0.0.0")
PORT = int(os.environ.get("QC_PORT", "8082"))
API_KEY = os.environ.get("API_KEY", "")
API_BASE = os.environ.get("API_BASE", "https://api.acedata.cloud/v1")
MAX_SIDE = int(os.environ.get("QC_MAX_SIDE", "768"))
QUALITY = int(os.environ.get("QC_QUALITY", "80"))
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

PROBLEM_KW = ["不符合", "未满足", "不一致", "错误", "缺失", "乱码", "违规", "无法确认", "异常", "问题", "打回", "返工"]
COMPLIANCE_KW = ["违规", "禁用词", "广告法", "色情", "血腥", "政治", "宗教", "违禁品", "裸露", "暴力"]


def parse_boxes(text):
    boxes = []
    for m in re.finditer(r"(\d{1,3}(?:\.\d+)?)%\s*[,，]\s*(\d{1,3}(?:\.\d+)?)%\s*[,，]\s*(\d{1,3}(?:\.\d+)?)%\s*[,，]\s*(\d{1,3}(?:\.\d+)?)%", text):
        vals = [float(m.group(i)) for i in range(1, 5)]
        if all(0 <= v <= 100 for v in vals):
            boxes.append(vals)
    return boxes


def annotate_image(im_path, issues_text, main_box_idx=0):
    im = Image.open(im_path).convert("RGB")
    W, H = im.size
    im = Image.blend(im, Image.new("RGB", (W, H), (0, 0, 0)), 0.30)
    draw = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", max(26, int(W * 0.020)))
    except Exception:
        font = None
    boxes = parse_boxes(issues_text)
    if not boxes:
        return im, 0
    RED, ORANGE = (230, 60, 60), (240, 150, 40)
    for i, (x1, y1, x2, y2) in enumerate(boxes):
        color = RED if i == main_box_idx else ORANGE
        b1 = (int(W * x1 / 100), int(H * y1 / 100))
        b2 = (int(W * x2 / 100), int(H * y2 / 100))
        draw.rectangle([b1, b2], outline=color, width=max(6, int(W * 0.004)))
        if font:
            tag = f"{i+1}"
            bbox = draw.textbbox((0, 0), tag, font=font)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            ty = max(0, b1[1] - th - 12)
            draw.rectangle([b1[0] - 6, ty - 6, b1[0] + tw + 10, ty + th + 8], fill=(0, 0, 0))
            draw.text((b1[0] - 2, ty - 2), tag, fill=color, font=font)
    return im, len(boxes)


def image_to_data_url(im, max_side=1600):
    im = im.copy()
    if max(im.size) > max_side:
        scale = max_side / max(im.size)
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _has_problem(text, keywords):
    return any(kw in text for kw in keywords)


def _split_text_compliance(text_check):
    text_lines, comp_lines = [], []
    for line in text_check.split("\n"):
        line = line.strip()
        if not line:
            continue
        if any(kw in line for kw in COMPLIANCE_KW):
            comp_lines.append(line)
        else:
            text_lines.append(line)
    return "\n".join(text_lines), "\n".join(comp_lines)


def _strip_num_prefix(s):
    """去掉文本开头的数字序号，如 '1. '、'2、'、'3) '"""
    return re.sub(r'^\s*\d+\s*[\.、\)\:：]\s*', '', s).strip()

# ========== 合成图生成（标注图+文字质检单合一） ==========
NOTO_REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
NOTO_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"

def _wrap_text(draw, text, font, max_w):
    """按像素宽度自动换行，返回行列表"""
    lines = []
    for para in str(text).split("\n"):
        if not para.strip():
            lines.append("")
            continue
        cur = ""
        for ch in para:
            test = cur + ch
            w = draw.textbbox((0,0), test, font=font)[2]
            if w > max_w and cur:
                lines.append(cur)
                cur = ch
            else:
                cur = test
        if cur:
            lines.append(cur)
    return lines

def _draw_text_block(draw, x, y, text, font, color, max_w, line_h=1.6):
    """绘制一段自动换行的文字，返回结束时的y坐标"""
    lines = _wrap_text(draw, text, font, max_w)
    lh = int(font.size * line_h)
    for line in lines:
        if line:
            draw.text((x, y), line, font=font, fill=color)
        y += lh
    return y

def generate_summary_image(report, annotated_path, output_path):
    """把标注图和文字质检单合成一张深色长图"""
    W = 1200
    margin = 50
    content_w = W - margin*2
    bg = (24, 24, 28)
    card_bg = (45, 45, 45)
    title_c = (230, 230, 235)
    section_c = (180, 200, 220)
    body_c = (170, 170, 175)
    dim_c = (120, 120, 125)
    bad_c = (230, 120, 120)
    warn_c = (230, 180, 100)
    ok_c = (120, 210, 140)
    accent_c = (100, 180, 240)

    f_title = ImageFont.truetype(NOTO_BOLD, 30)
    f_section = ImageFont.truetype(NOTO_BOLD, 20)
    f_body = ImageFont.truetype(NOTO_REG, 16)
    f_small = ImageFont.truetype(NOTO_REG, 14)
    f_score = ImageFont.truetype(NOTO_BOLD, 48)

    # 第一遍：用临时画布测量所有内容高度
    tmp = Image.new("RGB", (W, 100), bg)
    d = ImageDraw.Draw(tmp)

    y = margin
    # 标题
    y += 50
    # 标注图
    ann_h = 0
    if annotated_path and os.path.exists(annotated_path):
        ann = Image.open(annotated_path).convert("RGB")
        scale = content_w / ann.width
        ann_h = int(ann.height * scale)
        y += ann_h + 30
    # 结果概览
    y += 80
    # 各维度
    sections_data = _collect_sections(report)
    for sec in sections_data:
        y += 40
        for item in sec["items"]:
            y = _draw_text_block(d, margin+20, y, item, f_body, body_c, content_w-40) + 8
        y += 10

    total_h = y + margin
    # 创建正式画布
    img = Image.new("RGB", (W, total_h), bg)
    draw = ImageDraw.Draw(img)

    y = margin
    # 标题
    draw.text((margin, y), "美术素材质检报告", font=f_title, fill=title_c)
    y += 45
    # 分割线
    draw.line([(margin, y), (W-margin, y)], fill=(60,60,65), width=1)
    y += 20

    # 标注图
    if annotated_path and os.path.exists(annotated_path):
        ann = Image.open(annotated_path).convert("RGB")
        scale = content_w / ann.width
        ann_resized = ann.resize((content_w, int(ann.height*scale)), Image.LANCZOS)
        img.paste(ann_resized, (margin, y))
        y += ann_resized.height + 30

    # 结果概览卡片
    score = report.get("score", 0)
    conclusion = report.get("conclusion", "")
    card_h = 100
    draw.rounded_rectangle([margin, y, W-margin, y+card_h], radius=10, fill=card_bg)
    # 分数
    score_color = ok_c if score >= 7.0 else (bad_c if score < 6.0 else warn_c)
    draw.text((margin+30, y+20), f"{score:.2f}", font=f_score, fill=score_color)
    draw.text((margin+30, y+75), "综合评分", font=f_small, fill=dim_c)
    # 结论
    concl_color = ok_c if "通过" in conclusion or "合格" in conclusion else bad_c
    draw.text((margin+200, y+30), conclusion, font=f_section, fill=concl_color)
    # 语种
    langs = report.get("languages", "")
    if langs:
        draw.text((margin+200, y+65), f"语种：{langs}", font=f_small, fill=dim_c)
    y += card_h + 25

    # 各维度
    for sec in sections_data:
        if not sec["items"]:
            continue
        # 维度标题
        draw.text((margin, y), sec["title"], font=f_section, fill=section_c)
        y += 32
        # 内容卡片
        card_top = y
        for item in sec["items"]:
            y = _draw_text_block(draw, margin+20, y, item, f_body, body_c, content_w-40) + 6
        card_bottom = y + 10
        draw.rounded_rectangle([margin, card_top-8, W-margin, card_bottom], radius=8, fill=card_bg)
        # 重新绘制文字（因为矩形覆盖了）
        yy = card_top
        for item in sec["items"]:
            item_color = bad_c if any(k in item for k in ["有问题","不合格","错误","乱码","缺失","异常","返工","不合格"]) else body_c
            yy = _draw_text_block(draw, margin+20, yy, item, f_body, item_color, content_w-40) + 6
        y = card_bottom + 15

    img.save(output_path, "JPEG", quality=88)
    return output_path

def _collect_sections(report):
    """收集各维度的文字内容，用于合成图"""
    sections = []

    # 参考图理解
    req_und = report.get("req_understanding", "") or ""
    if req_und and "调用失败" not in req_und:
        und_items = [l.strip() for l in req_und.split("\n") if l.strip()]
        if und_items:
            sections.append({"title": "参考图/需求图理解", "items": und_items[:15]})

    # 需求对照
    req_check = report.get("req_check", "")
    req_items = [l.strip() for l in req_check.split("\n") if l.strip() and "有问题" in l]
    if req_items:
        sections.append({"title": "需求对照核验", "items": [_strip_num_prefix(i) for i in req_items]})

    # 问题详解
    issues = report.get("issues", "")
    issue_items = []
    parts = re.split(r'(?=\d+[\.、])', issues)
    for p in parts:
        p = _strip_num_prefix(p)
        if p:
            issue_items.append(p)
    if issue_items:
        sections.append({"title": "问题详解", "items": issue_items})

    # 美术审美
    aes = report.get("aesthetic_check", "")
    aes_items = []
    for line in aes.split("\n"):
        line = line.strip()
        if "有问题" in line and not line.startswith("综合"):
            aes_items.append(_strip_num_prefix(line))
    if aes_items:
        sections.append({"title": "美术审美", "items": aes_items})

    # 人物/透视/比例/空间位置
    persp = report.get("persp_check", "")
    persp_items = []
    for line in persp.split("\n"):
        line = line.strip()
        if "有问题" in line and not line.startswith("综合"):
            persp_items.append(_strip_num_prefix(line))
    if persp_items:
        sections.append({"title": "人物 / 透视 / 比例 / 空间位置", "items": persp_items})

    # 文字检查
    text_check = report.get("text_check", "")
    text_part, comp_part = _split_text_compliance(text_check)
    if text_part.strip():
        text_items = [l.strip() for l in text_part.split("\n") if l.strip()]
        sections.append({"title": "文字检查", "items": text_items})

    # 合规检查
    if comp_part.strip():
        comp_items = [l.strip() for l in comp_part.split("\n") if l.strip()]
        sections.append({"title": "合规检查", "items": comp_items})

    return sections

def report_to_html(report):
    def esc(s):
        return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    def nl2br(s):
        return esc(s).replace("\n", "<br>")
    def ok_tip():
        return '<div class="ok-tip">✓ 综合判定 - 合格</div>'

    langs_html = "".join(f'<span class="lang-tag">{esc(l)}</span>' for l in report.get("languages", [])) or "（未识别到文字）"

    req_check = report.get("req_check", "")
    req_ok = not _has_problem(req_check, PROBLEM_KW) and req_check.strip() and "未提供" not in req_check
    # 参考图深度理解结果
    req_understanding = report.get("req_understanding", "") or ""
    req_understanding_html = ""
    if req_understanding and "调用失败" not in req_understanding:
        req_understanding_html = f'<div class="req-understanding"><div class="req-und-title">📋 参考图/需求图理解</div><div class="text-body req-und-body">{nl2br(req_understanding)}</div></div>'
    req_html = req_understanding_html + f'<div class="text-body">{nl2br(req_check)}</div>' + (ok_tip() if req_ok else "")

    scores = report.get("scores", {})
    score_html = ""
    for k, v in scores.items():
        low = "low" if v < 6 else ""
        score_html += f'''<div class="score-item">
            <div class="score-top"><span class="score-name">{esc(k)}</span><span class="score-val {low}">{v}</span></div>
            <div class="score-bar"><div class="score-fill {low}" style="width:{v*10}%"></div></div></div>'''

    issues_text = report.get("issues", "")
    issue_cards = ""
    parts = re.split(r'(?=\d+[\.、])', issues_text)
    idx = 0
    for p in parts:
        p = _strip_num_prefix(p)
        if not p:
            continue
        idx += 1
        pos_m = re.search(r'位置[：:]\s*([^|\n]+)', p)
        reason_m = re.search(r'原因[：:]\s*([^|\n]+)', p)
        fix_m = re.search(r'改法[：:]\s*([^|\n]+)', p)
        pos = pos_m.group(1).strip() if pos_m else ""
        reason = reason_m.group(1).strip() if reason_m else ""
        fix = fix_m.group(1).strip() if fix_m else ""
        if not pos and not reason and not fix:
            issue_cards += f'<div class="issue-card"><div class="issue-body"><div class="issue-text">{nl2br(p)}</div></div></div>'
        else:
            issue_cards += f'''<div class="issue-card">
                <div class="issue-body">
                    <div class="issue-row"><span class="issue-label">位置</span><span class="issue-value"><b>{esc(pos)}</b></span></div>
                    <div class="issue-row"><span class="issue-label">原因</span><span class="issue-value">{esc(reason)}</span></div>
                    <div class="issue-row"><span class="issue-label">改法</span><span class="issue-value fix">{esc(fix)}</span></div>
                </div></div>'''
    if idx == 0:
        issue_cards = ok_tip()

    aesthetic = report.get("aesthetic_check", "") or ""
    aes_problems, aes_summary = [], ""
    for line in aesthetic.split("\n"):
        line = line.strip()
        if not line: continue
        if line.startswith("综合判定"): aes_summary = line
        elif "有问题" in line and not line.startswith("综合"): aes_problems.append(_strip_num_prefix(line))
    if aes_problems:
        aes_items = "".join(f'<div class="prob-item">{esc(p)}</div>' for p in aes_problems)
        if aes_summary: aes_items += f'<div class="prob-summary bad">{esc(aes_summary)}</div>'
    else:
        aes_items = ok_tip()

    persp = report.get("persp_check", "") or ""
    persp_problems, persp_summary = [], ""
    for line in persp.split("\n"):
        line = line.strip()
        if not line: continue
        if line.startswith("综合判定"): persp_summary = line
        elif "有问题" in line and not line.startswith("综合"): persp_problems.append(_strip_num_prefix(line))
    if persp_problems:
        persp_items = "".join(f'<div class="prob-item">{esc(p)}</div>' for p in persp_problems)
        if persp_summary: persp_items += f'<div class="prob-summary bad">{esc(persp_summary)}</div>'
    else:
        persp_items = ok_tip() + '<div class="detected-list">已检测：人物（头身比/人体结构/角色尺度/手指肢体/脚部接触/姿态行为/重心）· 空间透视（视平线/近大远小/地面透视/空间位置/结构完整/光影逻辑）</div>'

    text_check = report.get("text_check", "")
    text_part, comp_part = _split_text_compliance(text_check)
    text_ok = not _has_problem(text_part, ["乱码", "错误", "无法确认", "异常", "模糊"]) and text_part.strip()
    comp_ok = not comp_part.strip()
    text_html = f'<div class="text-body">{nl2br(text_part)}</div>' + (ok_tip() if text_ok else "")
    comp_html = f'<div class="text-body">{nl2br(comp_part)}</div>' if comp_part.strip() else ok_tip()

    pf = report.get("precheck", {})
    precheck_html = ""
    if pf.get("fails") or pf.get("warns"):
        items = ""
        if pf.get("fails"): items += "".join(f'<div class="alert bad">🚫 {esc(f)}</div>' for f in pf["fails"])
        if pf.get("warns"): items += "".join(f'<div class="alert warn">⚠️ {esc(w)}</div>' for w in pf["warns"])
        if not report.get("_req_provided", True): items += '<div class="alert info">ℹ️ 未提供需求图，需求对照已跳过</div>'
        precheck_html = f'<div class="qc-section"><div class="section-title">L0 程序化预检</div>{items}</div>'

    return f"""
<div class="qc-report">
  <div class="qc-section"><div class="section-title">语种识别</div><div class="langs">{langs_html}</div></div>
  <div class="qc-section"><div class="section-title">需求对照核验</div>{req_html}</div>
  <div class="qc-section"><div class="section-title">9 维评分</div><div class="score-grid">{score_html}</div></div>
  <div class="qc-section"><div class="section-title">问题详解<span class="section-count">{idx}项</span></div><div class="issues-list">{issue_cards}</div></div>
  <div class="qc-section"><div class="section-title">美术审美</div><div class="prob-list">{aes_items}</div></div>
  <div class="qc-section"><div class="section-title">人物 / 透视 / 比例 / 空间位置</div><div class="prob-list">{persp_items}</div></div>
  <div class="qc-section"><div class="section-title">文字检查</div>{text_html}</div>
  <div class="qc-section"><div class="section-title">合规检查</div>{comp_html}</div>
  {precheck_html}
</div>"""


def merge_req_images(req_paths, max_side=1024):
    """把多张需求图拼成一张拼图，返回 PIL Image。
    布局：1张原图；2张左右；3-4张2x2；5张2行3列。每张图加编号标签。"""
    if not req_paths:
        return None
    try:
        if len(req_paths) == 1:
            im = Image.open(req_paths[0]).convert("RGB")
            draw = ImageDraw.Draw(im)
            try:
                font = ImageFont.truetype(NOTO_BOLD, 28)
            except:
                font = ImageFont.load_default()
            draw.rounded_rectangle([8, 8, 56, 44], radius=6, fill=(37, 99, 235))
            draw.text((20, 12), "1", font=font, fill=(255,255,255))
            return im
        cell_h = 256
        cells = []
        for i, p in enumerate(req_paths):
            try:
                im = Image.open(p).convert("RGB")
            except Exception as e:
                print(f"跳过无法打开的需求图 {p}: {e}")
                continue
            scale = cell_h / im.height
            cw = int(im.width * scale)
            im = im.resize((cw, cell_h), Image.LANCZOS)
            draw = ImageDraw.Draw(im)
            try:
                font = ImageFont.truetype(NOTO_BOLD, 24)
            except:
                font = ImageFont.load_default()
            draw.rounded_rectangle([6, 6, 48, 38], radius=5, fill=(37, 99, 235))
            label = str(i+1)
            tw = draw.textbbox((0,0), label, font=font)[2]
            draw.text((27-tw//2, 9), label, font=font, fill=(255,255,255))
            cells.append(im)
        if not cells:
            return None
        if len(cells) == 1:
            return cells[0]
        n = len(cells)
        cols = 2 if n <= 4 else 3
        rows = (n + cols - 1) // cols
        row_widths = []
        for r in range(rows):
            row_cells = cells[r*cols:(r+1)*cols]
            row_widths.append(sum(c.width for c in row_cells) + (len(row_cells)-1)*8)
        canvas_w = max(row_widths)
        canvas_h = rows * cell_h + (rows-1)*8
        canvas = Image.new("RGB", (canvas_w, canvas_h), (30, 30, 34))
        y = 0
        for r in range(rows):
            row_cells = cells[r*cols:(r+1)*cols]
            x = (canvas_w - sum(c.width for c in row_cells) - (len(row_cells)-1)*8) // 2
            for c in row_cells:
                canvas.paste(c, (x, y))
                x += c.width + 8
            y += cell_h + 8
        return canvas
    except Exception as e:
        print(f"拼图失败，降级返回第一张图: {e}")
        for p in req_paths:
            try:
                return Image.open(p).convert("RGB")
            except:
                continue
        return None


def run_review(req_path, eff_path):
    # 支持单张路径或路径列表
    if isinstance(req_path, list):
        req_paths = [p for p in req_path if p and os.path.exists(p)]
    elif req_path and os.path.exists(req_path):
        req_paths = [req_path]
    else:
        req_paths = []
    req_im = merge_req_images(req_paths) if req_paths else None
    eff_im = Image.open(eff_path).convert("RGB")
    req_provided = req_im is not None
    eff_name = os.path.basename(eff_path)
    fails, warns = review_auto.tech_precheck(eff_name, eff_im)
    req_b64 = review_auto.compress(req_im, MAX_SIDE, QUALITY)[0] if req_im else None
    eff_b64, eff_size = review_auto.compress(eff_im, MAX_SIDE, QUALITY)

    if req_provided:
        req_note = f"（共{len(req_paths)}张，左上角蓝色数字为编号）" if len(req_paths) > 1 else ""
        # r1b：先深度理解参考图/需求图的关键信息
        r1b_prompt = f"分析需求/参考图{req_note}，按编号列出：1)类型 2)核心内容 3)风格 4)可见文字 5)核心元素 6)色彩 7)构图。最后总结：风格要求、必须元素、必须文字、禁止内容。简短。"
        r1b = review_auto.call_retry(API_KEY, API_BASE, [
            {"type": "text", "text": r1b_prompt},
            {"type": "image_url", "image_url": {"url": req_b64}},
        ], retries=1, fail_silent=True)
        if not r1b.strip():
            r1b = "（参考图理解调用失败）"
        time.sleep(3)

        # r1：严格对照检查效果图
        r1_prompt = f"图1是需求说明和参考图{req_note}。图2是设计师交付的效果图。\n\n请严格逐项对照检查，每项必须明确答'符合'或'不符合+具体问题（引用参考图编号）'：\n1. 核心卖点/主题：效果图是否准确传达需求中的核心卖点和主题？有无偏离？\n2. 风格画风：是否与参考图风格一致（写实/卡通/赛博朋克/古风/欧卡/像素等）？笔触、渲染质感、线条风格是否统一？\n3. 文案文字：效果图中所有文字（标题/副标题/logo/按钮/价格/小字）是否与需求一致？文字内容、语言（简中/繁中/英文/多语言）、位置、字体风格是否符合？有无多余文字或乱码？\n4. 内容元素：需求要求的核心元素（角色/道具/场景/产品/logo）是否都出现？有无多余、缺失或错误？\n5. 构图视角：构图、视角、主体位置、视觉动线是否与参考图一致？\n6. 色彩氛围：主色调、色彩搭配、饱和度、氛围情绪是否与参考图一致？\n7. 角色/人物：角色形象、服装、表情、动作是否符合需求？\n8. 尺寸比例：画面比例、元素大小比例是否符合需求？\n\n最后一行格式：综合判定: 合格/不合格+最主要的1-2个问题"
        r1 = review_auto.call_retry(API_KEY, API_BASE, [
            {"type": "text", "text": r1_prompt},
            {"type": "image_url", "image_url": {"url": req_b64}},
            {"type": "image_url", "image_url": {"url": eff_b64}},
        ], retries=1, fail_silent=True)
        if not r1.strip():
            r1 = "（需求对照调用失败，请重试或人工检查）"
        time.sleep(3)
    else:
        r1 = "（未提供需求图，已跳过需求对照）"
        r1b = ""

    r2 = review_auto.call_retry(API_KEY, API_BASE, [
        {"type": "text", "text": "逐区域扫描这张图所有文字（顶部/上部/中部/下部/底部/左侧/右侧），列出可辨识文字（不超过20条）：内容+位置+分类（logo/招牌/正文/小字/装饰/疑似乱码/无法确认）。看不清的标'（模糊）'，不得跳过关键文字。再查：1)违规内容（血腥/色情/裸露/违禁品/政治敏感）2)广告法禁用词（最/第一/顶级/国家级/绝对）3)多语言正确性。最后一行：语种: 简中,英文,繁中（无文字写'语种: 无文字'）。简短。"},
        {"type": "image_url", "image_url": {"url": eff_b64}},
    ], retries=1, fail_silent=True)
    if not r2.strip():
        r2 = review_auto.call_retry(API_KEY, API_BASE, [
            {"type": "text", "text": "列出这张图所有可辨识文字（logo/招牌/小字），看不清的标'模糊'。查：违规内容/广告法禁用词/多语言。最后一行：语种: 简中,英文,繁中。简短。"},
            {"type": "image_url", "image_url": {"url": eff_b64}},
        ], retries=1, fail_silent=True)
        if not r2.strip():
            r2 = "（文字识别调用失败，请重试或人工检查）"
    time.sleep(3)

    r3 = review_auto.call_retry(API_KEY, API_BASE, [
        {"type": "text", "text": "给这张游戏宣传图9个维度各打1-10分，只输出 composition:8,color:7,lighting:6,subject:8,craft:6,text_typo:9,selling_point:7,creativity:7,persp_prop:6 格式。"},
        {"type": "image_url", "image_url": {"url": eff_b64}},
    ], retries=1, fail_silent=True)
    if not r3.strip():
        r3 = "composition:7,color:7,lighting:7,subject:7,craft:7,text_typo:7,selling_point:7,creativity:7,persp_prop:7"
    time.sleep(3)

    r35 = review_auto.call_retry(API_KEY, API_BASE, [
        {"type": "text", "text": "检查这张图透视、比例、合理性逻辑、空间位置与结构完整性，逐项只答'正常'或'有问题+简短说明'，最后一行'综合判定: 正常或有问题+位置'。无人物项标'无人物'。识别不清的结构标注'（细节不足）'。重点抓：尺度不合理(狗比人大/大人坐儿童车/门比人矮)、反重力/穿模/悬空、人物脚部未踩实/站在不合理位置(护栏/扶梯边缘/空中)、空间位置不合理(人物或桌椅在栏杆外侧/护栏外/楼层边缘悬空侧/橱窗内/屋顶/不可达区域/边缘无防护；特别检查高处楼层栏杆内外侧，人物和桌椅必须在栏杆内侧安全区域)、业态陈列不匹配、反关节/不可能姿势、光源矛盾/阴影错、透视矛盾/近大远小错、结构不完整(椅子缺腿/3条腿/桌子缺腿/车轮缺失/部件残缺/多肢缺肢)。清单：1)头身比 2)人体结构 3)角色间尺度 4)人物道具尺度 5)视平线消失点 6)近大远小 7)地面透视 8)遮挡接触 9)重心 10)脚部接触 11)姿态行为 12)手指肢体 13)物理逻辑 14)场景逻辑 15)空间位置 16)光影逻辑 17)结构完整"},
        {"type": "image_url", "image_url": {"url": eff_b64}},
    ], retries=1, fail_silent=True)
    time.sleep(3)

    r36 = review_auto.call_retry(API_KEY, API_BASE, [
        {"type": "text", "text": "检查这张图美术审美，逐项只答'正常'或'有问题+简短说明'，最后一行'综合判定: 正常或有问题+位置'。重点抓：黑白灰缺失/发灰/对比不足、色彩杂乱/冷暖失衡、主次不分/多焦点、拥挤或空旷、笔触不统一、风格混搭、氛围不符。清单：1)黑白灰 2)色彩关系 3)视觉中心 4)负空间 5)笔触质感 6)风格统一 7)色彩数量 8)氛围情绪"},
        {"type": "image_url", "image_url": {"url": eff_b64}},
    ], retries=1, fail_silent=True)
    time.sleep(3)

    r4 = review_auto.call_retry(API_KEY, API_BASE, [
        {"type": "text", "text": "列出这张效果图2-3个最需要修改的问题，每条格式：序号|位置描述|原因|改法|坐标x1%,y1%,x2%,y2%（画面百分比，左上0,0 右下100,100）。只输出列表。"},
        {"type": "image_url", "image_url": {"url": eff_b64}},
    ], retries=1, fail_silent=True)
    if not r4.strip():
        r4 = "1|整体|问题清单调用失败|请重试或人工检查|0,0,100,100"

    report = review_auto.build_report(r1, r2, r3, r4, eff_size,
                                      req_provided=req_provided,
                                      precheck=(fails, warns),
                                      persp_text=r35,
                                      aesthetic_text=r36)
    report["req_understanding"] = r1b  # 参考图/需求图深度理解结果
    try:
        anno, nbox = annotate_image(eff_path, r4)
        report["_annotated"] = image_to_data_url(anno)
        report["_box_count"] = nbox
        # 保存标注图到文件，供合成图使用
        anno_path = os.path.join(UPLOAD_DIR, f"anno_{uuid.uuid4().hex[:12]}.png")
        anno.save(anno_path, "PNG")
        report["_annotated_path"] = anno_path
    except Exception as e:
        report["_annotated"] = None
        report["_box_count"] = 0
        report["_annotated_path"] = ""
    report["_req_provided"] = req_provided
    return report


@app.route("/api/upload", methods=["POST"])
def api_upload():
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "缺少文件"}), 400
    img_type = request.form.get("type", "eff")
    ext = os.path.splitext(f.filename)[1] or ".jpg"
    if ext.lower() not in [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]:
        ext = ".jpg"
    fname = f"{img_type}_{uuid.uuid4().hex[:12]}{ext}"
    fpath = os.path.join(UPLOAD_DIR, fname)
    f.save(fpath)
    try:
        im = Image.open(fpath)
        im.verify()
        w, h = Image.open(fpath).size
    except Exception:
        os.remove(fpath)
        return jsonify({"error": "图片无法解码"}), 400
    return jsonify({"id": fname, "url": f"/uploads/{fname}", "width": w, "height": h, "type": img_type})


@app.route("/api/review", methods=["POST"])
def api_review():
    data = request.get_json(force=True)
    eff_id = data.get("eff_id")
    req_ids = data.get("req_ids", []) or []
    if not eff_id:
        return jsonify({"error": "缺少效果图"}), 400
    eff_path = os.path.join(UPLOAD_DIR, eff_id)
    if not os.path.exists(eff_path):
        return jsonify({"error": "效果图不存在"}), 404
    # 收集所有有效需求图路径
    req_paths = []
    for rid in req_ids:
        if not rid: continue
        rp = os.path.join(UPLOAD_DIR, rid)
        if os.path.exists(rp):
            req_paths.append(rp)
    req_path = req_paths if req_paths else None
    try:
        report = run_review(req_path, eff_path)
    except Exception as e:
        import traceback
        print(f"[ERROR] run_review 失败: {e}")
        print(traceback.format_exc())
        return jsonify({"error": f"评审失败：{e}"}), 500

    # 生成合成图（标注图+文字质检单合一）
    summary_url = ""
    try:
        annotated_path = report.get("_annotated_path", "")
        if annotated_path and os.path.exists(annotated_path):
            summary_id = f"summary_{uuid.uuid4().hex[:12]}.jpg"
            summary_path = os.path.join(UPLOAD_DIR, summary_id)
            generate_summary_image(report, annotated_path, summary_path)
            summary_url = f"/uploads/{summary_id}"
    except Exception as e:
        print(f"合成图生成失败: {e}")

    return jsonify({
        "verdict": report.get("verdict"),
        "weighted_total": report.get("weighted_total"),
        "pass_line": report.get("pass_line"),
        "veto_hits": report.get("veto_hits", []),
        "annotated": report.get("_annotated"),
        "box_count": report.get("_box_count", 0),
        "summary_image": summary_url,
        "report_html": report_to_html(report),
    })


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


CANVAS_PAGE = r"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>美术素材自动质检 · 画布</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;overflow:hidden;background:#18181c;font-family:'PingFang SC','Roboto',Arial,sans-serif;color:#e0e0e0}
.canvas-wrap{position:fixed;top:0;left:0;right:0;bottom:0;overflow:hidden;cursor:grab;background:#18181c}
.canvas-wrap.panning{cursor:grabbing}
.canvas{position:absolute;top:0;left:0;width:5000px;height:4000px;transform-origin:0 0;background-image:radial-gradient(circle,#2a2a30 1px,transparent 1px);background-size:28px 28px}
.svg-layer{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1}
.float-ctrl{position:fixed;bottom:16px;right:16px;z-index:100;display:flex;align-items:center;gap:4px;background:rgba(45,45,45,.95);border:1px solid #3a3a40;border-radius:6px;padding:4px 8px;backdrop-filter:blur(8px)}
.float-ctrl button{width:24px;height:24px;background:transparent;border:1px solid #3a3a40;border-radius:4px;color:#999;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center}
.float-ctrl button:hover{border-color:#2563eb;color:#fff}
.float-ctrl .zoom-val{font-size:10px;color:#777;min-width:38px;text-align:center}
.float-ctrl .clear-btn{width:auto;padding:0 10px;font-size:10px;margin-left:6px}
/* 卡片 */
.card{position:absolute;z-index:2;background:#2d2d2d;border:1px solid #3a3a40;border-radius:10px;overflow:hidden;user-select:none;min-width:180px;transition:border-color .15s}
.card:hover{border-color:#3a3a3a}
.card.selected{border-color:#555;box-shadow:0 0 0 1px #555}
.card.result{background:#0d0d0d;border-color:#2a2a2a;z-index:3}
.card-header{padding:7px 10px;font-size:10px;font-weight:500;cursor:move;display:flex;justify-content:space-between;align-items:center;background:#252528;color:#999;border-bottom:1px solid #3a3a40}
.card-header .del{cursor:pointer;opacity:.3;font-size:13px;line-height:1;padding:0 2px}
.card-header .del:hover{opacity:1;color:#ff6b6b}
.card-body{padding:8px}
.card-img{display:block;max-width:240px;max-height:180px;object-fit:contain;border-radius:6px;margin:0 auto;cursor:zoom-in;user-select:none;-webkit-user-drag:none}
/* 效果图右侧绿点 */
.eff-connector{position:absolute;right:-6px;top:50%;transform:translateY(-50%);width:12px;height:12px;background:#4ade80;border:2px solid #fff;border-radius:50%;cursor:grab;z-index:5;opacity:0;transition:opacity .15s,transform .15s;box-shadow:0 0 6px rgba(74,222,128,.5)}
.card:hover .eff-connector{opacity:1}
.eff-connector:hover{transform:translateY(-50%) scale(1.25)}
.eff-connector:active{cursor:grabbing}
/* 自动审核按钮 */
.auto-review-btn{position:absolute;z-index:20;background:#252528;border:1px solid #3a3a40;border-radius:7px;padding:9px 18px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .15s;box-shadow:0 4px 16px rgba(0,0,0,.4)}
.auto-review-btn:hover{background:#2563eb;border-color:#2563eb}
.auto-review-btn::before{content:'';position:absolute;left:-7px;top:50%;transform:translateY(-50%);width:0;height:0;border-top:5px solid transparent;border-bottom:5px solid transparent;border-right:6px solid #3a3a3a}
/* 审核配置弹窗 */
.review-modal{position:absolute;z-index:30;background:#2d2d2d;border:1px solid #3a3a40;border-radius:12px;padding:0;width:380px;box-shadow:0 8px 32px rgba(0,0,0,.6);overflow:hidden}
.review-modal .modal-header{padding:14px 16px;font-size:13px;font-weight:600;color:#fff;cursor:move;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #3a3a40}
.review-modal .modal-header .del{cursor:pointer;opacity:.4;font-size:14px}
.review-modal .modal-header .del:hover{opacity:1;color:#ff6b6b}
.review-modal .modal-body{padding:16px}
.review-modal .field-label{font-size:11px;color:#888;margin-bottom:8px;font-weight:500}
.review-modal .req-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:14px}
.review-modal .req-slot{border:1px dashed #4a4a50;border-radius:6px;height:62px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;transition:border-color .15s;background:#252528;cursor:pointer}
.review-modal .req-slot.drag-over{border-color:#2563eb;background:#1e2540}
.review-modal .req-slot .placeholder{color:#555;font-size:9px;text-align:center;line-height:1.4}
.review-modal .req-slot .placeholder .num{font-size:12px;font-weight:600;color:#666;display:block;margin-bottom:1px}
.review-modal .req-slot img{max-width:100%;max-height:100%;object-fit:cover;width:100%;height:100%}
.review-modal .req-slot .req-remove{position:absolute;top:3px;right:3px;width:16px;height:16px;background:rgba(0,0,0,.7);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:10px;color:#fff;opacity:0;transition:opacity .15s;z-index:2}
.review-modal .req-slot:hover .req-remove{opacity:1}
.review-modal .exec-btn{width:100%;padding:11px;background:#2563eb;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s}
.review-modal .exec-btn:hover{background:#1d4ed8}
.review-modal .exec-btn:disabled{background:#444;cursor:not-allowed}
/* 结果大卡片 */
.card.result{width:680px;max-width:680px}
.card.result .card-body{max-height:none;overflow:visible;padding:14px;user-select:text}
.result-head{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid #3a3a40;user-select:text}
.dl-summary{font-size:11px;color:#fff;background:#2563eb;border:1px solid #2563eb;border-radius:4px;padding:4px 10px;text-decoration:none;cursor:pointer;white-space:nowrap}
.dl-summary:hover{background:#1d4ed8;border-color:#1d4ed8}
.result-verdict{padding:3px 12px;border-radius:4px;font-weight:600;font-size:13px}
.result-verdict.bad{background:#2a1515;color:#ff8a8a;border:1px solid #3a2020}
.result-verdict.good{background:#152a1a;color:#6adf9a;border:1px solid #203a25}
.result-score{font-size:20px;font-weight:700;color:#fff}
.result-score span{font-size:11px;color:#666;font-weight:400}
.result-anno{width:100%;border-radius:5px;margin-bottom:14px;cursor:zoom-in;border:1px solid #222;user-select:none}
/* 质检单富文本 */
.qc-report{font-size:12px;line-height:2.0;color:#bbb;user-select:text}
.qc-report *{user-select:text}
.qc-section{margin-bottom:20px}
.section-title{font-size:11px;font-weight:600;color:#ccc;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;padding-bottom:7px;border-bottom:1px solid #1a1a1a;letter-spacing:.5px}
.section-count{font-size:9px;color:#666;font-weight:400}
.ok-tip{font-size:10.5px;color:#6adf9a;background:#101a12;border:1px solid #1a2a1e;border-radius:4px;padding:6px 10px;margin-top:6px;text-align:center}
.detected-list{font-size:10px;color:#555;padding:6px 10px;line-height:1.7;margin-top:4px;text-align:center}
.issues-list{display:flex;flex-direction:column;gap:12px}
.issue-card{display:flex;gap:12px;background:#252528;border:1px solid #3a3a40;border-radius:6px;padding:14px 16px}
.issue-num{flex-shrink:0;width:24px;height:24px;background:#333;color:#ccc;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600}
.issue-body{flex:1;display:flex;flex-direction:column;gap:8px}
.issue-row{display:flex;gap:10px;align-items:flex-start}
.issue-label{flex-shrink:0;font-size:10px;color:#888;min-width:36px;padding-top:3px;font-weight:600}
.issue-value{font-size:12px;color:#ccc;flex:1;line-height:1.9}
.issue-value.fix{color:#8bc8ea;font-weight:500}
.issue-value b{color:#fff;font-weight:600}
.issue-text{font-size:12px;color:#ccc;line-height:2.0}
.score-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.score-item{background:#252528;border:1px solid #3a3a40;border-radius:5px;padding:10px 12px}
.score-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px}
.score-name{font-size:9px;color:#777}
.score-val{font-size:15px;font-weight:700;color:#ddd}
.score-val.low{color:#ff8a8a}
.score-bar{height:3px;background:#1a1a20;border-radius:2px;overflow:hidden}
.score-fill{height:100%;background:#555;border-radius:2px}
.score-fill.low{background:#553333}
.prob-list{display:flex;flex-direction:column;gap:6px}
.prob-item{font-size:11.5px;padding:8px 12px;background:#141010;border-left:2px solid #553333;border-radius:0 4px 4px 0;color:#cc9999;line-height:1.9}
.prob-summary{font-size:11px;font-weight:600;padding:8px 12px;border-radius:4px;margin-top:8px}
.prob-summary.bad{color:#ff8a8a;background:#1a1010;border:1px solid #2a1818}
.text-body{font-size:11.5px;color:#aaa;white-space:pre-wrap;word-break:break-word;line-height:2.0;background:#252528;padding:14px 16px;border-radius:5px;border:1px solid #3a3a40}
.req-understanding{margin-bottom:12px}
.req-und-title{font-size:11px;font-weight:600;color:#8ab4f8;margin-bottom:6px;padding-left:2px}
.req-und-body{font-size:11px;line-height:1.9;color:#999;background:#1e2535;border-color:#2a3550}
.langs{display:flex;gap:6px;flex-wrap:wrap}
.lang-tag{background:#252528;color:#999;padding:4px 10px;border-radius:4px;font-size:10.5px;border:1px solid #3a3a40}
.alert{padding:8px 12px;border-radius:4px;font-size:11px;margin-bottom:5px;line-height:1.9}
.alert.bad{background:#1a1010;color:#ff8a8a;border-left:2px solid #553333}
.alert.warn{background:#1a1510;color:#ccaa66;border-left:2px solid #554433}
.alert.info{background:#10151a;color:#88aacc;border-left:2px solid #334455}
.drop-overlay{position:fixed;inset:0;background:rgba(24,24,28,.92);z-index:200;display:none;align-items:center;justify-content:center;flex-direction:column;gap:14px;border:2px dashed #3a3a40;pointer-events:none}
.drop-overlay.active{display:flex}
.drop-overlay .drop-icon{font-size:48px;opacity:.5}
.drop-overlay .drop-text{font-size:16px;color:#888;font-weight:500}
.drop-overlay .drop-sub{font-size:12px;color:#555}
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:400;display:none;align-items:center;justify-content:center;cursor:zoom-out}
.lightbox.active{display:flex}
.lightbox img{max-width:95vw;max-height:95vh;object-fit:contain;border-radius:3px}
.selection-box{position:absolute;z-index:50;border:1px dashed #666;background:rgba(80,80,80,.08);pointer-events:none;display:none}
.loading{text-align:center;padding:32px 16px;color:#888;font-size:12px;user-select:none}
.loading .spin{display:inline-block;width:24px;height:24px;border:2px solid #3a3a40;border-top-color:#2563eb;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:10px}
@keyframes spin{to{transform:rotate(360deg)}}
.empty-hint{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;color:#3a3a40;pointer-events:none;z-index:0}
.empty-hint .big{font-size:40px;margin-bottom:10px;opacity:.3}
.empty-hint .t1{font-size:14px;color:#4a4a50;margin-bottom:5px}
.empty-hint .t2{font-size:11px;color:#3a3a40;line-height:1.8}
</style></head><body>

<div class="canvas-wrap" id="canvasWrap">
  <div class="canvas" id="canvas">
    <svg class="svg-layer" id="svgLayer"></svg>
    <div class="selection-box" id="selectionBox"></div>
    <div class="empty-hint" id="emptyHint">
      <div class="big">🖼️</div>
      <div class="t1">拖拽效果图到此处，或 Ctrl+V 粘贴</div>
      <div class="t2">hover 效果图 → 拖拽右侧绿点 → 自动审核<br>审核配置框中可拖入需求图（可选）</div>
    </div>
  </div>
</div>

<div class="float-ctrl">
  <button onclick="zoom(-0.1)">−</button>
  <span class="zoom-val" id="zoomVal">100%</span>
  <button onclick="zoom(0.1)">+</button>
  <button onclick="resetView()" title="重置视图">⌂</button>
  <button class="clear-btn" onclick="clearCanvas()">清空</button>
</div>

<div class="drop-overlay" id="dropOverlay">
  <div class="drop-icon">📥</div>
  <div class="drop-text">松开鼠标上传图片</div>
  <div class="drop-sub">支持 JPG / PNG / WebP，可同时上传多张</div>
</div>

<div class="lightbox" id="lightbox" onclick="closeLightbox()"><img id="lightboxImg"></div>

<script>
const canvas = document.getElementById('canvas');
const canvasWrap = document.getElementById('canvasWrap');
const svgLayer = document.getElementById('svgLayer');
const dropOverlay = document.getElementById('dropOverlay');
const emptyHint = document.getElementById('emptyHint');
const selectionBox = document.getElementById('selectionBox');

let scale = 1, panX = 0, panY = 0;
let cards = {}, results = {};
let selectedSet = new Set();
let cardZ = 10;

// ========== 画布变换 ==========
function applyTransform(){
  canvas.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
  document.getElementById('zoomVal').textContent = Math.round(scale*100)+'%';
  redrawLinks();
}
function zoom(delta){
  const old = scale;
  scale = Math.max(0.2, Math.min(3, scale + delta));
  const rect = canvasWrap.getBoundingClientRect();
  const cx = rect.width/2, cy = rect.height/2;
  panX = cx - (cx - panX) * (scale/old);
  panY = cy - (cy - panY) * (scale/old);
  applyTransform();
}
function resetView(){ scale=1; panX=0; panY=0; applyTransform(); }
canvasWrap.addEventListener('wheel', e=>{ e.preventDefault(); zoom(e.deltaY > 0 ? -0.1 : 0.1); }, {passive:false});

// ========== 空白拖拽平移 + Shift框选 ==========
let panning=false, pSX, pSY, pOX, pOY;
canvasWrap.addEventListener('mousedown', e=>{
  if(e.target.closest('.card')) return;
  if(e.target.closest('.review-modal')) return;
  if(e.target.classList.contains('eff-connector')) return;
  if(e.target.classList.contains('auto-review-btn')) return;
  if(e.shiftKey){ startSelection(e); }
  else { panning=true; pSX=e.clientX; pSY=e.clientY; pOX=panX; pOY=panY; canvasWrap.classList.add('panning'); clearSelection(); }
});
document.addEventListener('mousemove', e=>{
  if(panning){ panX=pOX+(e.clientX-pSX); panY=pOY+(e.clientY-pSY); applyTransform(); }
  updateSelection(e);
  updateConnectorDrag(e);
});
document.addEventListener('mouseup', e=>{
  if(panning){ panning=false; canvasWrap.classList.remove('panning'); }
  endSelection(e);
  endConnectorDrag(e);
});

// ========== 框选 ==========
let selecting=false, selOX, selOY;
function startSelection(e){
  selecting=true;
  const cr=canvas.getBoundingClientRect();
  selOX=(e.clientX-cr.left)/scale; selOY=(e.clientY-cr.top)/scale;
  selectionBox.style.display='block';
  selectionBox.style.left=selOX+'px'; selectionBox.style.top=selOY+'px';
  selectionBox.style.width='0px'; selectionBox.style.height='0px';
  clearSelection();
}
function updateSelection(e){
  if(!selecting) return;
  const cr=canvas.getBoundingClientRect();
  const cx=(e.clientX-cr.left)/scale, cy=(e.clientY-cr.top)/scale;
  const x=Math.min(selOX,cx), y=Math.min(selOY,cy), w=Math.abs(cx-selOX), h=Math.abs(cy-selOY);
  selectionBox.style.left=x+'px'; selectionBox.style.top=y+'px';
  selectionBox.style.width=w+'px'; selectionBox.style.height=h+'px';
}
function endSelection(e){
  if(!selecting) return;
  selecting=false; selectionBox.style.display='none';
  const sb=selectionBox.getBoundingClientRect();
  if(sb.width<5||sb.height<5){ clearSelection(); return; }
  Object.entries(cards).forEach(([id,c])=>{
    const r=c.el.getBoundingClientRect();
    if(r.left>=sb.left-2&&r.top>=sb.top-2&&r.right<=sb.right+2&&r.bottom<=sb.bottom+2){
      selectedSet.add(id); c.el.classList.add('selected');
    }
  });
}
function clearSelection(){
  selectedSet.forEach(id=>{ if(cards[id]) cards[id].el.classList.remove('selected'); });
  selectedSet.clear();
}

// ========== 拖拽上传 ==========
let dragCounter=0, lastDropX=0, lastDropY=0;
window.addEventListener('dragenter', e=>{ e.preventDefault(); dragCounter++; dropOverlay.classList.add('active'); });
window.addEventListener('dragleave', e=>{ e.preventDefault(); dragCounter--; if(dragCounter<=0){dragCounter=0;dropOverlay.classList.remove('active');} });
window.addEventListener('dragover', e=>{ e.preventDefault(); });
window.addEventListener('dragend', ()=>{ dragCounter=0; dropOverlay.classList.remove('active'); });
window.addEventListener('drop', async e=>{
  e.preventDefault();
  dragCounter=0; dropOverlay.classList.remove('active');
  // 拖到审核弹窗的需求图区域时，由该区域自己的 drop 处理，不做全局上传
  if(e.target && e.target.closest && e.target.closest('.req-slot')) return;
  lastDropX=e.clientX; lastDropY=e.clientY;
  const files=Array.from(e.dataTransfer.files||[]).filter(f=>f.type&&f.type.startsWith('image/'));
  if(files.length===0) return;
  for(let i=0;i<files.length;i++){ try{ await uploadFile(files[i], i); }catch(err){ console.error('上传失败', err); } }
});
window.addEventListener('paste', async e=>{
  if(!e.clipboardData||!e.clipboardData.items) return;
  const items=e.clipboardData.items; let idx=0;
  for(const item of items){
    if(item.type&&item.type.startsWith('image/')){
      const f=item.getAsFile();
      if(f){ try{ await uploadFile(f, idx++); }catch(err){ console.error('粘贴上传失败', err); } }
    }
  }
});
// 前端压缩图片（短边≤768，JPEG q80），减少上传体积
async function compressImage(file, maxSide=768, quality=0.8){
  return new Promise((resolve)=>{
    if(!file.type || !file.type.startsWith('image/')){ resolve(file); return; }
    const img = new Image();
    img.onload = ()=>{
      const scale = Math.min(1, maxSide/Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width*scale)), h = Math.max(1, Math.round(img.height*scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob)=>{
        if(blob) resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {type:'image/jpeg'}));
        else resolve(file);
      }, 'image/jpeg', quality);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = ()=>{ resolve(file); };
    img.src = URL.createObjectURL(file);
  });
}
async function uploadFile(file, offsetIdx=0){
  const fd=new FormData(); fd.append('file', file); fd.append('type', 'eff');
  try{
    const res=await fetch('/api/upload',{method:'POST',body:fd});
    const data=await res.json();
    if(data.error){ console.error(data.error); return; }
    addEffCard(data, offsetIdx);
  }catch(err){ console.error('上传失败', err); }
}
function addEffCard(data, offsetIdx=0){
  emptyHint.style.display='none';
  const id=data.id;
  const el=document.createElement('div');
  el.className='card eff';
  const cr=canvas.getBoundingClientRect();
  let cx, cy;
  if(lastDropX>0){ cx=(lastDropX-cr.left)/scale+offsetIdx*50; cy=(lastDropY-cr.top)/scale+offsetIdx*50; }
  else{ const rect=canvasWrap.getBoundingClientRect(); cx=(rect.width/2-panX)/scale+(Math.random()-0.5)*180; cy=(rect.height/2-panY)/scale+(Math.random()-0.5)*120; }
  el.style.left=cx+'px'; el.style.top=cy+'px'; el.style.zIndex=++cardZ;
  el.innerHTML=`
    <div class="card-header"><span>效果图 · ${data.width}×${data.height}</span><span class="del" onclick="delCard('${id}')">×</span></div>
    <div class="card-body"><img class="card-img" src="${data.url}" draggable="false" onclick="openLightbox(this.src)"></div>
    <div class="eff-connector" title="拖拽开始审核"></div>`;
  canvas.appendChild(el);
  cards[id]={el, x:cx, y:cy};
  makeDraggable(el, id);
  setupEffConnector(el, id);
  redrawLinks();
}

// ========== 卡片拖动（支持框选整体拖动）==========
function makeDraggable(el, id){
  const header=el.querySelector('.card-header') || el.querySelector('.modal-header');
  if(!header) return;
  let sx, sy, ox, oy, dragging=false, dragSelected=false, selectedOffsets={};
  header.addEventListener('mousedown', e=>{
    if(e.target.classList.contains('del')) return;
    dragging=true; sx=e.clientX; sy=e.clientY;
    if(cards[id]){ ox=cards[id].x; oy=cards[id].y; el.style.zIndex=++cardZ; }
    else { ox=parseFloat(el.style.left)||0; oy=parseFloat(el.style.top)||0; }
    if(selectedSet.has(id)){
      dragSelected=true; selectedOffsets={};
      selectedSet.forEach(sid=>{ if(cards[sid]) selectedOffsets[sid]={x:cards[sid].x,y:cards[sid].y}; });
    } else { dragSelected=false; clearSelection(); }
    e.preventDefault(); e.stopPropagation();
  });
  document.addEventListener('mousemove', e=>{
    if(!dragging) return;
    const dx=(e.clientX-sx)/scale, dy=(e.clientY-sy)/scale;
    if(dragSelected){
      selectedSet.forEach(sid=>{
        if(!cards[sid]||!selectedOffsets[sid]) return;
        const nx=selectedOffsets[sid].x+dx, ny=selectedOffsets[sid].y+dy;
        cards[sid].x=nx; cards[sid].y=ny;
        cards[sid].el.style.left=nx+'px'; cards[sid].el.style.top=ny+'px';
      });
    } else {
      const nx=ox+dx, ny=oy+dy;
      if(cards[id]){ cards[id].x=nx; cards[id].y=ny; }
      el.style.left=nx+'px'; el.style.top=ny+'px';
    }
    redrawLinks();
  });
  document.addEventListener('mouseup', ()=>{ dragging=false; });
}

// ========== 效果图绿点拖拽 → 自动审核按钮 ==========
let draggingConnector=false, connectorEffId=null, connStartX=0, connStartY=0;
let autoReviewBtn=null, connectorLine=null;
function setupEffConnector(el, effId){
  const conn=el.querySelector('.eff-connector');
  conn.addEventListener('mousedown', e=>{
    e.stopPropagation(); e.preventDefault();
    // 清除之前的
    if(autoReviewBtn){ autoReviewBtn.remove(); autoReviewBtn=null; }
    if(connectorLine){ connectorLine.remove(); connectorLine=null; }
    draggingConnector=true; connectorEffId=effId;
    const cr=canvas.getBoundingClientRect(); const r=el.getBoundingClientRect();
    connStartX=(r.right-cr.left)/scale; connStartY=(r.top+r.height/2-cr.top)/scale;
    connectorLine=document.createElementNS('http://www.w3.org/2000/svg','path');
    connectorLine.setAttribute('stroke','#4ade80'); connectorLine.setAttribute('stroke-width','1.5'); connectorLine.setAttribute('fill','none');
    svgLayer.appendChild(connectorLine);
    autoReviewBtn=document.createElement('div');
    autoReviewBtn.className='auto-review-btn';
    autoReviewBtn.textContent='⚡ 自动审核';
    autoReviewBtn.style.display='none';
    autoReviewBtn.addEventListener('click', (ev)=>{ ev.stopPropagation(); openReviewModal(effId); });
    canvas.appendChild(autoReviewBtn);
  });
}
function updateConnectorDrag(e){
  if(!draggingConnector||!autoReviewBtn) return;
  const cr=canvas.getBoundingClientRect();
  const mx=(e.clientX-cr.left)/scale, my=(e.clientY-cr.top)/scale;
  autoReviewBtn.style.display='block';
  autoReviewBtn.style.left=(mx+12)+'px';
  autoReviewBtn.style.top=(my-16)+'px';
  if(connectorLine){
    const mxx=(connStartX+mx)/2;
    connectorLine.setAttribute('d',`M${connStartX},${connStartY} C${mxx},${connStartY} ${mxx},${my} ${mx+10},${my}`);
  }
}
function endConnectorDrag(e){
  if(!draggingConnector) return;
  draggingConnector=false;
  // 按钮和线保留，点击按钮弹出配置框
}

// ========== 审核配置弹窗 ==========
let currentModal=null, currentModalReqIds=[], currentModalEffId=null;
const MAX_REQ=5;
function openReviewModal(effId){
  if(currentModal){ currentModal.remove(); currentModal=null; }
  currentModalReqIds=[];
  const modal=document.createElement('div');
  modal.className='review-modal';
  let mx=400, my=300;
  if(autoReviewBtn){ const r=autoReviewBtn.getBoundingClientRect(); const cr=canvas.getBoundingClientRect(); mx=(r.right-cr.left)/scale+20; my=(r.top-cr.top)/scale-60; }
  modal.style.left=mx+'px'; modal.style.top=my+'px'; modal.style.zIndex=++cardZ;

  // 生成5个格子的HTML
  let slotsHtml='';
  for(let i=0;i<MAX_REQ;i++){
    slotsHtml+=`<div class="req-slot" data-idx="${i}"><div class="placeholder"><span class="num">${i+1}</span>拖拽</div></div>`;
  }
  modal.innerHTML=`
    <div class="modal-header"><span>审核配置</span><span class="del" onclick="closeReviewModal()">×</span></div>
    <div class="modal-body">
      <div class="field-label">需求图/参考图（可选，最多${MAX_REQ}张）</div>
      <div class="req-grid">${slotsHtml}</div>
      <button class="exec-btn" id="modalExecBtn">执 行</button>
    </div>`;
  canvas.appendChild(modal);
  currentModal=modal;
  currentModalEffId=effId;
  makeDraggable(modal, 'modal_'+effId);

  // 立即移除自动审核按钮和连接线，效果图直接链接到需求框
  if(autoReviewBtn){ autoReviewBtn.remove(); autoReviewBtn=null; }
  if(connectorLine){ connectorLine.remove(); connectorLine=null; }
  redrawLinks();

  // 每个格子的拖放和点击上传
  modal.querySelectorAll('.req-slot').forEach(slot=>{
    const idx=parseInt(slot.dataset.idx);
    slot.addEventListener('dragover', e=>{ e.preventDefault(); e.stopPropagation(); slot.classList.add('drag-over'); });
    slot.addEventListener('dragleave', e=>{ slot.classList.remove('drag-over'); });
    slot.addEventListener('drop', async e=>{
      e.preventDefault(); e.stopPropagation(); slot.classList.remove('drag-over');
      dragCounter=0; dropOverlay.classList.remove('active');
      const files=Array.from(e.dataTransfer.files).filter(f=>f.type&&f.type.startsWith('image/'));
      if(files.length>0) await uploadReqToSlot(slot, idx, files[0]);
    });
    slot.addEventListener('click', ()=>{
      // 已上传的格子点击不触发文件选择（删除按钮单独处理）
      if(currentModalReqIds[idx]) return;
      const input=document.createElement('input');
      input.type='file'; input.accept='image/*';
      input.onchange=async ()=>{ if(input.files[0]) await uploadReqToSlot(slot, idx, input.files[0]); };
      input.click();
    });
  });

  // 执行按钮
  modal.querySelector('#modalExecBtn').addEventListener('click', (e)=>{
    e.stopPropagation();
    const reqIds=currentModalReqIds.filter(Boolean);
    executeReview(effId, reqIds.length>0?reqIds:null);
    closeReviewModal();
  });
}

async function uploadReqToSlot(slot, idx, file){
  const fd=new FormData(); fd.append('file', file); fd.append('type','req');
  const res=await fetch('/api/upload',{method:'POST',body:fd});
  const data=await res.json();
  if(!data.error){
    currentModalReqIds[idx]=data.id;
    slot.innerHTML=`<img src="${data.url}"><div class="req-remove" onclick="event.stopPropagation();removeModalReq(${idx})">×</div>`;
  }
}

function closeReviewModal(){ if(currentModal){ currentModal.remove(); currentModal=null; currentModalReqIds=[]; currentModalEffId=null; redrawLinks(); } }
function removeModalReq(idx){
  currentModalReqIds[idx]=null;
  if(currentModal){
    const slot=currentModal.querySelector(`.req-slot[data-idx="${idx}"]`);
    if(slot) slot.innerHTML=`<div class="placeholder"><span class="num">${idx+1}</span>拖拽</div>`;
  }
}

// ========== 执行审核 ==========
async function executeReview(effId, reqIds){
  const c=cards[effId]; if(!c) return;
  if(results[effId]){ results[effId].remove(); }
  const resEl=document.createElement('div');
  resEl.className='card result';
  const a=getEdgePoint(effId,'right');
  const rx=a?a.x+60:400, ry=a?a.y-200:200;
  resEl.style.left=rx+'px'; resEl.style.top=ry+'px'; resEl.style.zIndex=++cardZ;
  resEl.innerHTML=`<div class="card-header"><span>审核结果</span><span class="del" onclick="delResult('${effId}')">×</span></div>
    <div class="card-body"><div class="loading"><div class="spin"></div>AI 评审中，约 1-3 分钟...</div></div>`;
  canvas.appendChild(resEl);
  results[effId]=resEl;
  makeDraggable(resEl, 'res_'+effId);
  redrawLinks();
  const reqIdsJson=JSON.stringify(reqIds||[]);
  try{
    const res=await fetch('/api/review',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({eff_id:effId, req_ids:reqIds||[]})
    });
    const data=await res.json();
    if(data.error) throw new Error(data.error);
    const vc=['返工','打回'].includes(data.verdict)?'bad':'good';
    const veto=(data.veto_hits||[]).map(v=>`<span style="font-size:9px;color:#ff8a8a;background:#1e1010;padding:2px 7px;border-radius:3px;border:1px solid #2a1818">${v}</span>`).join('')||'<span style="font-size:9px;color:#555">无</span>';
    const anno=data.annotated?`<img class="result-anno" src="${data.annotated}" onclick="openLightbox(this.src)">`:'';
    const dlBtn=data.summary_image?`<a class="dl-summary" href="${data.summary_image}" download="质检报告_${effId}.jpg" title="下载合成图（标注+文字）">⬇ 合成图</a>`:'';
    resEl.querySelector('.card-body').innerHTML=`
      ${anno}
      <div class="result-head">
        <span class="result-verdict ${vc}">${data.verdict}</span>
        <span class="result-score">${data.weighted_total} <span>/ ${data.pass_line}</span></span>
        ${dlBtn}
        <span style="font-size:9px;color:#666">硬规则</span>${veto}
      </div>
      ${data.report_html}`;
  }catch(err){
    resEl.querySelector('.card-body').innerHTML=`<div style="color:#ff8a8a;padding:20px;text-align:center;font-size:12px">审核失败：${err.message}<br><button style="margin-top:10px;padding:6px 16px;background:#2d2d2d;color:#ccc;border:1px solid #3a3a40;border-radius:4px;cursor:pointer;font-size:11px" onclick='executeReview("${effId}",${reqIdsJson})'>重试</button></div>`;
  }
  redrawLinks();
}

// ========== 删除/清空 ==========
function delCard(id){
  const c=cards[id]; if(!c) return;
  c.el.remove(); delete cards[id]; selectedSet.delete(id);
  if(results[id]){ results[id].remove(); delete results[id]; }
  if(Object.keys(cards).length===0) emptyHint.style.display='block';
  redrawLinks();
}
function delResult(effId){ if(results[effId]){ results[effId].remove(); delete results[effId]; redrawLinks(); } }
function clearCanvas(){
  if(!confirm('确定清空画布？')) return;
  Object.values(cards).forEach(c=>c.el.remove());
  Object.values(results).forEach(r=>r.remove());
  if(autoReviewBtn){ autoReviewBtn.remove(); autoReviewBtn=null; }
  if(connectorLine){ connectorLine.remove(); connectorLine=null; }
  closeReviewModal();
  cards={}; results={}; selectedSet.clear();
  emptyHint.style.display='block'; redrawLinks();
}

// ========== 连线 ==========
function getEdgePoint(id, side){
  const c=cards[id]; if(!c) return null;
  const r=c.el.getBoundingClientRect(); const cr=canvas.getBoundingClientRect();
  if(side==='right') return {x:(r.right-cr.left)/scale, y:(r.top+r.height/2-cr.top)/scale};
  if(side==='left') return {x:(r.left-cr.left)/scale, y:(r.top+r.height/2-cr.top)/scale};
  return null;
}
function redrawLinks(){
  const keepLine=connectorLine, keepBtn=autoReviewBtn;
  svgLayer.innerHTML='';
  if(keepLine) svgLayer.appendChild(keepLine);
  // 效果图 → 审核配置弹窗
  if(currentModal && currentModalEffId && cards[currentModalEffId]){
    const a=getEdgePoint(currentModalEffId,'right');
    if(a){
      const r=currentModal.getBoundingClientRect(); const cr=canvas.getBoundingClientRect();
      const b={x:(r.left-cr.left)/scale, y:(r.top+r.height/2-cr.top)/scale};
      const mx=(a.x+b.x)/2;
      const p=document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d',`M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`);
      p.setAttribute('stroke','#4ade80'); p.setAttribute('stroke-width','1.5'); p.setAttribute('fill','none');
      svgLayer.appendChild(p);
    }
  }
  // 效果图 → 审核结果
  Object.entries(results).forEach(([effId,resEl])=>{
    const a=getEdgePoint(effId,'right'); if(!a) return;
    const r=resEl.getBoundingClientRect(); const cr=canvas.getBoundingClientRect();
    const b={x:(r.left-cr.left)/scale, y:(r.top+r.height/2-cr.top)/scale};
    const mx=(a.x+b.x)/2;
    const p=document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d',`M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`);
    p.setAttribute('stroke','#444'); p.setAttribute('stroke-width','1.5'); p.setAttribute('fill','none');
    svgLayer.appendChild(p);
  });
}

// ========== 全屏查看 ==========
function openLightbox(src){ document.getElementById('lightboxImg').src=src; document.getElementById('lightbox').classList.add('active'); }
function closeLightbox(){ document.getElementById('lightbox').classList.remove('active'); }

window.addEventListener('resize', redrawLinks);
applyTransform();
</script>
</body></html>"""


@app.route("/", methods=["GET"])
def index():
    return CANVAS_PAGE


if __name__ == "__main__":
    print(f"质检画布版 v5 启动: http://{HOST}:{PORT}")
    app.run(host=HOST, port=PORT, threaded=True)
