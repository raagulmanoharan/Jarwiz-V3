/**
 * The auto-cluster button — appears above a set of recently-dropped artifacts
 * that share a surface-level thread (a common keyword or domain). One tap tidies
 * them together and raises content-aware pills on the cluster. It only offers;
 * if there's no commonality, it isn't shown.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { Box, stopEventPropagation, useEditor, useValue } from 'tldraw';
import { getClusterCandidate, subscribeCluster, type ClusterCandidate } from './cluster';

interface ClusterButtonProps {
  onCluster: (candidate: ClusterCandidate) => void;
}

export function ClusterButton({ onCluster }: ClusterButtonProps) {
  const editor = useEditor();
  const candidate = useSyncExternalStore(subscribeCluster, getClusterCandidate, getClusterCandidate);

  const anchor = useValue(
    'jarwiz cluster anchor',
    () => {
      if (!candidate) return null;
      const boxes = candidate.ids
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is Box => Boolean(b));
      if (boxes.length < 2) return null;
      const union = boxes.reduce((acc, b) => acc.union(b), boxes[0]!.clone());
      const top = editor.pageToViewport({ x: union.midX, y: union.minY });
      return { x: top.x, y: top.y, count: candidate.ids.length };
    },
    [editor, candidate],
  );

  if (!candidate || !anchor) return null;

  return (
    <button
      className="jz-cluster-btn"
      style={{ left: anchor.x, top: anchor.y - 44 } as CSSProperties}
      onPointerDown={stopEventPropagation}
      onClick={() => onCluster(candidate)}
      title={`These ${anchor.count} drops look related (${candidate.theme})`}
    >
      <span className="jz-cluster-spark" aria-hidden>
        ✦
      </span>
      Cluster {anchor.count} related
    </button>
  );
}
