import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  Video,
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
  metadata?: Record<string, unknown>;
};

type SceneParameters = {
  style_preset_id?: string;
  layout?: string;
  slot?: string;
  filter_preset?: string;
  transition_out?: string;
  media_start?: number | null;
  crop_mode?: string;
  related_asset_ids?: string[];
};

type Scene = {
  type: 'title' | 'photo' | 'video' | 'ending';
  duration_seconds: number;
  asset_id?: string | null;
  text?: string | null;
  caption?: string | null;
  motion?: string | null;
  parameters?: SceneParameters | null;
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
    style_preset_id?: string;
    filter_preset?: string;
  };
  timeline: Scene[];
};

export type ManifestProps = {
  job_id?: string;
  spec?: VideoSpec;
  render?: {
    variant?: 'preview' | 'final';
    watermark?: {
      enabled?: boolean;
      text?: string;
      subtext?: string;
      opacity?: number;
    };
    resolution?: {width: number; height: number} | null;
    entitlement_required?: boolean;
  };
};

const fallbackSpec: VideoSpec = {
  title: 'Wedding Video',
  duration_seconds: 12,
  aspect_ratio: '16:9',
  assets: [],
  timeline: [
    {type: 'title', duration_seconds: 4, text: 'Wedding Video'},
    {type: 'ending', duration_seconds: 8, text: 'Generated with VowFrame'},
  ],
};

const PRESET_BACKGROUNDS: Record<string, string> = {
  nostalgia_editorial: '#15100F',
  reels_party_cut: '#09090A',
  clean_film_trailer: '#0B0B0C',
  guest_pov_recap: '#111111',
};

