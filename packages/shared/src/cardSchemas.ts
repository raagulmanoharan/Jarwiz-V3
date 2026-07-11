/**
 * Card shape prop schemas — the single source of truth for every custom card's
 * validated props, shared by the web ShapeUtils (rendering) and the sync server
 * (which must validate the same records). Defining them here, free of React,
 * lets both sides build an identical TLSchema so multiplayer sync round-trips
 * custom cards correctly.
 *
 * Keep in lockstep with each ShapeUtil's getDefaultProps.
 */

import { T } from '@tldraw/validate';

export const cardShapeProps = {
  'link-card': {
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
  },
  'youtube-card': {
    w: T.number,
    h: T.number,
    videoId: T.string,
    url: T.string,
    title: T.string,
  },
  'image-card': {
    w: T.number,
    h: T.number,
    src: T.string,
    name: T.string,
  },
  'pdf-card': {
    w: T.number,
    h: T.number,
    src: T.string,
    assetId: T.string,
    name: T.string,
    pages: T.number,
    status: T.literalEnum('uploading', 'ready', 'error'),
  },
  'note-card': {
    w: T.number,
    h: T.number,
    text: T.string,
    color: T.string,
  },
  'doc-card': {
    w: T.number,
    h: T.number,
    text: T.string,
    title: T.string,
    sourcePdfId: T.string,
  },
  'table-card': {
    w: T.number,
    h: T.number,
    columns: T.arrayOf(T.string),
    rows: T.arrayOf(T.arrayOf(T.string)),
  },
  'diagram-card': {
    w: T.number,
    h: T.number,
    code: T.string,
    title: T.string,
  },
  'map-card': {
    w: T.number,
    h: T.number,
    title: T.string,
    /** The one-line thesis behind the geometry (shown in the focus rail, P1). */
    intro: T.string,
    /** Geocoded stops in visiting order — see MapStop in protocol.ts. */
    stops: T.arrayOf(
      T.object({
        name: T.string,
        query: T.string,
        lat: T.number,
        lng: T.number,
        approx: T.boolean.optional(),
        day: T.string.optional(),
        time: T.string.optional(),
        note: T.string.optional(),
      }),
    ),
    /** Route (ordered stops, dashed line) vs. places (options, no line). */
    ordered: T.boolean,
    /** 'running' (pins still landing) | 'done' | 'error'. */
    status: T.string,
  },
  'prototype-card': {
    w: T.number,
    h: T.number,
    /** A self-contained HTML document (inline CSS/JS, no external resources). */
    html: T.string,
    title: T.string,
    /** What the user asked to prototype (kept so it can be re-generated). */
    prompt: T.string,
    /** 'idle' (awaiting a prompt) | 'running' | 'done' | 'error'. */
    status: T.string,
  },
} as const;

export type CardShapeType = keyof typeof cardShapeProps;
