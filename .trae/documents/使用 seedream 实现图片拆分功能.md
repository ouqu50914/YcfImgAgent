# 使用 seedream 实现图片拆分功能

## 实现步骤

### 1. 后端实现

#### 1.1 更新 AI 适配器接口
- 在 `Backend/src/adapters/ai-provider.interface.ts` 中添加 `SplitParams` 接口，定义图片拆分的参数
- 在 `AiProvider` 接口中添加 `splitImage` 方法

#### 1.2 实现 DreamAdapter 的 splitImage 方法
- 在 `Backend/src/adapters/dream.adapter.ts` 中实现 `splitImage` 方法
- 使用 seedream API 的图生图模式实现图片拆分
- 处理图片下载和转换为 base64
- 发送 API 请求并处理响应
- 保存拆分后的图片并返回本地路径

#### 1.3 更新图片服务
- 在 `Backend/src/services/image.service.ts` 中添加 `splitImage` 方法
- 集成到现有的图片处理流程中

#### 1.4 添加路由和控制器
- 在 `Backend/src/controllers/image.controller.ts` 中添加 `splitImage` 方法
- 在 `Backend/src/routes/image.routes.ts` 中添加对应的路由

### 2. 前端实现

#### 2.1 创建图片拆分节点组件
- 在 `Frontend/src/components/nodes/` 目录下创建 `SplitNode.vue` 组件
- 实现节点的 UI 界面，包括参数设置和执行按钮
- 实现节点的逻辑，包括连接管理、参数验证和 API 调用
- 实现拆分结果的展示和下游节点的创建

#### 2.2 注册节点类型
- 在 `Frontend/src/views/Workflow.vue` 中导入并注册 `SplitNode` 组件
- 更新 `nodeTypes` 对象，添加 `split` 类型

#### 2.3 更新节点尺寸配置
- 在 `Frontend/src/views/Workflow.vue` 中更新 `NODE_DIMENSIONS` 对象，添加 `split` 节点的尺寸

#### 2.4 添加到右键菜单
- 在 `Frontend/src/components/ContextMenu.vue` 中添加图片拆分节点的选项

#### 2.5 添加到左侧工具栏
- 在 `Frontend/src/views/Workflow.vue` 中的左侧工具栏添加图片拆分节点的按钮

### 3. 集成测试

#### 3.1 测试后端 API
- 确保图片拆分 API 能够正确处理请求并返回结果

#### 3.2 测试前端功能
- 确保图片拆分节点能够正确添加到工作流中
- 确保参数设置能够正确传递到后端
- 确保拆分结果能够正确展示和传递给下游节点

#### 3.3 测试工作流集成
- 确保图片拆分节点能够与其他节点正确连接和协作

## 技术实现细节

### 后端实现

#### 图片拆分参数
- `imageUrl`: 要拆分的图片 URL
- `splitCount`: 拆分的数量，默认为 2
- `splitDirection`: 拆分方向，可选值为 `horizontal` (水平) 或 `vertical` (垂直)
- `prompt`: 拆分的提示词，用于指导拆分过程

#### 实现方式
- 使用 seedream API 的图生图模式
- 通过提示词指导模型进行图片拆分
- 处理 API 响应并保存拆分后的图片

### 前端实现

#### 节点 UI
- 类似其他图片处理节点的 UI 风格
- 包含图片输入连接、参数设置区域和执行按钮
- 包含拆分结果的预览区域

#### 节点逻辑
- 监听上游节点的连接，获取输入图片
- 验证参数，确保必要的参数已设置
- 调用后端 API 执行图片拆分
- 处理 API 响应，展示拆分结果
- 创建下游图片节点，传递拆分后的图片

### 用户体验

- 添加操作成功的提示信息
- 确保节点在执行过程中显示加载状态
- 保持与现有节点的 UI 风格一致性

## 文件修改

### 后端文件

1. **Backend/src/adapters/ai-provider.interface.ts** - 添加图片拆分的参数定义
2. **Backend/src/adapters/dream.adapter.ts** - 实现图片拆分的方法
3. **Backend/src/services/image.service.ts** - 添加图片拆分的服务方法
4. **Backend/src/controllers/image.controller.ts** - 添加图片拆分的控制器方法
5. **Backend/src/routes/image.routes.ts** - 添加图片拆分的路由

### 前端文件

1. **Frontend/src/components/nodes/SplitNode.vue** - 创建图片拆分节点组件
2. **Frontend/src/views/Workflow.vue** - 注册节点类型和更新配置
3. **Frontend/src/components/ContextMenu.vue** - 添加图片拆分节点的选项

## 预期效果

- 用户可以在工作流编辑器中添加图片拆分节点
- 用户可以设置图片拆分的参数，如拆分数量和方向
- 用户可以执行图片拆分操作，查看拆分结果
- 拆分后的图片可以传递给下游节点进行进一步处理
- 整个操作流程与现有图片处理节点保持一致的用户体验