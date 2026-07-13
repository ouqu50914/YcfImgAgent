<template>
  <div class="chat-message-content" v-html="sanitizedHtml" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const props = defineProps<{
  content: string;
}>();

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

const sanitizedHtml = computed(() => {
  const raw = props.content ?? '';
  if (!raw) return '';
  const html = md.render(raw);
  const safe = DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel'],
  });
  return safe.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => `<div class="table-wrap">${table}</div>`);
});
</script>

<style scoped>
.chat-message-content {
  max-width: 100%;
  min-width: 0;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.chat-message-content :deep(p) {
  margin: 0 0 0.5em;
}

.chat-message-content :deep(p:last-child) {
  margin-bottom: 0;
}

.chat-message-content :deep(pre) {
  margin: 0.5em 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
  overflow-x: auto;
  max-width: 100%;
  font-size: 12px;
  line-height: 1.45;
}

.chat-message-content :deep(.table-wrap) {
  margin: 0.5em 0;
  max-width: 100%;
  overflow-x: auto;
  border-radius: 6px;
  border: 1px solid var(--app-border-color, #374151);
}

.chat-message-content :deep(table) {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  line-height: 1.45;
}

.chat-message-content :deep(th),
.chat-message-content :deep(td) {
  padding: 6px 10px;
  border: 1px solid var(--app-border-color, #374151);
  text-align: left;
  white-space: nowrap;
}

.chat-message-content :deep(th) {
  background: rgba(0, 0, 0, 0.2);
  font-weight: 600;
}

.chat-message-content :deep(h1),
.chat-message-content :deep(h2),
.chat-message-content :deep(h3),
.chat-message-content :deep(h4) {
  margin: 0.6em 0 0.35em;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.chat-message-content :deep(h1) { font-size: 1.25em; }
.chat-message-content :deep(h2) { font-size: 1.12em; }
.chat-message-content :deep(h3) { font-size: 1.02em; }

.chat-message-content :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.92em;
}

.chat-message-content :deep(:not(pre) > code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.2);
}

.chat-message-content :deep(ul),
.chat-message-content :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.4em;
}

.chat-message-content :deep(blockquote) {
  margin: 0.4em 0;
  padding-left: 10px;
  border-left: 3px solid var(--app-border-strong, #555);
  opacity: 0.9;
}

.chat-message-content :deep(a) {
  color: var(--color-primary, #409eff);
  text-decoration: underline;
}
</style>
