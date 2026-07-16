import { useMemo, useState } from "react";
import type { GraphEdge, GraphNode, NoteGraph } from "@knowledge-agent/core";
import { useLocalization } from "./localization";

interface PositionedMiniNode extends GraphNode {
  x: number;
  y: number;
}

export interface MiniStarGraphProps {
  graph: NoteGraph;
  currentPath: string;
  onSelect(path: string): void;
}

const MINI_VIEWBOX = { width: 360, height: 138 };
const CENTER = { x: MINI_VIEWBOX.width / 2, y: 66 };
const MAX_RELATED_NODES = 18;

export function MiniStarGraph({ graph, currentPath, onSelect }: MiniStarGraphProps) {
  const { t } = useLocalization();
  const [hoveredId, setHoveredId] = useState<string | undefined>();
  const layout = useMemo(() => layoutMiniGraph(graph, currentPath), [graph, currentPath]);
  const adjacency = useMemo(() => buildAdjacency(layout.edges), [layout.edges]);

  if (layout.nodes.length === 0) return null;

  return (
    <aside className="mini-graph-panel" aria-label={t("当前笔记关系小图")}>
      <svg viewBox={`0 0 ${MINI_VIEWBOX.width} ${MINI_VIEWBOX.height}`} role="img">
        {layout.edges.map((edge, index) => {
          const source = layout.nodeById.get(edge.source);
          const target = layout.nodeById.get(edge.target);
          if (!source || !target) return null;
          return (
            <line
              className={miniEdgeClass(edge, currentPath, hoveredId)}
              key={`${edge.source}-${edge.target}-${index}`}
              x1={source.x}
              x2={target.x}
              y1={source.y}
              y2={target.y}
            />
          );
        })}
        {layout.nodes.map((node) => {
          const current = node.id === currentPath;
          const unresolved = !node.resolved;
          const directlyInvolved = current || node.depth <= 1;
          const active = isMiniNodeActive(node.id, currentPath, hoveredId, adjacency);
          return (
            <g
              className={miniNodeClass(node, current, hoveredId, active, directlyInvolved, unresolved)}
              key={node.id}
              onClick={() => onSelect(node.id)}
              onPointerEnter={() => setHoveredId(node.id)}
              onPointerLeave={() => setHoveredId(undefined)}
              tabIndex={0}
            >
              <circle className="mini-graph-hitbox" cx={node.x} cy={node.y} r={current ? 18 : 14} />
              <circle className="mini-graph-dot" cx={node.x} cy={node.y} r={current ? 7 : node.depth === 1 ? 5 : 4} />
              {unresolved ? <circle className="mini-graph-unresolved-ring" cx={node.x} cy={node.y} r={node.depth === 1 ? 8 : 7} /> : null}
              <title>{unresolved ? `${t("待创建")}: ${node.label}` : node.label}</title>
              {directlyInvolved || hoveredId === node.id ? (
                <text x={node.x} y={node.y + (current ? 20 : 16)}>
                  {shortLabel(node.label)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </aside>
  );
}

export function layoutMiniGraph(graph: NoteGraph, currentPath: string) {
  const centerNode = graph.nodes.find((node) => node.id === currentPath) ?? graph.nodes.find((node) => node.depth === 0);
  if (!centerNode) {
    return { nodes: [] as PositionedMiniNode[], edges: [] as GraphEdge[], nodeById: new Map<string, PositionedMiniNode>() };
  }

  const related = graph.nodes
    .filter((node) => node.id !== centerNode.id)
    .sort((left, right) => left.depth - right.depth || left.label.localeCompare(right.label, "zh-Hans-CN", { numeric: true }))
    .slice(0, MAX_RELATED_NODES);

  const firstHop = related.filter((node) => node.depth <= 1);
  const secondHop = related.filter((node) => node.depth > 1);
  const nodes: PositionedMiniNode[] = [
    { ...centerNode, id: currentPath, x: CENTER.x, y: CENTER.y },
    ...positionRing(firstHop, 104, 42),
    ...positionRing(secondHop, 150, 55, Math.PI / Math.max(secondHop.length, 1))
  ];
  const visibleIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return { nodes, edges, nodeById };
}

function positionRing(nodes: GraphNode[], radiusX: number, radiusY: number, offset = 0): PositionedMiniNode[] {
  const count = Math.max(nodes.length, 1);
  return nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2 + offset;
    return {
      ...node,
      x: CENTER.x + Math.cos(angle) * radiusX,
      y: CENTER.y + Math.sin(angle) * radiusY
    };
  });
}

function buildAdjacency(edges: GraphEdge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    adjacency.set(edge.source, new Set([...(adjacency.get(edge.source) ?? []), edge.target]));
    adjacency.set(edge.target, new Set([...(adjacency.get(edge.target) ?? []), edge.source]));
  }
  return adjacency;
}

function isMiniNodeActive(id: string, currentPath: string, hoveredId: string | undefined, adjacency: Map<string, Set<string>>) {
  if (hoveredId) return id === hoveredId || Boolean(adjacency.get(hoveredId)?.has(id));
  return id === currentPath || Boolean(adjacency.get(currentPath)?.has(id));
}

function miniNodeClass(
  node: PositionedMiniNode,
  current: boolean,
  hoveredId: string | undefined,
  active: boolean,
  directlyInvolved: boolean,
  unresolved: boolean
) {
  const classes = ["mini-graph-node", `depth-${node.depth}`];
  if (current) classes.push("current");
  if (unresolved) classes.push("unresolved");
  if (!directlyInvolved) classes.push("unrelated");
  if (hoveredId) classes.push(active ? "active" : "dimmed");
  return classes.join(" ");
}

function miniEdgeClass(edge: GraphEdge, currentPath: string, hoveredId?: string) {
  const classes = ["mini-graph-edge"];
  if (!edge.resolved) classes.push("unresolved");
  if (edge.source === currentPath || edge.target === currentPath) classes.push("current");
  if (hoveredId) classes.push(edge.source === hoveredId || edge.target === hoveredId ? "active" : "dimmed");
  return classes.join(" ");
}

function shortLabel(label: string) {
  return label.length > 10 ? `${label.slice(0, 10)}...` : label;
}
