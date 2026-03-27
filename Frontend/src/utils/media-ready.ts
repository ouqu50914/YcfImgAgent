export type ImageNodeLikeData = {
  imageUrl?: unknown;
  isLoading?: unknown;
  status?: unknown;
};

export function isImageNodeReady(data: ImageNodeLikeData | null | undefined): boolean {
  const url = typeof data?.imageUrl === 'string' ? data.imageUrl.trim() : '';
  if (!url) return false;
  if (data?.isLoading === true) return false;
  if (data?.status === 'error') return false;
  return true;
}

export type ConnectedImageReadiness = {
  total: number;
  ready: number;
  loading: number;
  error: number;
  missingUrl: number;
};

export function summarizeConnectedImages(
  sources: Array<{ imageUrl?: unknown; isLoading?: unknown; status?: unknown }>
): ConnectedImageReadiness {
  const summary: ConnectedImageReadiness = {
    total: sources.length,
    ready: 0,
    loading: 0,
    error: 0,
    missingUrl: 0,
  };

  for (const s of sources) {
    const url = typeof s?.imageUrl === 'string' ? s.imageUrl.trim() : '';
    if (!url) {
      summary.missingUrl += 1;
      continue;
    }
    if (s?.isLoading === true) {
      summary.loading += 1;
      continue;
    }
    if (s?.status === 'error') {
      summary.error += 1;
      continue;
    }
    summary.ready += 1;
  }

  return summary;
}

