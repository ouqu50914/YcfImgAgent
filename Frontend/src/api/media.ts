import request from '@/utils/request';

export type MediaProbeKind = 'video' | 'audio';

export type MediaProbeResult = {
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string | null;
  container?: string | null;
};

export function probeMediaUrl(params: { url: string; kind: MediaProbeKind }) {
  return request.post<{
    message: string;
    data: MediaProbeResult;
  }>('/media/probe', params);
}

