import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';

export interface ImageCardProps {
  w: number;
  h: number;
  /** Data URL of the dropped image (local-first, persists with the board). */
  src: string;
  name: string;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'image-card': ImageCardProps;
  }
}

export type ImageCardShape = TLShape<'image-card'>;

export class ImageCardShapeUtil extends ShapeUtil<ImageCardShape> {
  static override type = 'image-card' as const;

  static override props: RecordProps<ImageCardShape> = {
    w: T.number,
    h: T.number,
    src: T.string,
    name: T.string,
  };

  override getDefaultProps(): ImageCardShape['props'] {
    return { w: 360, h: 300, src: '', name: '' };
  }

  override canResize() {
    return true;
  }

  override onResize(shape: ImageCardShape, info: TLResizeInfo<ImageCardShape>) {
    return resizeBox(shape, info, { minWidth: 120, minHeight: 100 });
  }

  override getGeometry(shape: ImageCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: ImageCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, CARD_RADIUS);
  }

  override component(shape: ImageCardShape) {
    const { src, name } = shape.props;
    return (
      <HTMLContainer>
        <div className="jz-card jz-image-card">
          <div className="jz-image-frame">
            {src ? <img src={src} alt={name} draggable={false} /> : null}
          </div>
          {name ? <div className="jz-image-caption">{name}</div> : null}
        </div>
      </HTMLContainer>
    );
  }
}
