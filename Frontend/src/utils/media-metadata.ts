export type MediaKind = 'video' | 'audio';

export type MediaMetadata = {
  durationSeconds: number;
};

function loadDurationFromFile(kind: MediaKind, file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const el: HTMLMediaElement =
      kind === 'video' ? document.createElement('video') : document.createElement('audio');

    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      try {
        el.removeAttribute('src');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (el as any).srcObject = null;
        el.load?.();
      } catch {}
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {}
    };

    const onLoaded = () => {
      if (settled) return;
      settled = true;
      const d = Number(el.duration);
      cleanup();
      if (!Number.isFinite(d) || d <= 0) {
        reject(new Error('无法读取媒体时长'));
        return;
      }
      resolve(d);
    };

    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('媒体 metadata 解析失败'));
    };

    el.preload = 'metadata';
    el.addEventListener('loadedmetadata', onLoaded, { once: true });
    el.addEventListener('error', onError, { once: true });
    el.src = objectUrl;
  });
}

export async function getMediaMetadataFromFile(kind: MediaKind, file: File): Promise<MediaMetadata> {
  const durationSeconds = await loadDurationFromFile(kind, file);
  return { durationSeconds };
}

