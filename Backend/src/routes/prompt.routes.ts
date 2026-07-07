import { Router } from "express";
import {
    optimizePrompt,
    geminiChat,
    geminiChatStream,
    translateErrorMessage
} from "../controllers/prompt.controller";
import {
    createTemplate,
    getUserTemplates,
    getTemplate,
    updateTemplate,
    deleteTemplate,
    searchTemplates
} from "../controllers/prompt-template.controller";
import {
    createSkill,
    getUserSkills,
    getSkill,
    updateSkill,
    deleteSkill,
    searchSkills,
    importSkills,
    applySkillsToPrompt,
    listSkillMarketplace,
    listSkillMarketplaceItems,
    previewRemoteSkills,
    importRemoteSkills,
    checkSkillsUsability,
} from "../controllers/generation-skill.controller";
import { authenticateToken } from "../middlewares/auth.middleware";
import {
    uploadChatTemp,
    uploadChatTempMedia,
    deleteChatTempMedia,
} from "../controllers/upload.controller";
import {
    listChatSessions,
    upsertChatSession,
    bulkUpsertChatSessions,
    deleteChatSession,
} from "../controllers/chat-session.controller";
import { generateStoryboard } from "../controllers/storyboard.controller";
import { installBuiltinSkill, listBuiltinSkills } from "../controllers/builtin-skill.controller";

const router = Router();

// 提示词优化接口（需要登录）
router.post("/optimize", authenticateToken, optimizePrompt);

// 聊天临时媒体（COS 或本地，随会话生命周期清理）
router.post("/chat-media", authenticateToken, uploadChatTemp, uploadChatTempMedia);
router.post("/chat-media/delete", authenticateToken, deleteChatTempMedia);

// 聊天会话（持久化到数据库）
router.get("/chat-sessions", authenticateToken, listChatSessions);
router.put("/chat-sessions", authenticateToken, upsertChatSession);
router.post("/chat-sessions/bulk", authenticateToken, bulkUpsertChatSessions);
router.delete("/chat-sessions/:sessionId", authenticateToken, deleteChatSession);

// Gemini 聊天接口（需要登录）
router.post("/gemini-chat", authenticateToken, geminiChat);

// Gemini 聊天接口（流式，SSE，需要登录）
router.post("/gemini-chat/stream", authenticateToken, geminiChatStream);

// Gemini 错误文案翻译接口（需要登录）
router.post("/translate-error", authenticateToken, translateErrorMessage);

// 提示词模板接口（需要登录）
router.post("/templates", authenticateToken, createTemplate);
router.get("/templates", authenticateToken, getUserTemplates);
router.get("/templates/search", authenticateToken, searchTemplates);
router.get("/templates/:id", authenticateToken, getTemplate);
router.put("/templates/:id", authenticateToken, updateTemplate);
router.delete("/templates/:id", authenticateToken, deleteTemplate);

// 生成 Skill 接口（需要登录）
router.post("/skills", authenticateToken, createSkill);
router.post("/skills/import", authenticateToken, importSkills);
router.post("/skills/check-usability", authenticateToken, checkSkillsUsability);
router.post("/skills/import-remote", authenticateToken, importRemoteSkills);
router.post("/skills/preview-remote", authenticateToken, previewRemoteSkills);
router.get("/skills/marketplace", authenticateToken, listSkillMarketplace);
router.get("/skills/marketplace/:sourceId/items", authenticateToken, listSkillMarketplaceItems);
router.post("/skills/apply", authenticateToken, applySkillsToPrompt);
router.get("/skills", authenticateToken, getUserSkills);
router.get("/skills/search", authenticateToken, searchSkills);
// 内置 Skill 路由必须在 /skills/:id 之前，否则 "builtin" 会被当成 id
router.get("/skills/builtin", authenticateToken, listBuiltinSkills);
router.post("/skills/builtin/:slug/install", authenticateToken, installBuiltinSkill);
router.get("/skills/:id", authenticateToken, getSkill);
router.put("/skills/:id", authenticateToken, updateSkill);
router.delete("/skills/:id", authenticateToken, deleteSkill);

// 剧本分镜
router.post("/storyboard/generate", authenticateToken, generateStoryboard);

export default router;
