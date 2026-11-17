import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Note } from '../types/vault';
import {
  buildKnowledgeGraph,
  findNodeAtPosition,
  GraphEdge,
  GraphNode,
  stepGraphSimulation,
} from '../utils/graph';

interface GraphViewProps {
  notes: Note[];
  activeNoteId: string | null;
  isDark: boolean;
  onSelectNote: (noteId: string) => void;
}

export const GraphView: React.FC<GraphViewProps> = ({
  notes,
  activeNoteId,
  isDark,
  onSelectNote,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hideOrphans, setHideOrphans] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hoveredTitle, setHoveredTitle] = useState<string | null>(null);

  const graphStats = useMemo(() => {
    const built = buildKnowledgeGraph(notes, 800, 560);
    const visibleNodes = hideOrphans ? built.nodes.filter((n) => n.degree > 0) : built.nodes;
    return {
      nodesCount: visibleNodes.length,
      edgesCount: built.edges.length,
    };
  }, [notes, hideOrphans]);

  const graphRef = useRef<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  });
  const dragNodeRef = useRef<string | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const animIdRef = useRef<number>(0);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const { nodes, edges } = graphRef.current;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const z = zoomRef.current;
    ctx.translate(w / 2, h / 2);
    ctx.scale(z, z);
    ctx.translate(-w / 2, -h / 2);

    const nodeMap = new Map<string, GraphNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    const hoveredId = hoveredNodeRef.current;

    // Draw edges
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      const isHighlighted = hoveredId === a.id || hoveredId === b.id;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = isHighlighted
        ? '#8B5CF6'
        : isDark
        ? 'rgba(148, 163, 184, 0.24)'
        : 'rgba(100, 116, 139, 0.28)';
      ctx.lineWidth = isHighlighted ? 1.8 : 1;
      ctx.stroke();
    }

    // Draw nodes
    for (const node of nodes) {
      const isActive = node.id === activeNoteId;
      const isHovered = node.id === hoveredId;
      const r = 6 + Math.min(8, node.degree * 2);

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      if (isActive) {
        ctx.fillStyle = '#7C3AED';
      } else if (isHovered) {
        ctx.fillStyle = '#A78BFA';
      } else {
        ctx.fillStyle = isDark ? '#525866' : '#94A3B8';
      }
      ctx.fill();

      if (isActive || isHovered) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = isDark ? '#E8EAED' : '#18181B';
        ctx.stroke();
      }

      ctx.font = `${isActive || isHovered ? '600' : '500'} 11.5px "DM Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = isActive || isHovered
        ? isDark
          ? '#F4F4F5'
          : '#18181B'
        : isDark
        ? '#A1A1AA'
        : '#52525B';
      ctx.fillText(node.title, node.x, node.y + r + 15);
    }

    ctx.restore();
  }, [activeNoteId, isDark]);

  const startSimulation = useCallback(() => {
    cancelAnimationFrame(animIdRef.current);

    const tick = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const { nodes, edges } = graphRef.current;

      stepGraphSimulation(nodes, edges, w / 2, h / 2, dragNodeRef.current);
      drawFrame();

      let maxSpeed = 0;
      for (const n of nodes) {
        const speed = Math.abs(n.vx) + Math.abs(n.vy);
        if (speed > maxSpeed) maxSpeed = speed;
      }

      if (dragNodeRef.current || maxSpeed > 0.08) {
        animIdRef.current = requestAnimationFrame(tick);
      } else {
        animIdRef.current = 0;
      }
    };

    animIdRef.current = requestAnimationFrame(tick);
  }, [drawFrame]);

  const rebuildGraph = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    const w = rect?.width || 800;
    const h = rect?.height || 560;
    const built = buildKnowledgeGraph(notes, w, h);
    if (hideOrphans) {
      built.nodes = built.nodes.filter((n) => n.degree > 0);
    }
    for (let i = 0; i < 65; i++) {
      stepGraphSimulation(built.nodes, built.edges, w / 2, h / 2);
    }
    graphRef.current = built;
    drawFrame();
    startSimulation();
  }, [notes, hideOrphans, drawFrame, startSimulation]);

  useEffect(() => {
    rebuildGraph();
    return () => cancelAnimationFrame(animIdRef.current);
  }, [rebuildGraph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = Math.max(300, Math.floor(rect.width * dpr));
      canvas.height = Math.max(240, Math.floor(rect.height * dpr));
      drawFrame();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [drawFrame]);

  useEffect(() => {
    drawFrame();
  }, [zoom, drawFrame]);

  const toGraphCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const rawX = clientX - rect.left;
    const rawY = clientY - rect.top;
    return {
      x: (rawX - w / 2) / zoom + w / 2,
      y: (rawY - h / 2) / zoom + h / 2,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toGraphCoords(e.clientX, e.clientY);
    const hit = findNodeAtPosition(graphRef.current.nodes, x, y);
    if (hit) {
      dragNodeRef.current = hit.id;
      startSimulation();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toGraphCoords(e.clientX, e.clientY);
    if (dragNodeRef.current) {
      const node = graphRef.current.nodes.find((n) => n.id === dragNodeRef.current);
      if (node) {
        node.x = x;
        node.y = y;
      }
      return;
    }
    const hit = findNodeAtPosition(graphRef.current.nodes, x, y);
    const nextHovered = hit ? hit.id : null;
    if (hoveredNodeRef.current !== nextHovered) {
      hoveredNodeRef.current = nextHovered;
      setHoveredTitle(hit ? hit.title : null);
      drawFrame();
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragNodeRef.current) {
      const { x, y } = toGraphCoords(e.clientX, e.clientY);
      const hit = findNodeAtPosition(graphRef.current.nodes, x, y);
      if (hit && hit.id === dragNodeRef.current) {
        onSelectNote(hit.id);
      }
    }
    dragNodeRef.current = null;
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-zinc-50 dark:bg-[#0E1014]">
      <canvas
        ref={canvasRef}
        data-testid="knowledge-graph-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          dragNodeRef.current = null;
          if (hoveredNodeRef.current !== null) {
            hoveredNodeRef.current = null;
            setHoveredTitle(null);
            drawFrame();
          }
        }}
        className={`h-full w-full ${hoveredTitle ? 'cursor-pointer' : 'cursor-grab'}`}
      />

      {/* Graph Controls Overlay */}
      <div className="absolute top-4 left-4 flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-[#16191E]/90 px-3 py-1.5 text-xs backdrop-blur-xs">
        <span className="font-medium text-zinc-800 dark:text-zinc-200">
          Knowledge Graph
        </span>
        <span aria-hidden="true" className="text-zinc-400">·</span>
        <span className="font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
          {graphStats.nodesCount} notes · {graphStats.edgesCount} links
        </span>
      </div>

      <div className="absolute top-4 right-4 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setHideOrphans((v) => !v)}
          className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
            hideOrphans
              ? 'border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-300'
              : 'border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-[#16191E]/90 text-zinc-600 dark:text-zinc-300'
          }`}
        >
          {hideOrphans ? 'Showing Linked Only' : 'Hide Orphans'}
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(2, +(z + 0.2).toFixed(1)))}
          aria-label="Zoom in graph"
          className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-[#16191E]/90 p-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.2).toFixed(1)))}
          aria-label="Zoom out graph"
          className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-[#16191E]/90 p-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(1);
            rebuildGraph();
          }}
          aria-label="Reset graph layout"
          className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-[#16191E]/90 p-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      {hoveredTitle && (
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white/95 dark:bg-[#16191E]/95 px-2.5 py-1 text-xs font-medium text-zinc-800 dark:text-zinc-100">
          Click to open: {hoveredTitle}
        </div>
      )}
    </div>
  );
};
