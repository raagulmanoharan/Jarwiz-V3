import { useState } from 'react';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  stopEventPropagation,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { domainInitial, domainOf } from '../lib/url';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';

export interface LinkCardProps {
  w: number;
  h: number;
  url: string;
  title: string;
  description: string;
  image: string;
  favicon: string;
  themeColor: string;
  siteName: string;
  loading: boolean;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'link-card': LinkCardProps;
  }
}

export type LinkCardShape = TLShape<'link-card'>;

export const LINK_CARD_SIZE = { w: 320, h: 300 };

export class LinkCardShapeUtil extends ShapeUtil<LinkCardShape> {
  static override type = 'link-card' as const;

  static override props: RecordProps<LinkCardShape> = {
    w: T.number,
    h: T.number,
    url: T.string,
    title: T.string,
    description: T.string,
    image: T.string,
    favicon: T.string,
    themeColor: T.string,
    siteName: T.string,
    loading: T.boolean,
  };

  override getDefaultProps(): LinkCardShape['props'] {
    return {
      ...LINK_CARD_SIZE,
      url: '',
      title: '',
      description: '',
      image: '',
      favicon: '',
      themeColor: '',
      siteName: '',
      loading: false,
    };
  }

  override canResize() {
    return true;
  }

  override onResize(shape: LinkCardShape, info: TLResizeInfo<LinkCardShape>) {
    return resizeBox(shape, info, { minWidth: 220, minHeight: 180 });
  }

  override getGeometry(shape: LinkCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: LinkCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, CARD_RADIUS);
  }

  override component(shape: LinkCardShape) {
    return (
      <HTMLContainer>
        {shape.props.loading ? <LinkCardSkeleton /> : <LinkCardBody {...shape.props} />}
      </HTMLContainer>
    );
  }
}

function LinkCardSkeleton() {
  return (
    <div className="jz-card">
      <div className="jz-link-media">
        <div className="jz-skeleton" style={{ position: 'absolute', inset: 0, borderRadius: 0 }} />
      </div>
      <div className="jz-link-body">
        <div className="jz-skeleton" style={{ height: 14, width: '82%' }} />
        <div className="jz-skeleton" style={{ height: 14, width: '58%' }} />
        <div className="jz-skeleton" style={{ height: 10, width: '92%', marginTop: 4 }} />
        <div className="jz-link-footer">
          <div className="jz-favicon-fallback" />
          <div className="jz-skeleton" style={{ height: 10, width: 96 }} />
        </div>
      </div>
    </div>
  );
}

function LinkCardBody(props: LinkCardShape['props']) {
  const { url, title, description, image, favicon, themeColor, siteName } = props;
  const domain = domainOf(url);

  return (
    <div className="jz-card">
      <LinkCardMedia image={image} url={url} themeColor={themeColor} siteName={siteName} />
      <div className="jz-link-body">
        <div className="jz-link-title jz-clamp-2">{title || domain}</div>
        {description ? <div className="jz-link-desc jz-clamp-3">{description}</div> : null}
        <div className="jz-link-footer">
          <Favicon src={favicon} />
          <span className="jz-domain">{domain}</span>
          {url ? (
            <a
              className="jz-open-link"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in new tab"
              style={{ pointerEvents: 'all' }}
              onPointerDown={stopEventPropagation}
              draggable={false}
            >
              <OpenIcon />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LinkCardMedia({
  image,
  url,
  themeColor,
  siteName,
}: Pick<LinkCardShape['props'], 'image' | 'url' | 'themeColor' | 'siteName'>) {
  const [broken, setBroken] = useState(false);
  const showImage = image !== '' && !broken;

  const tint = themeColor
    ? { background: `color-mix(in srgb, ${themeColor} 22%, #efe7d8)` }
    : undefined;

  return (
    <div className="jz-link-media" style={showImage ? undefined : tint}>
      {showImage ? (
        <img src={image} alt="" draggable={false} onError={() => setBroken(true)} />
      ) : (
        <div className="jz-media-fallback">
          <span className="jz-media-glyph">{domainInitial(url)}</span>
          <span>{siteName || domainOf(url)}</span>
        </div>
      )}
    </div>
  );
}

function Favicon({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  if (src === '' || broken) return <div className="jz-favicon-fallback" />;
  return <img className="jz-favicon" src={src} alt="" draggable={false} onError={() => setBroken(true)} />;
}

function OpenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M4 2h6v6M10 2 3 9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
