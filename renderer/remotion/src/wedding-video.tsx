import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

type Asset = {
  id: string;
  type: 'photo' | 'video' | 'music';
  url: string;
  tag: string;
  description?: string | null;
  caption?: string | null;
};

type Scene = {
  type: 'title' | 'photo' | 'video' | 'ending';
  duration_seconds: number;
  asset_id?: string | null;
  text?: string | null;
  caption?: string | null;
  motion?: string | null;
};

type VideoSpec = {
  title: string;
  duration_seconds: number;
  aspect_ratio: '16:9' | '9:16' | '1:1';
  assets: Asset[];
  music_asset_id?: string | null;
  style?: {
    primary_color?: string;
    music_volume?: number;
  };
  timeline: Scene[];
};

export type ManifestProps = {
  job_id?: string;
  spec?: VideoSpec;
};

const fallbackSpec: VideoSpec = {
  title: 'Wedding Video',
  duration_seconds: 12,
  aspect_ratio: '16:9',
  assets: [],
  timeline: [
    {type: 'title', duration_seconds: 4, text: 'Wedding Video'},
    {type: 'ending', duration_seconds: 8, text: 'Generated with Video Maker'},
  ],
};

export const WeddingVideo: React.FC<ManifestProps> = ({spec = fallbackSpec}) => {
  const music = spec.assets.find((asset) => asset.id === spec.music_asset_id && asset.type === 'music');
  const volume = spec.style?.music_volume ?? 0.7;

  return (
    <AbsoluteFill style={{backgroundColor: '#101114', color: '#fff', fontFamily: 'Georgia, serif'}}>
      <BackgroundGradient color={spec.style?.primary_color || '#C9A86A'} />
      {spec.timeline.map((scene, index) => {
        const start = spec.timeline
          .slice(0, index)
          .reduce((total, item) => total + item.duration_seconds * 30, 0);
        const duration = Math.max(1, Math.round(scene.duration_seconds * 30));
        const asset = scene.asset_id ? spec.assets.find((item) => item.id === scene.asset_id) : undefined;
        return (
          <Sequence key={`${scene.type}-${index}`} from={start} durationInFrames={duration}>
            <SceneView scene={scene} asset={asset} title={spec.title} />
          </Sequence>
        );
      })}
      {music ? <Audio src={normalizeUrl(music.url)} volume={volume} /> : null}
    </AbsoluteFill>
  );
};

const BackgroundGradient: React.FC<{color: string}> = ({color}) => (
  <AbsoluteFill
    style={{
      background: `linear-gradient(135deg, #111318 0%, ${color} 140%)`,
      opacity: 0.9,
    }}
  />
);

const SceneView: React.FC<{scene: Scene; asset?: Asset; title: string}> = ({scene, asset, title}) => {
  const frame = useCurrentFrame();
  const {durationInFrames, width, height} = useVideoConfig();
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = scene.motion === 'still' ? 1 : interpolate(progress, [0, 1], [1.02, 1.1]);
  const opacity = interpolate(frame, [0, 12, Math.max(13, durationInFrames - 12), durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const displayText = scene.text || scene.caption || asset?.caption || asset?.description || asset?.tag || title;

  if ((scene.type === 'photo' || scene.type === 'video') && asset?.url) {
    return (
      <AbsoluteFill style={{opacity}}>
        <Img
          src={normalizeUrl(asset.url)}
          style={{
            width,
            height,
            objectFit: 'cover',
            transform: `scale(${scale})`,
            filter: 'saturate(1.04) contrast(1.02)',
          }}
        />
        <Vignette />
        <Caption text={displayText} />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', padding: width * 0.08, opacity}}>
      <div
        style={{
          maxWidth: width * 0.78,
          textAlign: 'center',
          fontSize: Math.max(54, width * 0.065),
          lineHeight: 1.05,
          fontWeight: 700,
          textShadow: '0 8px 32px rgba(0,0,0,0.38)',
        }}
      >
        {displayText}
      </div>
    </AbsoluteFill>
  );
};

const Caption: React.FC<{text: string}> = ({text}) => {
  const {width} = useVideoConfig();
  return (
    <div
      style={{
        position: 'absolute',
        left: width * 0.07,
        right: width * 0.07,
        bottom: width * 0.06,
        padding: '22px 28px',
        borderRadius: 8,
        background: 'rgba(16,17,20,0.62)',
        color: '#fff',
        fontSize: Math.max(28, width * 0.032),
        lineHeight: 1.18,
        fontWeight: 650,
        textShadow: '0 2px 12px rgba(0,0,0,0.5)',
      }}
    >
      {text}
    </div>
  );
};

const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        'radial-gradient(circle at center, rgba(0,0,0,0) 35%, rgba(0,0,0,0.42) 100%), linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.38))',
    }}
  />
);

const normalizeUrl = (url: string) => {
  const rewriteFrom = process.env.REMOTION_ASSET_REWRITE_FROM?.replace(/\/$/, '');
  const rewriteTo = process.env.REMOTION_ASSET_REWRITE_TO?.replace(/\/$/, '');
  if (rewriteFrom && rewriteTo && url.startsWith(`${rewriteFrom}/`)) {
    return `${rewriteTo}${url.slice(rewriteFrom.length)}`;
  }
  if (url.startsWith('/')) {
    return `${process.env.REMOTION_PUBLIC_BASE_URL || 'http://127.0.0.1:8017'}${url}`;
  }
  return url;
};
