import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  useIsEditing,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';

export interface YouTubeCardProps {
  w: number;
  h: number;
  videoId: string;
  url: string;
  title: string;
  /** Caption transcript fetched at paste time — what asks ground on. */
  text?: string;
  /** Whether captions were actually readable (drives the honesty badge).
   *  Undefined = still fetching. */
  hasTranscript?: boolean;
  /** Watched frames (asset ids, time order) — asks ship these as vision
   *  inputs so the model sees the video, not just its transcript. */
  frames?: string[];
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'youtube-card': YouTubeCardProps;
  }
}

export type YouTubeCardShape = TLShape<'youtube-card'>;

export const YOUTUBE_CARD_SIZE = { w: 480, h: 306 }; // 36px header + 16:9 player

export class YouTubeCardShapeUtil extends ShapeUtil<YouTubeCardShape> {
  static override type = 'youtube-card' as const;

  static override props: RecordProps<YouTubeCardShape> = {
    w: T.number,
    h: T.number,
    videoId: T.string,
    url: T.string,
    title: T.string,
    text: T.string.optional(),
    hasTranscript: T.boolean.optional(),
    frames: T.arrayOf(T.string).optional(),
  };

  override getDefaultProps(): YouTubeCardShape['props'] {
    return { ...YOUTUBE_CARD_SIZE, videoId: '', url: '', title: '' };
  }

  override canResize() {
    return true;
  }

  /** Double-click enters editing — the only state where the iframe is interactive. */
  override canEdit() {
    return true;
  }

  override onResize(shape: YouTubeCardShape, info: TLResizeInfo<YouTubeCardShape>) {
    return resizeBox(shape, info, { minWidth: 280, minHeight: 194 });
  }

  override getGeometry(shape: YouTubeCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: YouTubeCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, CARD_RADIUS);
  }

  override component(shape: YouTubeCardShape) {
    return (
      <HTMLContainer>
        <YouTubeCardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

function YouTubeCardBody({ shape }: { shape: YouTubeCardShape }) {
  const isEditing = useIsEditing(shape.id);
  const { videoId, url, title, hasTranscript, frames } = shape.props;
  // Direct media URLs (no YouTube id) play in a native <video> and wear the
  // first WATCHED frame as their poster — the pipeline's stills do the job
  // YouTube's thumbnail server does for youtube ids.
  const poster = videoId
    ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`
    : frames?.[0]
      ? `/api/assets/${encodeURIComponent(frames[0])}`
      : '';

  return (
    <div className="jz-card">
      {/* The header is the drag bar: pointer events fall through to the canvas. */}
      <div className="jz-yt-header">
        <span className="jz-yt-dot" />
        <span className="jz-yt-title">{title || 'YouTube'}</span>
        {/* Honesty badges: can Jarwiz read (and see) this video? Undefined =
            ingest still in flight — say nothing yet. */}
        {hasTranscript === true ? (
          <span className="jz-yt-badge" title="Captions read — asks can quote what's said">transcript ✓</span>
        ) : hasTranscript === false ? (
          <span className="jz-yt-badge jz-yt-badge--none" title="No captions — the speech isn't readable">title only</span>
        ) : null}
        {frames && frames.length > 0 ? (
          <span className="jz-yt-badge" title="Sampled stills — asks can see what's on screen">watched ✓</span>
        ) : null}
        <span className="jz-yt-hint">{isEditing ? 'playing' : 'double-click to play'}</span>
      </div>
      <div className="jz-yt-frame">
        {isEditing && videoId ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1`}
            title={title || 'YouTube video'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            style={{ pointerEvents: 'all' }}
          />
        ) : isEditing && url ? (
          <video src={url} controls autoPlay style={{ pointerEvents: 'all' }} />
        ) : (
          // At rest the card wears the video's poster + a play glyph — an
          // inert iframe reads as a broken embed and steals scroll/drag focus.
          <div className="jz-yt-poster">
            {poster ? (
              <img
                src={poster}
                alt=""
                draggable={false}
                referrerPolicy="no-referrer"
                onError={(e) => e.currentTarget.classList.add('jz-yt-poster-img--dead')}
              />
            ) : null}
            <span className="jz-yt-play" aria-hidden>
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
