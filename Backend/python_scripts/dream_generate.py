# -*- coding: utf-8 -*-
import sys
import json
import base64
import os
import time
import warnings

# 忽略 urllib3 的 OpenSSL 警告，保持输出干净
warnings.filterwarnings("ignore")

try:
    from volcengine.visual.VisualService import VisualService
except ImportError:
    print(json.dumps({"error": "Failed to import volcengine. Please run: pip3 install volcengine"}))
    sys.exit(1)

def generate_image(ak, sk, prompt, output_dir):
    # 1. 初始化服务
    visual_service = VisualService()
    visual_service.set_ak(ak)
    visual_service.set_sk(sk)
    visual_service.set_host('visual.volcengineapi.com')
    # 修复点：删除 set_region 调用，SDK 会自动处理
    # visual_service.set_region('cn-north-1') 

    # 2. 构造参数
    params = {
        "req_key": "high_quality_image_generation",
        "prompt": prompt,
        "model_version": "general_v4.0", 
        "req_schedule_conf": "general_v40_s",
        "seed": -1,
        "scale": 3.5,
        "ddim_steps": 25,
        "width": 1024,
        "height": 1024,
        "return_url": False,
        "logo_info": {"add_logo": False}
    }

    try:
        # 3. 调用接口
        # 这里的动作名称是 CVProcess
        resp = visual_service.cv_process(params)
        
        # 4. 检查响应
        if not resp:
            print(json.dumps({"error": "Empty response from API"}))
            sys.exit(1)
            
        if isinstance(resp, str):
            resp = json.loads(resp)

        if resp.get("code") != 10000:
            print(json.dumps({"error": f"API Error: {resp.get('message', 'Unknown')}", "details": resp}))
            sys.exit(1)

        data = resp.get("data", {})
        binary_data = data.get("binary_data_base64", [])

        if not binary_data:
            print(json.dumps({"error": "No image data received"}))
            sys.exit(1)

        # 5. 保存图片
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        filename = f"dream_py_{int(time.time())}.png"
        filepath = os.path.join(output_dir, filename)

        with open(filepath, "wb") as f:
            f.write(base64.b64decode(binary_data[0]))

        # 6. 输出结果给 Node.js
        result = {
            "success": True,
            "original_id": resp.get("request_id", "unknown"),
            "filename": filename
        }
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) < 5:
        print(json.dumps({"error": "Missing arguments"}))
        sys.exit(1)

    ak = sys.argv[1]
    sk = sys.argv[2]
    prompt = sys.argv[3]
    output_dir = sys.argv[4]

    generate_image(ak, sk, prompt, output_dir)