export const WeddingVideo: React.FC<ManifestProps> = ({spec = fallbackSpec, render}) => {
  const music = spec.assets.find((asset) => asset.id === spec.music_asset_id && asset.type === 'music');
  const volume = spec.style?.music_volume ?? 0.7;
  const watermark = render?.watermark;
  const presetId = spec.style?.style_preset_id || 'nostalgia_editorial';

  return (
    <AbsoluteFill
      style={{
        backgroundColor: PRESET_BACKGROUNDS[presetId] || '#101114',
        color: '#fff',
        fontFamily: 'Inter, Arial, sans-serif',
      }}
    >
      <BackgroundTone presetId={presetId} color={spec.style?.primary_color || '#D83A52'} />
      {spec.timeline.map((scene, index) => {
        const start = spec.timeline
          .slice(0, index)
          .reduce((total, item) => total + item.duration_seconds * 30, 0);
        const duration = Math.max(1, Math.round(scene.duration_seconds * 30));
        const asset = scene.asset_id ? spec.assets.find((item) => item.id === scene.asset_id) : undefined;
        const relatedAssets = (scene.parameters?.related_asset_ids || [])
          .map((id) => spec.assets.find((item) => item.id === id))
          .filter((item): item is Asset => Boolean(item));
        return (
          <Sequence key={`${scene.type}-${scene.asset_id || index}-${start}`} from={start} durationInFrames={duration}>
            <SceneView scene={scene} asset={asset} relatedAssets={relatedAssets} title={spec.title} presetId={presetId} />
          </Sequence>
        );
      })}
      {music ? <Audio src={normalizeUrl(music.url)} volume={volume} /> : null}
      {watermark?.enabled ? (
        <Watermark
          text={watermark.text || 'VowFrame'}
          subtext={watermark.subtext || 'PREVIEW'}
          opacity={watermark.opacity ?? 0.64}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const BackgroundTone: React.FC<{presetId: string; color: string}> = ({presetId, color}) => (
  <AbsoluteFill
    style={{
      background:
        presetId === 'clean_film_trailer'
          ? 'linear-gradient(180deg, #050505 0%, #181818 58%, #080808 100%)'
          : presetId === 'guest_pov_recap'
            ? `linear-gradient(135deg, #080808 0%, ${color} 180%)`
            : `radial-gradient(circle at 50% 15%, ${color}33 0%, rgba(0,0,0,0) 38%), linear-gradient(180deg, #111 0%, #09090A 100%)`,
      opacity: 0.92,
    }}
  />
);

const SceneView: React.FC<{
  scene: Scene;
  asset?: Asset;
  relatedAssets: Asset[];
  title: string;
  presetId: string;
}> = ({scene, asset, relatedAssets, title, presetId}) => {
  const frame = useCurrentFrame();
  const {durationInFrames, width} = useVideoConfig();
  const opacity = interpolate(frame, [0, 10, Math.max(11, durationInFrames - 10), durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const displayText = scene.text || scene.caption || asset?.caption || asset?.description || asset?.tag || title;

  if (scene.type === 'title' || scene.type === 'ending' || !asset) {
    return <TitleCard text={displayText} presetId={presetId} ending={scene.type === 'ending'} opacity={opacity} />;
  }

  const layout = scene.parameters?.layout || 'full_photo_title';
  const media = [asset, ...relatedAssets].slice(0, layout === 'rhythm_montage' ? 3 : 2);

  if (layout === 'stacked_memory_cards') {
    return <StackedCards scene={scene} assets={media} text={displayText} opacity={opacity} presetId={presetId} />;
  }
  if (layout === 'split_photo_caption') {
    return <SplitCaption scene={scene} assets={media} text={displayText} opacity={opacity} presetId={presetId} />;
  }
  if (layout === 'detail_to_hero') {
    return <DetailToHero scene={scene} assets={media} text={displayText} opacity={opacity} presetId={presetId} />;
  }
  if (layout === 'rhythm_montage') {
    return <RhythmMontage scene={scene} assets={media} text={displayText} opacity={opacity} presetId={presetId} />;
  }
  if (layout === 'finale_photo_card') {
    return <FinaleCard scene={scene} asset={asset} text={displayText} opacity={opacity} presetId={presetId} />;
  }
  return <FullMedia scene={scene} asset={asset} text={displayText} opacity={opacity} presetId={presetId} />;
};

const FullMedia: React.FC<{scene: Scene; asset: Asset; text: string; opacity: number; presetId: string}> = ({
  scene,
  asset,
  text,
  opacity,
  presetId,
}) => (
  <AbsoluteFill style={{opacity}}>
    <MediaFill asset={asset} scene={scene} presetId={presetId} />
    <Vignette presetId={presetId} />
    <Caption text={text} presetId={presetId} />
  </AbsoluteFill>
);

const StackedCards: React.FC<{scene: Scene; assets: Asset[]; text: string; opacity: number; presetId: string}> = ({
  scene,
  assets,
  text,
  opacity,
  presetId,
}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const drift = interpolate(frame, [0, 120], [0, -18], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{opacity, padding: width * 0.065, justifyContent: 'center'}}>
      {assets.map((asset, index) => (
        <div
          key={asset.id}
          style={{
            position: 'absolute',
            left: width * (index === 0 ? 0.08 : 0.2),
            top: height * (index === 0 ? 0.14 : 0.31) + drift,
            width: width * 0.7,
            height: height * 0.44,
            borderRadius: 18,
            overflow: 'hidden',
            transform: `rotate(${index === 0 ? -4 : 3}deg)`,
            boxShadow: '0 28px 60px rgba(0,0,0,0.34)',
            border: '8px solid rgba(255,255,255,0.92)',
          }}
        >
          <MediaFill asset={asset} scene={scene} presetId={presetId} />
        </div>
      ))}
      <Caption text={text} presetId={presetId} compact />
      <Grain />
    </AbsoluteFill>
  );
};

const SplitCaption: React.FC<{scene: Scene; assets: Asset[]; text: string; opacity: number; presetId: string}> = ({
  scene,
  assets,
  text,
  opacity,
  presetId,
}) => {
  const {width, height} = useVideoConfig();
  const first = assets[0];
  const second = assets[1] || assets[0];
  return (
    <AbsoluteFill style={{opacity, padding: width * 0.055, gap: width * 0.035}}>
      <div style={{display: 'flex', flexDirection: 'row', gap: width * 0.035, height: height * 0.66}}>
        {[first, second].map((asset, index) => (
          <div key={`${asset.id}-${index}`} style={{flex: 1, borderRadius: 20, overflow: 'hidden'}}>
            <MediaFill asset={asset} scene={scene} presetId={presetId} />
          </div>
        ))}
      </div>
      <div style={{fontSize: width * 0.055, lineHeight: 1.02, fontWeight: 900, maxWidth: width * 0.82}}>{text}</div>
      <Vignette presetId={presetId} light />
    </AbsoluteFill>
  );
};

const DetailToHero: React.FC<{scene: Scene; assets: Asset[]; text: string; opacity: number; presetId: string}> = ({
  scene,
  assets,
  text,
  opacity,
  presetId,
}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const heroScale = interpolate(frame, [0, 150], [1.04, 1.13], {extrapolateRight: 'clamp'});
  const detail = assets[1] || assets[0];
  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{position: 'absolute', inset: 0, transform: `scale(${heroScale})`}}>
        <MediaFill asset={assets[0]} scene={scene} presetId={presetId} />
      </div>
      <div
        style={{
          position: 'absolute',
          right: width * 0.065,
          top: height * 0.11,
          width: width * 0.32,
          height: height * 0.22,
          borderRadius: 16,
          overflow: 'hidden',
          border: '5px solid rgba(255,255,255,0.88)',
        }}
      >
        <MediaFill asset={detail} scene={scene} presetId={presetId} />
      </div>
      <Vignette presetId={presetId} />
      <Caption text={text} presetId={presetId} />
    </AbsoluteFill>
  );
};

const RhythmMontage: React.FC<{scene: Scene; assets: Asset[]; text: string; opacity: number; presetId: string}> = ({
  scene,
  assets,
  text,
  opacity,
  presetId,
}) => {
  const frame = useCurrentFrame();
  const activeIndex = Math.min(assets.length - 1, Math.floor(frame / 36) % Math.max(1, assets.length));
  return (
    <AbsoluteFill style={{opacity}}>
      {assets.map((asset, index) => (
        <AbsoluteFill key={asset.id} style={{opacity: index === activeIndex ? 1 : 0}}>
          <MediaFill asset={asset} scene={scene} presetId={presetId} punchy />
        </AbsoluteFill>
      ))}
      <Flash amount={frame % 36 < 4 ? 0.22 : 0} />
      <Caption text={text} presetId={presetId} compact />
    </AbsoluteFill>
  );
};

const FinaleCard: React.FC<{scene: Scene; asset: Asset; text: string; opacity: number; presetId: string}> = ({
  scene,
  asset,
  text,
  opacity,
  presetId,
}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{opacity, alignItems: 'center', justifyContent: 'center'}}>
      <div
        style={{
          width: width * 0.76,
          height: height * 0.64,
          borderRadius: 22,
          overflow: 'hidden',
          border: '8px solid rgba(255,255,255,0.9)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.42)',
        }}
      >
        <MediaFill asset={asset} scene={scene} presetId={presetId} />
      </div>
      <div style={{marginTop: height * 0.035, fontSize: width * 0.052, fontWeight: 900}}>{text}</div>
      <Grain />
    </AbsoluteFill>
  );
};

const MediaFill: React.FC<{asset: Asset; scene: Scene; presetId: string; punchy?: boolean}> = ({
  asset,
  scene,
  presetId,
  punchy,
}) => {
  const frame = useCurrentFrame();
  const {durationInFrames, width, height} = useVideoConfig();
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = scene.motion === 'still' ? 1 : interpolate(progress, [0, 1], [1.02, punchy ? 1.16 : 1.1]);
  const x = scene.motion === 'pan_left' ? interpolate(progress, [0, 1], [18, -18]) : 0;
  const filter = filterForPreset(scene.parameters?.filter_preset || presetId);
  const commonStyle: React.CSSProperties = {
    width,
    height,
    objectFit: scene.parameters?.crop_mode === 'card_pan' ? 'cover' : 'cover',
    transform: `translateX(${x}px) scale(${scale})`,
    filter,
  };

  if (asset.type === 'video') {
    const mediaStartSeconds = typeof scene.parameters?.media_start === 'number' ? scene.parameters.media_start : 0;
    return (
      <Video
        src={normalizeUrl(asset.url)}
        startFrom={Math.max(0, Math.round(mediaStartSeconds * 30))}
        volume={0}
        muted
        style={commonStyle}
      />
    );
  }
  return <Img src={normalizeUrl(asset.url)} style={commonStyle} />;
};

const TitleCard: React.FC<{text: string; presetId: string; ending: boolean; opacity: number}> = ({
  text,
  presetId,
  ending,
  opacity,
}) => {
  const frame = useCurrentFrame();
  const {width} = useVideoConfig();
  const y = interpolate(frame, [0, 45], [18, 0], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: width * 0.08,
        opacity,
        transform: `translateY(${y}px)`,
      }}
    >
      <div
        style={{
          maxWidth: width * 0.8,
          textAlign: 'center',
          fontSize: Math.max(58, width * (ending ? 0.055 : 0.07)),
          lineHeight: 1.02,
          fontWeight: 900,
          letterSpacing: 0,
          fontFamily: presetId === 'nostalgia_editorial' ? 'Georgia, serif' : 'Inter, Arial, sans-serif',
        }}
      >
        {text}
      </div>
      {presetId === 'nostalgia_editorial' ? <Grain /> : null}
    </AbsoluteFill>
  );
};

