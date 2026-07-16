import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { GraphEdge, GraphNode, NoteGraph } from "@knowledge-agent/core";
import { useLocalization } from "./localization";

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
}

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface PanDrag {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

interface SelectionDrag {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface StarGraphProps {
  graph: NoteGraph;
  onDelete?(path: string): void;
  onDeleteMany?(paths: string[]): void;
  onSelect(path: string): void;
  onSelectionChange?(paths: string[]): void;
  selectedPaths?: string[];
  onViewportChange?(viewport: Viewport): void;
  filterText?: string;
  radiusScale?: number;
  showLabels?: boolean;
  showSecondHop?: boolean;
  viewport?: Viewport;
}

const VIEWBOX = { width: 760, height: 520 };
const DEFAULT_VIEWPORT = { x: 0, y: 0, scale: 1 };
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 3.5;
const ZOOM_WHEEL_SENSITIVITY = 0.00058;
const ZOOM_SMOOTHING = 0.18;
const VIEWPORT_POSITION_EPSILON = 0.08;
const VIEWPORT_SCALE_EPSILON = 0.0008;
const BASE_LABEL_FONT_SIZE = 12;
const LABEL_FULL_READABLE_PX = 10.5;
const LABEL_HIDE_BELOW_PX = 7.8;
const LABEL_MIN_SIZE_COMPENSATION = 0.62;
const LABEL_MAX_SIZE_COMPENSATION = 1.15;

export function StarGraph({
  graph,
  onDelete,
  onDeleteMany,
  onSelect,
  onSelectionChange,
  selectedPaths = [],
  onViewportChange,
  filterText = "",
  radiusScale = 1,
  showLabels = true,
  showSecondHop = true,
  viewport: controlledViewport
}: StarGraphProps) {
  const { t } = useLocalization();
  const initialViewport = controlledViewport ?? DEFAULT_VIEWPORT;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const trashRef = useRef<HTMLButtonElement | null>(null);
  const nodesRef = useRef(new Map<string, SimNode>());
  const dragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const panRef = useRef<PanDrag | null>(null);
  const selectionRef = useRef<SelectionDrag | null>(null);
  const ctrlPressedRef = useRef(false);
  const pendingWheelRef = useRef<{ position: { x: number; y: number }; deltaY: number } | null>(null);
  const wheelFrameRef = useRef<number | null>(null);
  const smoothViewportFrameRef = useRef<number | null>(null);
  const targetViewportRef = useRef<Viewport>(initialViewport);
  const viewportRef = useRef<Viewport>(initialViewport);
  const userViewportRef = useRef(false);
  const [tick, setTick] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | undefined>();
  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [svgUnitScale, setSvgUnitScale] = useState(1);
  const [trashArmed, setTrashArmed] = useState(false);
  const [panning, setPanning] = useState(false);
  const [selectionBox, setSelectionBox] = useState<SelectionDrag | null>(null);
  const visibleGraph = useMemo(() => filterGraph(graph, filterText, showSecondHop), [graph, filterText, showSecondHop]);
  const adjacency = useMemo(() => buildAdjacency(visibleGraph.edges), [visibleGraph.edges]);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  function updateViewport(next: Viewport | ((current: Viewport) => Viewport)) {
    cancelSmoothViewport();
    const value = typeof next === "function" ? next(viewportRef.current) : next;
    targetViewportRef.current = value;
    commitViewport(value);
  }

  function commitViewport(value: Viewport, notify = true) {
    viewportRef.current = value;
    setViewport(value);
    if (notify) {
      onViewportChange?.(value);
    }
  }

  function cancelSmoothViewport() {
    if (smoothViewportFrameRef.current !== null) {
      cancelAnimationFrame(smoothViewportFrameRef.current);
      smoothViewportFrameRef.current = null;
    }
    targetViewportRef.current = viewportRef.current;
  }

  function smoothViewportTo(target: Viewport) {
    targetViewportRef.current = target;
    if (smoothViewportFrameRef.current !== null) return;

    function step() {
      const current = viewportRef.current;
      const nextTarget = targetViewportRef.current;
      const next = lerpViewport(current, nextTarget, ZOOM_SMOOTHING);
      if (isViewportClose(next, nextTarget)) {
        smoothViewportFrameRef.current = null;
        commitViewport(nextTarget);
        return;
      }
      commitViewport(next);
      smoothViewportFrameRef.current = requestAnimationFrame(step);
    }

    smoothViewportFrameRef.current = requestAnimationFrame(step);
  }

  function fitGraphToViewport() {
    updateViewport(fitGraphViewport([...nodesRef.current.values()]));
  }

  useEffect(() => {
    if (controlledViewport) {
      if (isViewportClose(controlledViewport, viewportRef.current)) return;
      cancelSmoothViewport();
      targetViewportRef.current = controlledViewport;
      commitViewport(controlledViewport, false);
    }
  }, [controlledViewport]);

  useEffect(() => {
    return () => {
      cancelSmoothViewport();
    };
  }, []);

  useEffect(() => {
    function updateModifier(event: KeyboardEvent) {
      ctrlPressedRef.current = event.type === "keyup" && event.key === "Control" ? false : event.ctrlKey || event.key === "Control";
    }
    function clearModifier() {
      ctrlPressedRef.current = false;
    }
    window.addEventListener("keydown", updateModifier);
    window.addEventListener("keyup", updateModifier);
    window.addEventListener("blur", clearModifier);
    return () => {
      window.removeEventListener("keydown", updateModifier);
      window.removeEventListener("keyup", updateModifier);
      window.removeEventListener("blur", clearModifier);
    };
  }, []);

  useEffect(() => {
    seedNodes(nodesRef.current, visibleGraph.nodes);
    for (const id of [...nodesRef.current.keys()]) {
      if (!visibleGraph.nodes.some((node) => node.id === id)) {
        nodesRef.current.delete(id);
      }
    }
  }, [visibleGraph.nodes]);

  useEffect(() => {
    if (controlledViewport) return;
    userViewportRef.current = false;
    const timers = [0, 420, 1200].map((delay) =>
      window.setTimeout(() => {
        if (!userViewportRef.current) {
          fitGraphToViewport();
        }
      }, delay)
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [controlledViewport, radiusScale, visibleGraph.edges, visibleGraph.nodes]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measuredSvg = svg;

    function updateSvgUnitScale() {
      const rect = measuredSvg.getBoundingClientRect();
      const next = Math.max(Math.min(rect.width / VIEWBOX.width, rect.height / VIEWBOX.height), 0.01);
      setSvgUnitScale((current) => (Math.abs(current - next) > 0.01 ? next : current));
    }

    updateSvgUnitScale();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSvgUnitScale);
      return () => window.removeEventListener("resize", updateSvgUnitScale);
    }

    const observer = new ResizeObserver(updateSvgUnitScale);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (controlledViewport) return;
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!userViewportRef.current) {
        fitGraphToViewport();
      }
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [controlledViewport, visibleGraph.nodes]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const position = viewPositionFromClient(event.clientX, event.clientY);
      pendingWheelRef.current = pendingWheelRef.current
        ? { position, deltaY: pendingWheelRef.current.deltaY + event.deltaY }
        : { position, deltaY: event.deltaY };

      if (wheelFrameRef.current !== null) return;
      wheelFrameRef.current = requestAnimationFrame(() => {
        const pending = pendingWheelRef.current;
        pendingWheelRef.current = null;
        wheelFrameRef.current = null;
        if (pending) {
          zoomAt(pending.position, pending.deltaY);
        }
      });
    }

    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      svg.removeEventListener("wheel", handleWheel);
      if (wheelFrameRef.current !== null) {
        cancelAnimationFrame(wheelFrameRef.current);
      }
      pendingWheelRef.current = null;
      wheelFrameRef.current = null;
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let running = true;

    function animate() {
      if (!running) return;
      stepSimulation([...nodesRef.current.values()], visibleGraph.edges, radiusScale);
      setTick((value) => value + 1);
      frame = requestAnimationFrame(animate);
    }

    frame = requestAnimationFrame(animate);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
    };
  }, [radiusScale, visibleGraph.edges]);

  const positioned = [...nodesRef.current.values()];

  function viewPositionFromClient(clientX: number, clientY: number) {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return {
      x: transformed.x,
      y: transformed.y
    };
  }

  function viewPosition(event: ReactPointerEvent<SVGElement>) {
    return viewPositionFromClient(event.clientX, event.clientY);
  }

  function graphPosition(event: ReactPointerEvent<SVGElement>) {
    const position = viewPosition(event);
    return {
      x: (position.x - viewport.x) / viewport.scale,
      y: (position.y - viewport.y) / viewport.scale
    };
  }

  function beginSelection(event: ReactPointerEvent<SVGSVGElement | SVGGElement>) {
    panRef.current = null;
    dragRef.current = null;
    setPanning(false);
    const position = graphPosition(event);
    const selection = {
      startX: position.x,
      startY: position.y,
      currentX: position.x,
      currentY: position.y
    };
    selectionRef.current = selection;
    setSelectionBox(selection);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function finishSelection(event: ReactPointerEvent<SVGSVGElement | SVGGElement>) {
    const selection = selectionRef.current;
    if (!selection) return false;
    selectionRef.current = null;
    setSelectionBox(null);
    const left = Math.min(selection.startX, selection.currentX);
    const right = Math.max(selection.startX, selection.currentX);
    const top = Math.min(selection.startY, selection.currentY);
    const bottom = Math.max(selection.startY, selection.currentY);
    const paths = selectNodesInBounds([...nodesRef.current.values()], { left, right, top, bottom });
    onSelectionChange?.(paths);
    event.currentTarget.releasePointerCapture(event.pointerId);
    return true;
  }

  function startDrag(event: ReactPointerEvent<SVGGElement>, id: string) {
    event.stopPropagation();
    if (event.ctrlKey || ctrlPressedRef.current) {
      beginSelection(event);
      return;
    }
    if (shouldClearSelectionOnGraphClick(selectedPaths, id)) {
      onSelectionChange?.([]);
    }
    userViewportRef.current = true;
    cancelSmoothViewport();
    const position = graphPosition(event);
    const node = nodesRef.current.get(id);
    if (!node) return;
    node.fixed = true;
    node.x = position.x;
    node.y = position.y;
    node.vx = 0;
    node.vy = 0;
    dragRef.current = { id, startX: position.x, startY: position.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<SVGGElement>) {
    const dragging = dragRef.current;
    if (!dragging) return;
    const position = graphPosition(event);
    const node = nodesRef.current.get(dragging.id);
    if (!node) return;
    dragging.moved ||= Math.hypot(position.x - dragging.startX, position.y - dragging.startY) > 3;
    node.x = position.x;
    node.y = position.y;
    node.vx = 0;
    node.vy = 0;
    setTrashArmed(isOverGraphTrash(event.clientX, event.clientY));
    setTick((value) => value + 1);
  }

  function endDrag(event: ReactPointerEvent<SVGGElement>, id: string) {
    if (finishSelection(event)) return;
    const dragging = dragRef.current;
    const node = nodesRef.current.get(id);
    if (node) node.fixed = false;
    dragRef.current = null;
    const deleteTarget = Boolean(dragging?.moved && isOverGraphTrash(event.clientX, event.clientY));
    setTrashArmed(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (deleteTarget) {
      onDelete?.(id);
      return;
    }
    if (!dragging?.moved) {
      onSelect(id);
    }
  }

  function isOverGraphTrash(clientX: number, clientY: number) {
    const rect = trashRef.current?.getBoundingClientRect();
    if (!rect) return false;
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function startPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    userViewportRef.current = true;
    cancelSmoothViewport();
    if (event.ctrlKey || ctrlPressedRef.current) {
      beginSelection(event);
      return;
    }
    if ((event.target as Element).closest(".graph-node")) return;
    const position = viewPosition(event);
    panRef.current = {
      startX: position.x,
      startY: position.y,
      originX: viewport.x,
      originY: viewport.y,
      moved: false
    };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: ReactPointerEvent<SVGSVGElement>) {
    const selection = selectionRef.current;
    if (selection) {
      const position = graphPosition(event);
      const nextSelection = { ...selection, currentX: position.x, currentY: position.y };
      selectionRef.current = nextSelection;
      setSelectionBox(nextSelection);
      return;
    }
    const panningState = panRef.current;
    if (!panningState) return;
    const position = viewPosition(event);
    panningState.moved ||= Math.hypot(position.x - panningState.startX, position.y - panningState.startY) > 3;
    updateViewport((current) => ({
      ...current,
      x: panningState.originX + position.x - panningState.startX,
      y: panningState.originY + position.y - panningState.startY
    }));
  }

  function endPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (finishSelection(event)) return;
    const panningState = panRef.current;
    if (!panningState) return;
    panRef.current = null;
    setPanning(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!panningState.moved && shouldClearSelectionOnGraphClick(selectedPaths)) {
      onSelectionChange?.([]);
    }
  }

  function zoomAt(position: { x: number; y: number }, deltaY: number) {
    userViewportRef.current = true;
    const current = targetViewportRef.current;
    const nextScale = clamp(current.scale * Math.exp(-deltaY * ZOOM_WHEEL_SENSITIVITY), MIN_ZOOM, MAX_ZOOM);
    const graphX = (position.x - current.x) / current.scale;
    const graphY = (position.y - current.y) / current.scale;
    smoothViewportTo({
      scale: nextScale,
      x: position.x - graphX * nextScale,
      y: position.y - graphY * nextScale
    });
  }

  return (
    <section className="graph-panel" aria-label="Vault overview graph" data-tick={tick}>
      <svg
        ref={svgRef}
        className={panning ? "panning" : undefined}
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        role="img"
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <g className="graph-viewport" transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          {visibleGraph.edges.map((edge, index) => {
            const source = nodesRef.current.get(edge.source);
            const target = nodesRef.current.get(edge.target);
            if (!source || !target) return null;
            const active = isEdgeActive(edge, hoveredId);
            return (
              <line
                className={edgeClass(edge, hoveredId, active)}
                key={`${edge.source}-${edge.target}-${index}`}
                x1={source.x}
                x2={target.x}
                y1={source.y}
                y2={target.y}
              />
            );
          })}
          {selectionBox ? (
            <rect
              className="graph-selection-box"
              height={Math.abs(selectionBox.currentY - selectionBox.startY)}
              width={Math.abs(selectionBox.currentX - selectionBox.startX)}
              x={Math.min(selectionBox.startX, selectionBox.currentX)}
              y={Math.min(selectionBox.startY, selectionBox.currentY)}
            />
          ) : null}
          {positioned.map((node) => {
            const active = isNodeActive(node.id, hoveredId, adjacency);
            const selected = selectedPathSet.has(node.id);
            const radius = node.depth === 0 ? 8 : node.depth === 1 ? 6 : 5;
            const labelMetrics = graphLabelMetrics(showLabels, viewport.scale, svgUnitScale, node.id, hoveredId, active);
            return (
              <g
                className={nodeClass(node, hoveredId, active, selected)}
                key={node.id}
                onPointerDown={(event) => startDrag(event, node.id)}
                onPointerMove={moveDrag}
                onPointerUp={(event) => endDrag(event, node.id)}
                onPointerCancel={(event) => endDrag(event, node.id)}
                onPointerEnter={() => setHoveredId(node.id)}
                onPointerLeave={() => setHoveredId(undefined)}
                style={{ "--node-radius": `${radius}px` } as CSSProperties}
                tabIndex={0}
              >
                <circle className="graph-node-hitbox" cx={node.x} cy={node.y} r={Math.max(radius + 12, 18)} />
                <circle className="graph-node-dot" cx={node.x} cy={node.y} r={radius} />
                {labelMetrics.opacity > 0.02 ? (
                  <text style={{ fontSize: labelMetrics.fontSize, opacity: labelMetrics.opacity }} x={node.x} y={node.y + labelMetrics.offsetY}>
                    {node.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
      {onDelete ? (
        <button
          aria-label={t("拖拽图谱节点到这里删除")}
          className={trashArmed || selectedPaths.length > 0 ? "graph-trash active" : "graph-trash"}
          disabled={selectedPaths.length > 0 && !onDeleteMany}
          onClick={() => {
            if (selectedPaths.length > 0) onDeleteMany?.(selectedPaths);
          }}
          ref={trashRef}
          title={selectedPaths.length > 0 ? `${t("删除")} ${selectedPaths.length} ${t("文档")}` : t("将单个图谱节点拖到这里删除")}
          type="button"
        >
          <svg aria-hidden="true" className="graph-trash-icon" fill="none" height="14" viewBox="0 0 24 24" width="14">
            <path d="M3 6h18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
            <path d="M8 6V4.8C8 3.8 8.8 3 9.8 3h4.4c1 0 1.8.8 1.8 1.8V6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
            <path d="M6.5 6.5 7.4 20c.1.8.8 1.5 1.7 1.5h5.8c.9 0 1.6-.7 1.7-1.5l.9-13.5" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
            <path d="M10 11v6M14 11v6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
          </svg>
        </button>
      ) : null}
    </section>
  );
}

function filterGraph(graph: NoteGraph, filterText: string, showSecondHop: boolean): NoteGraph {
  const query = filterText.trim().toLowerCase();
  const adjacency = buildAdjacency(graph.edges);
  const nodes = graph.nodes.filter((node) => {
    if (!showSecondHop && node.depth === 2) return false;
    if (!showSecondHop && !(adjacency.get(node.id)?.size ?? 0)) return false;
    if (query === "") return true;
    if (node.label.toLowerCase().includes(query) || node.id.toLowerCase().includes(query)) return true;
    return [...(adjacency.get(node.id) ?? [])].some((id) => id.toLowerCase().includes(query));
  });
  const visibleIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  return { ...graph, nodes, edges };
}

function seedNodes(current: Map<string, SimNode>, nodes: GraphNode[]) {
  const centerX = VIEWBOX.width / 2;
  const centerY = VIEWBOX.height / 2;
  const count = Math.max(nodes.length, 1);

  nodes.forEach((node, index) => {
    if (current.has(node.id)) return;
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    const radius = 90 + 150 * ((index % 5) / 5);
    current.set(node.id, {
      ...node,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      vx: 0,
      vy: 0
    });
  });
}

export function fitGraphViewport(
  nodes: Array<{ x: number; y: number }>,
  viewbox = VIEWBOX,
  padding = 54
): Viewport {
  if (nodes.length === 0) {
    return { x: 0, y: 0, scale: 1 };
  }

  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const graphWidth = Math.max(maxX - minX, 1);
  const graphHeight = Math.max(maxY - minY, 1);
  const usableWidth = Math.max(viewbox.width - padding * 2, 1);
  const usableHeight = Math.max(viewbox.height - padding * 2, 1);
  const scale = clamp(Math.min(usableWidth / graphWidth, usableHeight / graphHeight, 1.25), MIN_ZOOM, 1.25);
  const centerX = minX + graphWidth / 2;
  const centerY = minY + graphHeight / 2;

  return {
    scale,
    x: viewbox.width / 2 - centerX * scale,
    y: viewbox.height / 2 - centerY * scale
  };
}

export function selectNodesInBounds(
  nodes: Array<{ id: string; x: number; y: number }>,
  bounds: { left: number; right: number; top: number; bottom: number }
): string[] {
  return nodes
    .filter((node) => node.x >= bounds.left && node.x <= bounds.right && node.y >= bounds.top && node.y <= bounds.bottom)
    .map((node) => node.id);
}

export function shouldClearSelectionOnGraphClick(selectedPaths: string[], targetPath?: string): boolean {
  return selectedPaths.length > 0 && (targetPath === undefined || !selectedPaths.includes(targetPath));
}

function graphLabelMetrics(
  showLabels: boolean,
  scale: number,
  svgUnitScale: number,
  nodeId: string,
  hoveredId: string | undefined,
  active: boolean
) {
  const compensation = clamp(svgUnitScale, LABEL_MIN_SIZE_COMPENSATION, LABEL_MAX_SIZE_COMPENSATION);
  const fontSize = BASE_LABEL_FONT_SIZE / compensation;
  const screenPx = fontSize * scale * svgUnitScale;
  const readableOpacity = labelReadabilityOpacity(screenPx);
  const opacity = graphLabelOpacity(showLabels, readableOpacity, nodeId, hoveredId, active);
  return {
    fontSize,
    offsetY: 8 + fontSize,
    opacity
  };
}

function graphLabelOpacity(showLabels: boolean, readableOpacity: number, nodeId: string, hoveredId: string | undefined, active: boolean) {
  if (!showLabels) return 0;
  if (hoveredId === nodeId) return Math.max(readableOpacity, 0.9);
  if (hoveredId && active) return readableOpacity > 0 ? Math.max(readableOpacity, 0.78) : 0;
  return readableOpacity;
}

function labelReadabilityOpacity(screenPx: number) {
  if (screenPx >= LABEL_FULL_READABLE_PX) return 1;
  if (screenPx <= LABEL_HIDE_BELOW_PX) return 0;
  return (screenPx - LABEL_HIDE_BELOW_PX) / (LABEL_FULL_READABLE_PX - LABEL_HIDE_BELOW_PX);
}

function stepSimulation(nodes: SimNode[], edges: GraphEdge[], radiusScale: number) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const centerX = VIEWBOX.width / 2;
  const centerY = VIEWBOX.height / 2;
  const desiredLink = 145 * Math.min(Math.max(radiusScale, 0.7), 1.35);

  for (const node of nodes) {
    if (node.fixed) continue;
    node.vx += (centerX - node.x) * 0.00055;
    node.vy += (centerY - node.y) * 0.00055;
  }

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      const dx = right.x - left.x || 0.01;
      const dy = right.y - left.y || 0.01;
      const distanceSq = Math.max(dx * dx + dy * dy, 36);
      const force = Math.min(1850 / distanceSq, 2.1);
      const fx = (dx / Math.sqrt(distanceSq)) * force;
      const fy = (dy / Math.sqrt(distanceSq)) * force;
      if (!left.fixed) {
        left.vx -= fx;
        left.vy -= fy;
      }
      if (!right.fixed) {
        right.vx += fx;
        right.vy += fy;
      }
    }
  }

  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const dx = target.x - source.x || 0.01;
    const dy = target.y - source.y || 0.01;
    const distance = Math.max(Math.hypot(dx, dy), 1);
    const force = (distance - desiredLink) * 0.0052;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    if (!source.fixed) {
      source.vx += fx;
      source.vy += fy;
    }
    if (!target.fixed) {
      target.vx -= fx;
      target.vy -= fy;
    }
  }

  for (const node of nodes) {
    if (node.fixed) continue;
    node.vx *= 0.86;
    node.vy *= 0.86;
    node.x += node.vx;
    node.y += node.vy;
  }
}

function buildAdjacency(edges: GraphEdge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    adjacency.set(edge.source, new Set([...(adjacency.get(edge.source) ?? []), edge.target]));
    adjacency.set(edge.target, new Set([...(adjacency.get(edge.target) ?? []), edge.source]));
  }
  return adjacency;
}

function isEdgeActive(edge: GraphEdge, hoveredId?: string) {
  return hoveredId === undefined || edge.source === hoveredId || edge.target === hoveredId;
}

function isNodeActive(id: string, hoveredId: string | undefined, adjacency: Map<string, Set<string>>) {
  return hoveredId === undefined || id === hoveredId || Boolean(adjacency.get(hoveredId)?.has(id));
}

function edgeClass(edge: GraphEdge, hoveredId: string | undefined, active: boolean) {
  const classes = ["graph-edge"];
  if (!edge.resolved) classes.push("unresolved");
  if (hoveredId) classes.push(active ? "active" : "dimmed");
  return classes.join(" ");
}

function nodeClass(node: SimNode, hoveredId: string | undefined, active: boolean, selected: boolean) {
  const classes = ["graph-node", `depth-${node.depth}`];
  if (node.fixed) classes.push("dragging");
  if (selected) classes.push("selected");
  if (hoveredId) classes.push(active ? "active" : "dimmed");
  return classes.join(" ");
}

function lerpViewport(current: Viewport, target: Viewport, amount: number): Viewport {
  return {
    x: current.x + (target.x - current.x) * amount,
    y: current.y + (target.y - current.y) * amount,
    scale: current.scale + (target.scale - current.scale) * amount
  };
}

function isViewportClose(current: Viewport, target: Viewport) {
  return (
    Math.abs(current.x - target.x) < VIEWPORT_POSITION_EPSILON &&
    Math.abs(current.y - target.y) < VIEWPORT_POSITION_EPSILON &&
    Math.abs(current.scale - target.scale) < VIEWPORT_SCALE_EPSILON
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
