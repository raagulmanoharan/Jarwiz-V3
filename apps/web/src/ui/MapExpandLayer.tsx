/**
 * Listens for a doc map block's "⤢ expand map" (DocMapBlock dispatches a DOM
 * event so DocMarkdown stays dependency-free) and promotes the block into a
 * full standalone map card: placed in the doc's lane, provenance wired back to
 * the doc (meta.jzSources → ProvenanceLayer hairline), selected so the action
 * bar (and its ⤢ Expand into the trip view) is immediately at hand.
 */

import { useEffect } from 'react';
import { createShapeId, useEditor } from 'tldraw';
import { MAP_CARD_SIZE, type MapCardShape } from '../shapes';
import { MAP_EXPAND_EVENT, type MapExpandDetail } from './DocMapBlock';
import { frameBounds } from './bringIntoView';
import { placeInLane, PROV_META_KEY } from '../ask/useAsk';

export function MapExpandLayer() {
  const editor = useEditor();

  useEffect(() => {
    const onExpand = (e: Event) => {
      const { stops, ordered, sourceId } = (e as CustomEvent<MapExpandDetail>).detail;
      if (!stops?.length) return;
      const source = sourceId ? editor.getShape(sourceId as MapCardShape['id']) : undefined;
      const title = source ? String((source.props as { title?: unknown }).title ?? '') : '';
      const at = placeInLane(editor, source ? [source.id] : [], MAP_CARD_SIZE.w, MAP_CARD_SIZE.h);
      const id = createShapeId();
      editor.createShape<MapCardShape>({
        id,
        type: 'map-card',
        x: at.x,
        y: at.y,
        props: {
          w: MAP_CARD_SIZE.w,
          h: MAP_CARD_SIZE.h,
          title: title || 'Trip map',
          intro: '',
          stops,
          ordered,
          status: 'done',
        },
        ...(source ? { meta: { [PROV_META_KEY]: [source.id] } } : {}),
      });
      editor.select(id);
      const bounds = editor.getShapePageBounds(id);
      if (bounds) frameBounds(editor, bounds, { margin: 60, animation: { duration: 320 } });
    };
    window.addEventListener(MAP_EXPAND_EVENT, onExpand);
    return () => window.removeEventListener(MAP_EXPAND_EVENT, onExpand);
  }, [editor]);

  return null;
}
