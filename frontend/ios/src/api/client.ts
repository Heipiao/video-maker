export const API_BASE_URL = 'http://127.0.0.1:8001';

export type AssetType = 'photo' | 'video' | 'music';

export type Asset = {
  id: string;
  type: AssetType;
  url: string;
  tag: string;
  description?: string | null;
  caption?: string | null;
  metadata?: Record<string, unknown>;
  analysis_status?: string;
  analysis?: Record<string, unknown>;
};

export type Template = {
  id: string;
  name: string;
  description: string;
  default_duration_seconds: number;
  default_aspect_ratio: '16:9' | '9:16' | '1:1';
  tags: string[];
};

export type AdvisorOption = {
  id: string;
  title: string;
  description: string;
  template_id: string;
  aspect_ratio: '16:9' | '9:16' | '1:1';
  primary_color: string;
  photo_motion: 'slow_zoom' | 'pan_left' | 'pan_right' | 'still';
  transition: 'fade' | 'crossfade' | 'cut';
  music_volume: number;
  prompt: string;
  highlights: string[];
};

export type VideoSpec = {
  id: string;
  template_id: string;
  title: string;
  aspect_ratio: '16:9' | '9:16' | '1:1';
  duration_seconds: number;
  assets: Asset[];
  music_asset_id?: string | null;
  style: {
    font: string;
    primary_color: string;
    transition: 'fade' | 'crossfade' | 'cut';
    photo_motion: 'slow_zoom' | 'pan_left' | 'pan_right' | 'still';
    caption_position: 'bottom' | 'center' | 'top';
    music_volume: number;
  };
  timeline: Array<{
    type: 'title' | 'photo' | 'video' | 'ending';
    duration_seconds: number;
    asset_id?: string | null;
    text?: string | null;
    caption?: string | null;
    motion?: 'slow_zoom' | 'pan_left' | 'pan_right' | 'still' | null;
    transition?: 'fade' | 'crossfade' | 'cut' | null;
    parameters?: Record<string, unknown>;
  }>;
};

export type RenderJob = {
  id: string;
  spec_id: string;
  renderer: string;
  status: 'queued' | 'rendering' | 'ready' | 'failed';
  manifest_url?: string | null;
  output_url?: string | null;
  error?: string | null;
};

export type DemoAsset = {
  id: string;
  type: AssetType;
  url: string;
  tag: string;
  tags?: string[];
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  analysis_status?: string;
  analysis?: Record<string, unknown>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const detail = typeof payload === 'object' ? payload.detail || JSON.stringify(payload) : payload;
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return payload as T;
}

function absoluteUrl(url: string) {
  if (url.startsWith('/')) {
    return `${API_BASE_URL}${url}`;
  }
  return url;
}

export async function fetchCatalog() {
  const templates = await request<{templates: Template[]}>('/api/v1/templates');
  return {templates: templates.templates};
}

export async function fetchDemoAssets() {
  const response = await request<{assets: DemoAsset[]}>('/api/v1/demo-assets');
  return response.assets;
}

export async function uploadFile(asset: {uri: string; type?: string; fileName?: string}) {
  const body = new FormData();
  body.append('file', {
    uri: asset.uri,
    type: asset.type || 'image/jpeg',
    name: asset.fileName || 'asset.jpg',
  } as never);

  const response = await fetch(`${API_BASE_URL}/api/v1/uploads`, {
    method: 'POST',
    body,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<{
    url: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    suggested_asset_type: AssetType;
  }>;
}

export async function registerAsset(payload: {
  type: AssetType;
  url: string;
  tag: string;
  description?: string;
  caption?: string;
  metadata?: Record<string, unknown>;
  analysis_status?: string;
  analysis?: Record<string, unknown>;
}) {
  return request<{asset: Asset}>('/api/v1/assets', {
    method: 'POST',
    body: JSON.stringify({...payload, url: absoluteUrl(payload.url)}),
  });
}

export async function createAdvisorOptions(payload: {
  couple_names: string;
  wedding_date?: string;
  location?: string;
  asset_ids: string[];
}) {
  return request<{options: AdvisorOption[]}>('/api/v1/advisor/options', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function generateVideoSpec(payload: {
  template_id: string;
  title: string;
  asset_ids: string[];
  aspect_ratio: '16:9' | '9:16' | '1:1';
}) {
  return request<{spec: VideoSpec}>('/api/v1/video-specs/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function saveVideoSpec(spec: VideoSpec) {
  return request<{spec: VideoSpec}>(`/api/v1/video-specs/${spec.id}`, {
    method: 'PUT',
    body: JSON.stringify({spec}),
  });
}

export async function createRenderJob(specId: string) {
  return request<{job: RenderJob}>('/api/v1/render-jobs', {
    method: 'POST',
    body: JSON.stringify({spec_id: specId}),
  });
}

export async function renderWithRemotion(jobId: string) {
  return request<{job: RenderJob}>(`/api/v1/render-jobs/${jobId}/remotion`, {
    method: 'POST',
  });
}

export function normalizeLocalExportUrl(url?: string | null) {
  if (!url) {
    return undefined;
  }
  return absoluteUrl(url);
}
