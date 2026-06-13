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
    name: T.string,
  },
  'note-card': {
    w: T.number,
    h: T.number,
    text: T.string,
  },
  'doc-card': {
    w: T.number,
    h: T.number,
    text: T.string,
    title: T.string,
  },
  'table-card': {
    w: T.number,
    h: T.number,
    columns: T.arrayOf(T.string),
    rows: T.arrayOf(T.arrayOf(T.string)),
  },
} as const;

export type CardShapeType = keyof typeof cardShapeProps;
