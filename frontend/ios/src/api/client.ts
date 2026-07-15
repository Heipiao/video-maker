const runtimeConfig = globalThis as typeof globalThis & {VOWFRAME_API_BASE_URL?: string};

const DEFAULT_API_BASE_URL = 'https://video-maker.aigcteacher.top';

export const API_BASE_URL = runtimeConfig.VOWFRAME_API_BASE_URL || DEFAULT_API_BASE_URL;

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
    style_preset_id?: string;
    filter_preset?: string;
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
  project_id?: string | null;
  variant?: 'preview' | 'final';
  watermark?: boolean;
  resolution?: string | null;
  entitlement_required?: boolean;
  renderer: string;
  status: 'queued' | 'provisioning' | 'rendering' | 'uploading' | 'ready' | 'failed' | 'preempted' | 'retrying' | 'expired';
  manifest_url?: string | null;
  manifest_oss_url?: string | null;
  manifest_oss_key?: string | null;
  output_url?: string | null;
  output_oss_key?: string | null;
  eci_container_group_id?: string | null;
  attempt_count?: number;
  max_attempts?: number;
  error?: string | null;
  heartbeat_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

export type RenderJobPlayback = {
  url: string;
  expires_at: string;
};

export type VideoProject = {
  id: string;
  spec_id?: string | null;
  invite_code: string;
  couple_names: string;
  wedding_date?: string | null;
  location?: string | null;
  package_type: WeddingPackageType;
  status: 'active' | 'archived';
  owner_id?: string | null;
  preview_job_id?: string | null;
  final_job_id?: string | null;
  entitlement_status: 'none' | 'active' | 'refunded' | 'revoked';
  product_id?: string | null;
  transaction_id?: string | null;
  original_transaction_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type WeddingPackageType = 'guest_cam_recap' | 'wedding_story_reel' | 'reception_screen_cut';

export type WeddingAssetSource = 'owner_upload' | 'guest_upload';

export type ProjectAssetItem = {
  asset: Asset;
  source: WeddingAssetSource;
  guest_name?: string | null;
  note?: string | null;
  created_at: string;
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
  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
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
    throw new Error(`${detail || 'Request failed'} (${response.status} ${url})`);
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

export async function uploadFile(asset: {uri: string; type?: string; fileName?: string; projectId?: string}) {
  const body = new FormData();
  body.append('file', {
    uri: asset.uri,
    type: asset.type || 'image/jpeg',
    name: asset.fileName || 'asset.jpg',
  } as never);
  if (asset.projectId) {
    body.append('project_id', asset.projectId);
  }

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
    oss_key?: string | null;
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

export async function updateAsset(
  assetId: string,
  payload: {
    tag?: string;
    description?: string | null;
    caption?: string | null;
    metadata?: Record<string, unknown>;
    analysis_status?: string;
    analysis?: Record<string, unknown>;
  },
) {
  return request<{asset: Asset}>(`/api/v1/assets/${assetId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
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
  style_preset_id?: string;
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

export async function createVideoProject(payload: {
  spec_id?: string;
  owner_id?: string;
  couple_names?: string;
  wedding_date?: string;
  location?: string;
  package_type?: WeddingPackageType;
} = {}) {
  return request<{project: VideoProject}>('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateVideoProject(projectId: string, payload: {
  spec_id?: string;
  couple_names?: string;
  wedding_date?: string;
  location?: string;
  package_type?: WeddingPackageType;
}) {
  return request<{project: VideoProject}>(`/api/v1/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function getProjectByInviteCode(inviteCode: string) {
  return request<{project: VideoProject}>(`/api/v1/projects/by-code/${encodeURIComponent(inviteCode)}`);
}

export async function linkProjectAsset(
  projectId: string,
  payload: {
    asset_id: string;
    source: WeddingAssetSource;
    guest_name?: string;
    note?: string;
  },
) {
  return request<{item: ProjectAssetItem}>(`/api/v1/projects/${projectId}/assets`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listProjectAssets(projectId: string) {
  return request<{items: ProjectAssetItem[]}>(`/api/v1/projects/${projectId}/assets`);
}

export async function unlinkProjectAsset(projectId: string, assetId: string) {
  await request<void>(`/api/v1/projects/${projectId}/assets/${assetId}`, {
    method: 'DELETE',
  });
}

export async function getVideoProject(projectId: string) {
  return request<{project: VideoProject}>(`/api/v1/projects/${projectId}`);
}

export async function createProjectPreviewRender(projectId: string) {
  return request<{project: VideoProject; job: RenderJob}>(`/api/v1/projects/${projectId}/preview-render`, {
    method: 'POST',
  });
}

export async function modifyVideoProject(projectId: string, prompt: string) {
  return request<{project: VideoProject; spec: VideoSpec; job: RenderJob}>(`/api/v1/projects/${projectId}/modify`, {
    method: 'POST',
    body: JSON.stringify({prompt}),
  });
}

export async function createProjectFinalRender(projectId: string) {
  return request<{project: VideoProject; job: RenderJob}>(`/api/v1/projects/${projectId}/final-render`, {
    method: 'POST',
  });
}

export async function getProjectPreviewPlayback(projectId: string) {
  return request<RenderJobPlayback>(`/api/v1/projects/${projectId}/preview-playback-url`);
}

export async function getProjectFinalPlayback(projectId: string) {
  return request<RenderJobPlayback>(`/api/v1/projects/${projectId}/final-playback-url`);
}

export async function verifyApplePurchase(payload: {
  project_id: string;
  product_id: string;
  transaction_id: string;
  original_transaction_id: string;
}) {
  return request<{project: VideoProject}>('/api/v1/iap/apple/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function restoreApplePurchase(payload: {
  project_id: string;
  original_transaction_id: string;
}) {
  return request<{project: VideoProject}>('/api/v1/iap/apple/restore', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function dispatchEciRender(jobId: string) {
  return request<{job: RenderJob}>(`/api/v1/render-jobs/${jobId}/eci`, {
    method: 'POST',
  });
}

export async function startConfiguredRender(jobId: string) {
  try {
    return await request<{job: RenderJob}>(`/api/v1/render-jobs/${jobId}/start`, {
      method: 'POST',
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Not Found')) {
      return dispatchEciRender(jobId);
    }
    throw error;
  }
}

export async function getRenderJob(jobId: string) {
  return request<{job: RenderJob}>(`/api/v1/render-jobs/${jobId}`);
}

export async function getRenderJobPlayback(jobId: string) {
  return request<RenderJobPlayback>(`/api/v1/render-jobs/${jobId}/playback-url`);
}

export function normalizeLocalExportUrl(url?: string | null) {
  if (!url) {
    return undefined;
  }
  return absoluteUrl(url);
}
