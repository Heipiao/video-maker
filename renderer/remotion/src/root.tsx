import React from 'react';
import {Composition, getInputProps} from 'remotion';
import {WeddingVideo, type ManifestProps} from './wedding-video';

const FPS = 30;

export const Root: React.FC = () => {
  const inputProps = getInputProps<ManifestProps>();
  const spec = inputProps.spec;
  const durationSeconds = spec?.duration_seconds || 30;
  const aspectRatio = spec?.aspect_ratio || '16:9';
  const resolution = inputProps.render?.resolution;
  const [width, height] = resolution
    ? [resolution.width, resolution.height]
    : aspectRatio === '9:16' ? [1080, 1920] : aspectRatio === '1:1' ? [1080, 1080] : [1920, 1080];

  return (
    <Composition
      id="WeddingVideo"
      component={WeddingVideo}
      durationInFrames={Math.max(1, Math.round(durationSeconds * FPS))}
      fps={FPS}
      width={width}
      height={height}
      defaultProps={inputProps}
    />
  );
};
