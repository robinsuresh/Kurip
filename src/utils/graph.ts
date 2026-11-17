import { Note } from '../types/vault';
import { extractWikilinks } from './markdown';

export interface GraphNode {
  id: string;
  title: string;
  folder: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Builds deterministic initial graph nodes and edges from vault notes and their [[wikilinks]].
 */
export function buildKnowledgeGraph(notes: Note[], width = 800, height = 600): GraphData {
  const titleToId = new Map<string, string>();
  for (const n of notes) {
    titleToId.set(n.title.trim().toLowerCase(), n.id);
  }

  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const degreeMap = new Map<string, number>();

  for (const note of notes) {
    const links = extractWikilinks(note.content);
    for (const targetTitle of links) {
      const targetId = titleToId.get(targetTitle.toLowerCase());
      if (targetId && targetId !== note.id) {
        const key = [note.id, targetId].sort().join('::');
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edges.push({ source: note.id, target: targetId });
          degreeMap.set(note.id, (degreeMap.get(note.id) || 0) + 1);
          degreeMap.set(targetId, (degreeMap.get(targetId) || 0) + 1);
        }
      }
    }
  }

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.28;

  const nodes: GraphNode[] = notes.map((note, idx) => {
    const angle = (idx / Math.max(1, notes.length)) * Math.PI * 2;
    return {
      id: note.id,
      title: note.title,
      folder: note.folder,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      degree: degreeMap.get(note.id) || 0,
    };
  });

  return { nodes, edges };
}

/**
 * Advances force-directed layout by one tick without mutating input arrays in place when cloned,
 * or mutating node velocities/positions cleanly for animation loops.
 */
export function stepGraphSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerX: number,
  centerY: number,
  pinnedNodeId?: string | null
): void {
  const nodeMap = new Map<string, GraphNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const repulsion = 7500;
  const springLength = 190;
  const springK = 0.032;
  const gravity = 0.01;
  const damping = 0.82;

  // Repulsion between all pairs
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x || 0.5;
      const dy = b.y - a.y || 0.5;
      const distSq = Math.max(400, dx * dx + dy * dy);
      const dist = Math.sqrt(distSq);
      const force = repulsion / distSq;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  // Spring attraction along edges
  for (const edge of edges) {
    const a = nodeMap.get(edge.source);
    const b = nodeMap.get(edge.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const displacement = dist - springLength;
    const fx = (dx / dist) * displacement * springK;
    const fy = (dy / dist) * displacement * springK;

    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  // Center gravity + integration
  for (const n of nodes) {
    if (pinnedNodeId === n.id) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx += (centerX - n.x) * gravity;
    n.vy += (centerY - n.y) * gravity;
    n.vx *= damping;
    n.vy *= damping;
    n.x += n.vx;
    n.y += n.vy;
  }
}

/**
 * Finds the node under a given canvas coordinate.
 */
export function findNodeAtPosition(nodes: GraphNode[], x: number, y: number): GraphNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const r = 7 + Math.min(8, n.degree * 2) + 6;
    const dx = x - n.x;
    const dy = y - n.y;
    if (dx * dx + dy * dy <= r * r) {
      return n;
    }
  }
  return null;
}
