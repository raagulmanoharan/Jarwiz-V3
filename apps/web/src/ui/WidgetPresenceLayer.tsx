/**
 * Presence for widget builds — while an inline widget hydrates (a real model
 * generation, often 10–90s), the Jarwiz avatar parks beside the doc card it
 * belongs to with an honest status naming the concept. Presence is the
 * product: the wait must read as a collaborator working, never as nothing.
 * Listens to DocWidgetBlock's hydration events; ref-counts so several blocks
 * building at once keep one calm avatar, ended when the last finishes.
 */

import { useEffect } from 'react';
import { useEditor, type TLShapeId } from 'tldraw';
import { getAgent } from '@jarwiz/shared';
import { endPresence, setPresenceCursor, setPresenceStatus, startPresence } from '../agents/presence';
import { WIDGET_HYDRATION_EVENT, type WidgetHydrationDetail } from './DocWidgetBlock';

const PRESENCE = getAgent('writer');

export function WidgetPresenceLayer() {
  const editor = useEditor();

  useEffect(() => {
    const active = new Map<string, string>(); // key → concept
    const onEvent = (e: Event) => {
      const { key, sourceId, concept, phase } = (e as CustomEvent<WidgetHydrationDetail>).detail;
      if (phase === 'start') {
        if (active.size === 0) startPresence(PRESENCE.id);
        active.set(key, concept);
        setPresenceStatus(PRESENCE.id, `building: ${concept.slice(0, 48)}…`);
        const bounds = sourceId ? editor.getShapePageBounds(sourceId as TLShapeId) : null;
        if (bounds) setPresenceCursor(PRESENCE.id, bounds.maxX - 14, bounds.maxY - 16);
        return;
      }
      active.delete(key);
      if (active.size === 0) endPresence(PRESENCE.id);
      else setPresenceStatus(PRESENCE.id, `building: ${[...active.values()][0]!.slice(0, 48)}…`);
    };
    window.addEventListener(WIDGET_HYDRATION_EVENT, onEvent);
    return () => {
      window.removeEventListener(WIDGET_HYDRATION_EVENT, onEvent);
      endPresence(PRESENCE.id);
    };
  }, [editor]);

  return null;
}
