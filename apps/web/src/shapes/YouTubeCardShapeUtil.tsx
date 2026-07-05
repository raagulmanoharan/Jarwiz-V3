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
  const { videoId, title, hasTranscript } = shape.props;

  return (
    <div className="jz-card">
      {/* The header is the drag bar: pointer events fall through to the canvas. */}
      <div className="jz-yt-header">
        <span className="jz-yt-dot" />
        <span className="jz-yt-title">{title || 'YouTube'}</span>
        {/* Honesty badge: can Jarwiz actually read this video? Undefined =
            transcript fetch still in flight — say nothing yet. */}
        {hasTranscript === true ? (
          <span className="jz-yt-badge" title="Captions read — asks can quote what's said">transcript ✓</span>
        ) : hasTranscript === false ? (
          <span className="jz-yt-badge jz-yt-badge--none" title="No captions — only the title is readable">title only</span>
        ) : null}
        <span className="jz-yt-hint">{isEditing ? 'playing' : 'double-click to play'}</span>
      </div>
      <div className="jz-yt-frame">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`}
          title={title || 'YouTube video'}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          // While not editing, the iframe must not swallow canvas drags.
          style={{ pointerEvents: isEditing ? 'all' : 'none' }}
        />
      </div>
    </div>
  );
}