const Caption: React.FC<{text: string; presetId: string; compact?: boolean}> = ({text, presetId, compact}) => {
  const {width} = useVideoConfig();
  return (
    <div
      style={{
        position: 'absolute',
        left: width * 0.065,
        right: width * 0.065,
        bottom: width * 0.065,
        padding: compact ? '16px 22px' : '20px 26px',
        borderRadius: presetId === 'reels_party_cut' ? 999 : 14,
        background: presetId === 'clean_film_trailer' ? 'rgba(255,255,255,0.88)' : 'rgba(12,12,14,0.66)',
        color: presetId === 'clean_film_trailer' ? '#0B0B0C' : '#fff',
        fontSize: Math.max(26, width * (compact ? 0.03 : 0.034)),
        lineHeight: 1.12,
        fontWeight: 850,
        textShadow: presetId === 'clean_film_trailer' ? 'none' : '0 2px 12px rgba(0,0,0,0.42)',
      }}
    >
      {text}
    </div>
  );
};

const Vignette: React.FC<{presetId: string; light?: boolean}> = ({presetId, light}) => (
  <AbsoluteFill
    style={{
      background:
        presetId === 'clean_film_trailer'
          ? 'linear-gradient(180deg, rgba(0,0,0,0.28), rgba(0,0,0,0.34))'
          : `radial-gradient(circle at center, rgba(0,0,0,0) 36%, rgba(0,0,0,${light ? 0.2 : 0.48}) 100%), linear-gradient(180deg, rgba(0,0,0,0.06), rgba(0,0,0,0.4))`,
    }}
  />
);

