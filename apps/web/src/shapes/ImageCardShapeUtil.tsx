import {
  HTMLContainer,
  T,
  resizeBox,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { CardShapeUtil } from './CardShapeUtil';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';
import { useCardSelected } from './useCardSelected';

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

export class ImageCardShapeUtil extends CardShapeUtil<ImageCardShape> {
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

  override onResize(shape: ImageCardShape, info: TLResizeInfo<ImageCardShape>) {
    return resizeBox(shape, info, { minWidth: 120, minHeight: 100 });
  }

  override getIndicatorPath(shape: ImageCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, CARD_RADIUS);
  }

  override component(shape: ImageCardShape) {
    return (
      <HTMLContainer>
        <ImageCardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

function ImageCardBody({ shape }: { shape: ImageCardShape }) {
  const { src, name } = shape.props;
  const isSelected = useCardSelected(shape.id);
  // The image IS the card face — no mat, no caption (the primitive title
  // above the card carries the name; the caption doubled it).
  return (
    <div className={`jz-card jz-image-card${isSelected ? ' jz-card-selected' : ''}`}>
      {src ? <img src={src} alt={name} draggable={false} /> : null}
    </div>
  );
}
