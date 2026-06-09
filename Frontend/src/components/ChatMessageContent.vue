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
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel'],
  });
});
</script>

<style scoped>
.chat-message-content {
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
  font-size: 12px;
  line-height: 1.45;
}

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