const Grain: React.FC = () => (
  <AbsoluteFill
    style={{
      opacity: 0.09,
      backgroundImage:
        'repeating-linear-gradient(0deg, rgba(255,255,255,0.16) 0px, rgba(255,255,255,0.16) 1px, transparent 1px, transparent 4px)',
      mixBlendMode: 'overlay',
    }}
  />
);

const Flash: React.FC<{amount: number}> = ({amount}) => (
  <AbsoluteFill style={{background: '#fff', opacity: amount, pointerEvents: 'none'}} />
);

const Watermark: React.FC<{text: string; subtext: string; opacity: number}> = ({text, subtext, opacity}) => {
  const {width, height} = useVideoConfig();
  return (
    <>
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          opacity: Math.min(0.12, opacity * 0.18),
          transform: 'rotate(-18deg)',
          fontSize: Math.max(46, width * 0.075),
          fontWeight: 900,
          letterSpacing: 6,
          color: '#fff',
          textShadow: '0 8px 24px rgba(0,0,0,0.26)',
        }}
      >
        {text.toUpperCase()} {subtext}
      </AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          right: width * 0.045,
          bottom: height * 0.035,
          padding: `${Math.max(10, width * 0.012)}px ${Math.max(14, width * 0.018)}px`,
          borderRadius: 999,
          background: `rgba(15, 16, 18, ${Math.min(0.78, opacity)})`,
          border: '1px solid rgba(255,255,255,0.34)',
          color: '#fff',
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: Math.max(20, width * 0.024),
          fontWeight: 900,
          lineHeight: 1,
          textShadow: '0 2px 12px rgba(0,0,0,0.44)',
        }}
      >
        {text} <span style={{color: '#F5D7C3'}}>{subtext}</span>
      </div>
    </>
  );
};

const filterForPreset = (presetId: string) => {
  if (presetId === 'clean_bw' || presetId === 'clean_film_trailer') {
    return 'grayscale(1) contrast(1.08) brightness(0.94)';
  }
  if (presetId === 'reels_pop' || presetId === 'reels_party_cut') {
    return 'saturate(1.18) contrast(1.08) brightness(1.02)';
  }
  if (presetId === 'camera_roll' || presetId === 'guest_pov_recap') {
    return 'saturate(1.06) contrast(1.03)';
  }
  return 'saturate(1.04) contrast(1.02) sepia(0.08)';
};

const normalizeUrl = (url: string) => {
  if (url.startsWith('/')) {
    return `${process.env.REMOTION_PUBLIC_BASE_URL || 'http://127.0.0.1:8000'}${url}`;
  }
  return url;
};
