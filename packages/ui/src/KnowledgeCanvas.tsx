import {
  BoxSelect,
  Hand,
  LayoutGrid,
  Magnet,
  FileText,
  Group,
  Link2,
  Maximize2,
  Plus,
  Redo2,
  Search,
  Table2,
  Trash2,
  Type,
  Undo2,
  X
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode
} from "react";
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position, NodeResizer,
  MarkerType, SelectionMode, type Node, type NodeProps, type NodeChange,
  type Edge, type ReactFlowInstance
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useLocalization } from "./localization";

export type CanvasCardType = "text" | "table" | "note";
export type CanvasRelationship = "relates" | "supports" | "contradicts" | "depends" | "references";

export interface CanvasTableData {
  columns: string[];
  rows: string[][];
}

export interface CanvasCard {
  id: string;
  type: CanvasCardType;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  text?: string;
  table?: CanvasTableData;
  notePath?: string;
}

export interface CanvasConnection {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  relationship: CanvasRelationship;
}

export interface CanvasGroup {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  cardIds: string[];
}

export interface CanvasViewport {
  x: number;
  y: number;
  scale: number;
}

export interface KnowledgeCanvasDocument {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cards: CanvasCard[];
  connections: CanvasConnection[];
  groups: CanvasGroup[];
  viewport: CanvasViewport;
}

export interface CanvasNoteReference {
  path: string;
  title: string;
  content: string;
  tags?: string[];
}

export type CanvasSaveState = "idle" | "saving" | "saved" | "error" | "read-only";

interface KnowledgeCanvasProps {
  document: KnowledgeCanvasDocument;
  notes: CanvasNoteReference[];
  readOnly?: boolean;
  saveState?: CanvasSaveState;
  onChange(document: KnowledgeCanvasDocument): void;
  onOpenNote(path: string): void;
}

type CanvasFlowNode = Node<{ content: ReactNode }, "card" | "topic">;
function CanvasFlowNodeView({ data }: NodeProps<CanvasFlowNode>) { return <>{data.content}</>; }
const FLOW_NODE_TYPES = { card: CanvasFlowNodeView, topic: CanvasFlowNodeView };
const edgeColors: Record<CanvasRelationship, string> = {
  relates: "#8b819f", supports: "#5b9b7e", contradicts: "#bd676e", depends: "#af8959", references: "#9270c7"
};
const NOTE_DRAG_TYPE = "application/x-knowledge-note";

const MIN_SCALE = 0.28;
const MAX_SCALE = 2.4;
const HISTORY_LIMIT = 80;
const CARD_MIN_WIDTH = 180;
const CARD_MIN_HEIGHT = 120;
const RELATIONSHIP_LABELS: Record<CanvasRelationship, string> = {
  relates: "相关",
  supports: "支持",
  contradicts: "冲突",
  depends: "依赖",
  references: "引用"
};

export function createEmptyCanvasDocument(name = "知识画布"): KnowledgeCanvasDocument {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: createId("canvas"),
    name,
    createdAt: now,
    updatedAt: now,
    cards: [],
    connections: [],
    groups: [],
    viewport: { x: 0, y: 0, scale: 1 }
  };
}

export function normalizeCanvasDocument(value: unknown, fallbackName = "知识画布"): KnowledgeCanvasDocument {
  if (!isRecord(value)) return createEmptyCanvasDocument(fallbackName);
  const fallback = createEmptyCanvasDocument(fallbackName);
  const cards = Array.isArray(value.cards) ? value.cards.map(normalizeCard).filter(isCanvasCard) : [];
  const cardIds = new Set(cards.map((card) => card.id));
  const connections = Array.isArray(value.connections)
    ? value.connections.map(normalizeConnection).filter((connection): connection is CanvasConnection => (
      connection !== null
      && cardIds.has(connection.sourceId)
      && cardIds.has(connection.targetId)
      && connection.sourceId !== connection.targetId
    ))
    : [];
  const groups = Array.isArray(value.groups)
    ? value.groups.map((group) => normalizeGroup(group, cardIds)).filter((group): group is CanvasGroup => group !== null)
    : [];
  const viewport = isRecord(value.viewport)
    ? {
        x: finiteNumber(value.viewport.x, 0),
        y: finiteNumber(value.viewport.y, 0),
        scale: clamp(finiteNumber(value.viewport.scale, 1), MIN_SCALE, MAX_SCALE)
      }
    : fallback.viewport;
  return {
    version: 1,
    id: safeString(value.id, fallback.id),
    name: safeString(value.name, fallbackName),
    createdAt: safeString(value.createdAt, fallback.createdAt),
    updatedAt: safeString(value.updatedAt, fallback.updatedAt),
    cards,
    connections,
    groups,
    viewport
  };
}

export function KnowledgeCanvas({
  document,
  notes,
  readOnly = false,
  saveState = "idle",
  onChange,
  onOpenNote
}: KnowledgeCanvasProps) {
  const { t } = useLocalization();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef(document);
  const gestureRef = useRef<KnowledgeCanvasDocument | null>(null);
  const flowRef = useRef<ReactFlowInstance<CanvasFlowNode, Edge> | null>(null);
  const [panMode, setPanMode] = useState(false);
  const [snap, setSnap] = useState(false);
  const editSnapshotRef = useRef<KnowledgeCanvasDocument | null>(null);
  const undoStackRef = useRef<KnowledgeCanvasDocument[]>([]);
  const redoStackRef = useRef<KnowledgeCanvasDocument[]>([]);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [noteQuery, setNoteQuery] = useState("");
  const [historyRevision, setHistoryRevision] = useState(0);

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setSelectedCardIds([]);
    setSelectedConnectionId(null);
    setSelectedGroupId(null);
    setConnectSourceId(null);
    setHistoryRevision((value) => value + 1);
  }, [document.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if (!stageRef.current?.parentElement?.contains(target as globalThis.Node)) return;
      if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (!editing && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        deleteSelection();
      }
      if (!editing && event.key === "Escape") {
        setSelectedCardIds([]);
        setSelectedConnectionId(null);
        setSelectedGroupId(null);
        setConnectSourceId(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const notesByPath = useMemo(() => new Map(notes.map((note) => [note.path, note])), [notes]);
  const filteredNotes = useMemo(() => {
    const query = noteQuery.trim().toLocaleLowerCase();
    if (!query) return notes.slice(0, 80);
    return notes
      .filter((note) => `${note.title} ${note.path}`.toLocaleLowerCase().includes(query))
      .slice(0, 80);
  }, [noteQuery, notes]);
  const selectedConnection = document.connections.find((connection) => connection.id === selectedConnectionId) ?? null;
  const selectedCards = document.cards.filter((card) => selectedCardIds.includes(card.id));

  function publish(nextDocument: KnowledgeCanvasDocument, recordHistory = false) {
    const next = {
      ...nextDocument,
      updatedAt: new Date().toISOString()
    };
    if (recordHistory) {
      pushUndo(documentRef.current);
      redoStackRef.current = [];
      setHistoryRevision((value) => value + 1);
    }
    documentRef.current = next;
    onChange(next);
  }

  function pushUndo(snapshot: KnowledgeCanvasDocument) {
    undoStackRef.current = [...undoStackRef.current.slice(-(HISTORY_LIMIT - 1)), snapshot];
  }

  function undo() {
    const previous = undoStackRef.current.at(-1);
    if (!previous || readOnly) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current.slice(-(HISTORY_LIMIT - 1)), documentRef.current];
    documentRef.current = previous;
    onChange(previous);
    setHistoryRevision((value) => value + 1);
  }

  function redo() {
    const next = redoStackRef.current.at(-1);
    if (!next || readOnly) return;
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    pushUndo(documentRef.current);
    documentRef.current = next;
    onChange(next);
    setHistoryRevision((value) => value + 1);
  }

  function viewportCenter() {
    const bounds = stageRef.current?.getBoundingClientRect();
    const viewport = documentRef.current.viewport;
    if (!bounds) return { x: 180, y: 120 };
    return {
      x: (bounds.width / 2 - viewport.x) / viewport.scale,
      y: (bounds.height / 2 - viewport.y) / viewport.scale
    };
  }

  function addTextCard() {
    if (readOnly) return;
    const center = viewportCenter();
    const card: CanvasCard = {
      id: createId("text"),
      type: "text",
      x: center.x - 130,
      y: center.y - 85,
      width: 260,
      height: 170,
      title: t("新文本"),
      text: ""
    };
    publish({ ...documentRef.current, cards: [...documentRef.current.cards, card] }, true);
    setSelectedCardIds([card.id]);
  }

  function addTableCard() {
    if (readOnly) return;
    const center = viewportCenter();
    const card: CanvasCard = {
      id: createId("table"),
      type: "table",
      x: center.x - 190,
      y: center.y - 125,
      width: 380,
      height: 250,
      title: t("新表格"),
      table: {
        columns: [t("列 1"), t("列 2"), t("列 3")],
        rows: [["", "", ""], ["", "", ""]]
      }
    };
    publish({ ...documentRef.current, cards: [...documentRef.current.cards, card] }, true);
    setSelectedCardIds([card.id]);
  }

  function addNoteCard(note: CanvasNoteReference, position?: { x: number; y: number }) {
    if (readOnly) return;
    const center = viewportCenter();
    const offset = documentRef.current.cards.length % 5;
    const card: CanvasCard = {
      id: createId("note"),
      type: "note",
      x: position?.x ?? center.x - 150 + offset * 24,
      y: position?.y ?? center.y - 100 + offset * 18,
      width: 300,
      height: 200,
      title: note.title,
      notePath: note.path
    };
    publish({ ...documentRef.current, cards: [...documentRef.current.cards, card] }, true);
    setSelectedCardIds([card.id]);
    setNotePickerOpen(false);
    setNoteQuery("");
  }

  function updateCard(cardId: string, updater: (card: CanvasCard) => CanvasCard, recordHistory = false) {
    const current = documentRef.current;
    publish({
      ...current,
      cards: current.cards.map((card) => (card.id === cardId ? updater(card) : card))
    }, recordHistory);
  }

  function beginEdit() {
    if (!editSnapshotRef.current) editSnapshotRef.current = documentRef.current;
  }

  function finishEdit() {
    const snapshot = editSnapshotRef.current;
    editSnapshotRef.current = null;
    if (!snapshot || snapshot === documentRef.current) return;
    pushUndo(snapshot);
    redoStackRef.current = [];
    setHistoryRevision((value) => value + 1);
  }

  function beginGesture() {
    if (!gestureRef.current) gestureRef.current = documentRef.current;
  }
  function finishGesture() {
    const before = gestureRef.current;
    gestureRef.current = null;
    if (before && (before.cards !== documentRef.current.cards || before.groups !== documentRef.current.groups)) {
      pushUndo(before);
      redoStackRef.current = [];
      setHistoryRevision((value) => value + 1);
    }
  }
  function changeNodes(changes: NodeChange<CanvasFlowNode>[]) {
    const selection = changes.filter(change => change.type === "select");
    if (selection.length) {
      setSelectedCardIds(previous => {
        const ids = new Set(previous);
        for (const change of selection) {
          if (change.type !== "select" || !change.id.startsWith("card:")) continue;
          const id = change.id.slice(5);
          if (change.selected) ids.add(id); else ids.delete(id);
        }
        return [...ids];
      });
      setSelectedGroupId(previous => {
        let id = previous;
        for (const change of selection) {
          if (change.type !== "select" || !change.id.startsWith("group:")) continue;
          if (change.selected) id = change.id.slice(6);
          else if (id === change.id.slice(6)) id = null;
        }
        return id;
      });
      if (selection.some(change => change.type === "select" && change.selected)) setSelectedConnectionId(null);
    }
    if (readOnly) return;
    const current = documentRef.current;
    const moved = moveCanvasNodes(current, changes);
    if (moved !== current) publish(moved, !gestureRef.current);
  }
  function arrangeCards() {
    if (readOnly || documentRef.current.cards.length < 2) return;
    publish(arrangeCanvasCards(documentRef.current), true);
    requestAnimationFrame(() => void flowRef.current?.fitView({ padding: 0.15, maxZoom: 1 }));
  }

  function createConnection(sourceId: string, targetId: string) {
    if (readOnly || sourceId === targetId) return;
    const current = documentRef.current;
    const duplicate = current.connections.some((connection) => (
      connection.sourceId === sourceId && connection.targetId === targetId
    ));
    if (!duplicate) {
      publish({
        ...current,
        connections: [
          ...current.connections,
          {
            id: createId("edge"),
            sourceId,
            targetId,
            label: RELATIONSHIP_LABELS.relates,
            relationship: "relates"
          }
        ]
      }, true);
    }
    setConnectSourceId(null);
  }

  function groupSelection() {
    if (readOnly || selectedCards.length < 2) return;
    const padding = 42;
    const left = Math.min(...selectedCards.map((card) => card.x)) - padding;
    const top = Math.min(...selectedCards.map((card) => card.y)) - padding - 20;
    const right = Math.max(...selectedCards.map((card) => card.x + card.width)) + padding;
    const bottom = Math.max(...selectedCards.map((card) => card.y + card.height)) + padding;
    const group: CanvasGroup = {
      id: createId("group"),
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      title: t("主题分组"),
      cardIds: selectedCards.map((card) => card.id)
    };
    publish({ ...documentRef.current, groups: [...documentRef.current.groups, group] }, true);
    setSelectedGroupId(group.id);
    setSelectedCardIds([]);
  }

  function deleteSelection() {
    if (readOnly) return;
    const current = documentRef.current;
    if (selectedConnectionId) {
      publish({
        ...current,
        connections: current.connections.filter((connection) => connection.id !== selectedConnectionId)
      }, true);
      setSelectedConnectionId(null);
      return;
    }
    if (selectedGroupId) {
      publish({ ...current, groups: current.groups.filter((group) => group.id !== selectedGroupId) }, true);
      setSelectedGroupId(null);
      return;
    }
    if (selectedCardIds.length === 0) return;
    const selected = new Set(selectedCardIds);
    publish({
      ...current,
      cards: current.cards.filter((card) => !selected.has(card.id)),
      connections: current.connections.filter((connection) => (
        !selected.has(connection.sourceId) && !selected.has(connection.targetId)
      )),
      groups: current.groups
        .map((group) => ({ ...group, cardIds: group.cardIds.filter((id) => !selected.has(id)) }))
        .filter((group) => group.cardIds.length > 0)
    }, true);
    setSelectedCardIds([]);
  }

  function fitToContent() {
    void flowRef.current?.fitView({ padding: 0.15, maxZoom: 1.3 });
  }

  const flowNodes: CanvasFlowNode[] = [
    ...document.groups.map((group): CanvasFlowNode => ({
      id: "group:" + group.id, type: "topic", position: { x: group.x, y: group.y },
      width: group.width, height: group.height,
      style: { width: group.width, height: group.height }, zIndex: -1,
      selectable: false,
      selected: selectedGroupId === group.id, dragHandle: ".canvas-group-header",
      data: { content: <div className={`canvas-group${selectedGroupId === group.id ? " is-selected" : ""}`}>
        <div className="canvas-group-header"><Group size={14}/><input className="nodrag"
          value={group.title} disabled={readOnly} aria-label={t("分组名称")}
          onFocus={beginEdit} onBlur={finishEdit}
          onChange={event => publish({ ...documentRef.current, groups: documentRef.current.groups.map(item => item.id === group.id ? { ...item, title: event.target.value } : item) })}/>
        </div>
      </div> }
    })),
    ...document.cards.map((card): CanvasFlowNode => {
      const selected = selectedCardIds.includes(card.id);
      const note = card.notePath ? notesByPath.get(card.notePath) : undefined;
      return {
        id: "card:" + card.id, type: "card", position: { x: card.x, y: card.y },
        width: card.width, height: card.height,
        style: { width: card.width, height: card.height }, selected,
        dragHandle: ".canvas-card-header", zIndex: 1,
        data: { content: <>
          <NodeResizer isVisible={selected && !readOnly} minWidth={CARD_MIN_WIDTH} minHeight={CARD_MIN_HEIGHT}
            onResizeStart={beginGesture} onResizeEnd={finishGesture}/>
          <Handle type="target" position={Position.Left} isConnectable={!readOnly} aria-label={t("连入此卡片")}/>
          <article className={`canvas-card canvas-card-${card.type}${selected ? " is-selected" : ""}${connectSourceId === card.id ? " is-link-source" : ""}`}>
            <div className="canvas-card-header">
              {card.type === "text" ? <Type size={14}/> : card.type === "table" ? <Table2 size={14}/> : <FileText size={14}/>}
              <input className="nodrag" value={card.type === "note" && note ? note.title : card.title}
                disabled={readOnly || card.type === "note"} onFocus={beginEdit} onBlur={finishEdit}
                onChange={event => updateCard(card.id, item => ({ ...item, title: event.target.value }))} aria-label={t("卡片标题")}/>
              <button type="button" className="nodrag" disabled={readOnly} title={t("从此卡片建立连线")}
                onClick={event => { event.stopPropagation(); setConnectSourceId(id => id === card.id ? null : card.id); }}><Link2 size={14}/></button>
            </div>
            {card.type === "text" ? <textarea className="nodrag nowheel" value={card.text ?? ""} disabled={readOnly}
              onFocus={beginEdit} onBlur={finishEdit} onChange={event => updateCard(card.id, item => ({ ...item, text: event.target.value }))}
              placeholder={t("写下观点、问题或结论…")}/> : null}
            {card.type === "note" ? <button type="button" className="canvas-note-card-body nodrag nowheel"
              title={t("双击打开原笔记")} onDoubleClick={() => card.notePath && onOpenNote(card.notePath)}>
              <p>{note ? noteExcerpt(note.content) : t("原笔记已不存在")}</p>
              <div>{(note?.tags ?? []).slice(0,4).map(tag => <span key={tag}>#{tag}</span>)}</div>
              <small>{card.notePath}</small>
            </button> : null}
            {card.type === "table" ? <CanvasTableEditor card={card} readOnly={readOnly} onFocus={beginEdit} onBlur={finishEdit}
              onChange={table => updateCard(card.id, item => ({ ...item, table }))}
              onCommit={table => updateCard(card.id, item => ({ ...item, table }), true)}/> : null}
          </article>
          <Handle type="source" position={Position.Right} isConnectable={!readOnly} aria-label={t("从此卡片连出")}/>
        </> }
      };
    })
  ];
  const flowEdges: Edge[] = document.connections.map(connection => ({
    id: connection.id, source: "card:" + connection.sourceId, target: "card:" + connection.targetId,
    label: connection.label || t(RELATIONSHIP_LABELS[connection.relationship]),
    type: "smoothstep", selected: selectedConnectionId === connection.id,
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColors[connection.relationship] },
    style: { stroke: edgeColors[connection.relationship], strokeWidth: selectedConnectionId === connection.id ? 3 : 1.8,
      strokeDasharray: connection.relationship === "contradicts" ? "5 4" : undefined },
    interactionWidth: 24
  }));

  return (
    <section className="knowledge-canvas" aria-label={t("知识画布")} tabIndex={-1}>
      <div className="canvas-toolbar">
        <div className="canvas-toolbar-group">
          <button type="button" aria-pressed={!panMode} onClick={() => setPanMode(false)} title={t("选择与框选")}><BoxSelect size={15}/><span>{t("选择")}</span></button>
          <button type="button" aria-pressed={panMode} onClick={() => setPanMode(true)} title={t("平移画布")}><Hand size={15}/><span>{t("平移")}</span></button>
        </div>
        <div className="canvas-toolbar-group">
          <button type="button" onClick={addTextCard} disabled={readOnly} title={t("添加文本卡片")}>
            <Type size={15} />
            <span>{t("文本")}</span>
          </button>
          <button type="button" onClick={addTableCard} disabled={readOnly} title={t("添加表格卡片")}>
            <Table2 size={15} />
            <span>{t("表格")}</span>
          </button>
          <button
            type="button"
            onClick={() => setNotePickerOpen((open) => !open)}
            disabled={readOnly || notes.length === 0}
            title={t("添加知识库笔记")}
          >
            <FileText size={15} />
            <span>{t("笔记")}</span>
          </button>
        </div>
        <div className="canvas-toolbar-group">
          <button
            type="button"
            onClick={groupSelection}
            disabled={readOnly || selectedCards.length < 2}
            title={t("将所选卡片组成主题分组")}
          >
            <Group size={15} />
          </button>
          <button
            type="button"
            onClick={() => undo()}
            disabled={readOnly || undoStackRef.current.length === 0}
            title={t("撤销")}
            data-history-revision={historyRevision}
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            onClick={() => redo()}
            disabled={readOnly || redoStackRef.current.length === 0}
            title={t("重做")}
          >
            <Redo2 size={15} />
          </button>
          <button type="button" onClick={arrangeCards} disabled={readOnly || document.cards.length < 2} title={t("整理布局（可撤销）")}><LayoutGrid size={15}/><span>{t("整理布局")}</span></button>
          <button type="button" onClick={() => setSnap(value => !value)} aria-pressed={snap} title={t("吸附网格")}><Magnet size={15}/></button>
          <button type="button" onClick={fitToContent} title={t("适应全部内容")}>
            <Maximize2 size={15} />
          </button>
          <button
            type="button"
            onClick={deleteSelection}
            disabled={readOnly || (selectedCardIds.length === 0 && !selectedConnectionId && !selectedGroupId)}
            title={t("删除所选内容")}
          >
            <Trash2 size={15} />
          </button>
        </div>
        <div className={`canvas-save-state is-${saveState}`}>
          <span aria-hidden="true" />
          {saveState === "saving"
            ? t("正在保存")
            : saveState === "error"
              ? t("保存失败")
              : saveState === "read-only"
                ? t("只读画布")
                : saveState === "saved"
                  ? t("已保存")
                  : t("画布")}
        </div>
      </div>

      {notePickerOpen ? (
        <aside className="canvas-note-picker">
          <div className="canvas-note-picker-header">
            <strong>{t("添加知识库笔记")}</strong>
            <button type="button" onClick={() => setNotePickerOpen(false)} title={t("关闭")}>
              <X size={15} />
            </button>
          </div>
          <label>
            <Search size={14} />
            <input
              value={noteQuery}
              onChange={(event) => setNoteQuery(event.target.value)}
              placeholder={t("搜索笔记")}
              autoFocus
            />
          </label>
          <div className="canvas-note-picker-list">
            {filteredNotes.map((note) => (
              <button type="button" key={note.path} draggable onDragStart={event => { event.dataTransfer.setData(NOTE_DRAG_TYPE, note.path); event.dataTransfer.effectAllowed = "copy"; }} onClick={() => addNoteCard(note)}>
                <FileText size={14} />
                <span>
                  <strong>{note.title}</strong>
                  <small>{note.path}</small>
                </span>
              </button>
            ))}
            {filteredNotes.length === 0 ? <p>{t("没有匹配的笔记")}</p> : null}
          </div>
        </aside>
      ) : null}

      <div ref={stageRef} className="canvas-stage canvas-flow-stage" tabIndex={0} aria-label={t("画布编辑区")}
        onDragOver={event => { if (event.dataTransfer.types.includes(NOTE_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
        onDrop={event => {
          const note = notesByPath.get(event.dataTransfer.getData(NOTE_DRAG_TYPE));
          if (!note || readOnly) return;
          event.preventDefault();
          addNoteCard(note, flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }}>
        <ReactFlow<CanvasFlowNode, Edge> key={document.id} nodes={flowNodes} edges={flowEdges} nodeTypes={FLOW_NODE_TYPES}
          onInit={instance => { flowRef.current = instance; }}
          onNodesChange={changeNodes} onNodeDragStart={(_, node) => {
            beginGesture();
            if (node.type === "topic") { setSelectedGroupId(node.id.slice(6)); setSelectedCardIds([]); setSelectedConnectionId(null); }
          }} onNodeDragStop={finishGesture}
          onSelectionDragStart={beginGesture} onSelectionDragStop={finishGesture}
          onNodeClick={(_, node) => {
            if (node.type === "topic") { setSelectedGroupId(node.id.slice(6)); setSelectedCardIds([]); setSelectedConnectionId(null); }
            else if (connectSourceId && node.id.slice(5) !== connectSourceId) createConnection(connectSourceId, node.id.slice(5));
          }}
          onConnect={connection => createConnection(connection.source.slice(5), connection.target.slice(5))}
          onEdgeClick={(_, edge) => { setSelectedConnectionId(edge.id); setSelectedCardIds([]); setSelectedGroupId(null); }}
          onPaneClick={() => { setSelectedCardIds([]); setSelectedGroupId(null); setSelectedConnectionId(null); setConnectSourceId(null); }}
          viewport={{ x: document.viewport.x, y: document.viewport.y, zoom: document.viewport.scale }}
          onViewportChange={viewport => {
            const current = documentRef.current;
            if (current.viewport.x !== viewport.x || current.viewport.y !== viewport.y || current.viewport.scale !== viewport.zoom)
              publish({ ...current, viewport: { x: viewport.x, y: viewport.y, scale: viewport.zoom } });
          }}
          nodesDraggable={!readOnly} nodesConnectable={!readOnly} edgesReconnectable={false}
          deleteKeyCode={null} selectionOnDrag={!panMode} selectionMode={SelectionMode.Partial}
          panOnDrag={panMode ? true : [1, 2]} panActivationKeyCode="Space"
          multiSelectionKeyCode={["Shift", "Meta", "Control"]} zoomOnDoubleClick={false}
          minZoom={MIN_SCALE} maxZoom={MAX_SCALE} snapToGrid={snap} snapGrid={[20,20]} elevateNodesOnSelect={false}
          ariaLabelConfig={{ 'controls.ariaLabel': t("画布控制"), 'controls.zoomIn.ariaLabel': t("放大"), 'controls.zoomOut.ariaLabel': t("缩小"), 'controls.fitView.ariaLabel': t("适应全部内容"), 'minimap.ariaLabel': t("画布小地图") }}
          defaultEdgeOptions={{ zIndex: 0 }}>
          <Background gap={20} size={1}/>
          <Controls showInteractive={false}/>
          <MiniMap pannable zoomable nodeColor={node => node.type === "topic" ? "#b9a7d2" : "#8b70bb"}/>
        </ReactFlow>
        {document.cards.length === 0 ? <div className="canvas-empty-state">
          <BoxSelect size={28}/><strong>{t("从卡片开始组织知识")}</strong>
          <span>{t("添加文本、表格或真实笔记，再用有意义的连线表达关系。")}</span>
        </div> : null}
      </div>
      <div className="canvas-help-bar"><span>{t("拖动空白处框选 · 空格拖动平移 · 滚轮缩放 · 拖动卡片两侧圆点连线")}</span><span>{Math.round(document.viewport.scale * 100)}%</span></div>

      {selectedConnection ? (
        <aside className="canvas-connection-inspector">
          <div>
            <strong>{t("连线含义")}</strong>
            <button type="button" onClick={() => setSelectedConnectionId(null)} title={t("关闭")}>
              <X size={14} />
            </button>
          </div>
          <label>
            <span>{t("关系")}</span>
            <select
              aria-label={t("关系")}
              value={selectedConnection.relationship}
              disabled={readOnly}
              onChange={(event) => {
                const relationship = event.target.value as CanvasRelationship;
                const current = documentRef.current;
                publish({
                  ...current,
                  connections: current.connections.map((connection) => (
                    connection.id === selectedConnection.id
                      ? { ...connection, relationship, label: RELATIONSHIP_LABELS[relationship] }
                      : connection
                  ))
                }, true);
              }}
            >
              {(Object.keys(RELATIONSHIP_LABELS) as CanvasRelationship[]).map((relationship) => (
                <option key={relationship} value={relationship}>{t(RELATIONSHIP_LABELS[relationship])}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("自定义说明")}</span>
            <input
              value={selectedConnection.label}
              disabled={readOnly}
              onFocus={beginEdit}
              onBlur={finishEdit}
              onChange={(event) => {
                const current = documentRef.current;
                publish({
                  ...current,
                  connections: current.connections.map((connection) => (
                    connection.id === selectedConnection.id ? { ...connection, label: event.target.value } : connection
                  ))
                });
              }}
            />
          </label>
        </aside>
      ) : null}

      {connectSourceId ? (
        <div className="canvas-connect-hint">
          <Link2 size={14} />
          <span>{t("请选择另一张卡片完成连线")}</span>
          <button type="button" onClick={() => setConnectSourceId(null)} title={t("取消")}>
            <X size={14} />
          </button>
        </div>
      ) : null}
    </section>
  );
}

function CanvasTableEditor({
  card,
  readOnly,
  onFocus,
  onBlur,
  onChange,
  onCommit
}: {
  card: CanvasCard;
  readOnly: boolean;
  onFocus(): void;
  onBlur(event: FocusEvent): void;
  onChange(table: CanvasTableData): void;
  onCommit(table: CanvasTableData): void;
}) {
  const { t } = useLocalization();
  const table = card.table ?? { columns: [t("列 1")], rows: [[""]] };
  return (
    <div className="canvas-table-wrap nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
      <table>
        <thead>
          <tr>
            {table.columns.map((column, columnIndex) => (
              <th key={`${card.id}-column-${columnIndex}`}>
                <input
                  value={column}
                  disabled={readOnly}
                  onFocus={onFocus}
                  onBlur={onBlur}
                  onChange={(event) => onChange({
                    ...table,
                    columns: table.columns.map((item, index) => index === columnIndex ? event.target.value : item)
                  })}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={`${card.id}-row-${rowIndex}`}>
              {table.columns.map((_, columnIndex) => (
                <td key={`${card.id}-cell-${rowIndex}-${columnIndex}`}>
                  <input
                    value={row[columnIndex] ?? ""}
                    disabled={readOnly}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    onChange={(event) => onChange({
                      ...table,
                      rows: table.rows.map((currentRow, currentRowIndex) => (
                        currentRowIndex === rowIndex
                          ? table.columns.map((__, currentColumnIndex) => (
                              currentColumnIndex === columnIndex ? event.target.value : currentRow[currentColumnIndex] ?? ""
                            ))
                          : currentRow
                      ))
                    })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly ? (
        <div className="canvas-table-actions">
          <button
            type="button"
            onClick={() => onCommit({
              ...table,
              rows: [...table.rows, table.columns.map(() => "")]
            })}
          >
            <Plus size={13} />
            {t("行")}
          </button>
          <button
            type="button"
            onClick={() => onCommit({
              columns: [...table.columns, `${t("列")} ${table.columns.length + 1}`],
              rows: table.rows.map((row) => [...row, ""])
            })}
          >
            <Plus size={13} />
            {t("列")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// The persisted v1 model remains independent from React Flow and usable by the CLI.
export function moveCanvasNodes(current: KnowledgeCanvasDocument, changes: NodeChange<CanvasFlowNode>[]): KnowledgeCanvasDocument {
  const positions = new Map<string, { x: number; y: number }>();
  const dimensions = new Map<string, { width: number; height: number }>();
  for (const change of changes) {
    if (change.type === "position" && change.position) positions.set(change.id, change.position);
    if (change.type === "dimensions" && change.dimensions && change.setAttributes) dimensions.set(change.id, change.dimensions);
  }
  if (!positions.size && !dimensions.size) return current;
  let changed = false;
  const groupDeltas = new Map<string, { x: number; y: number }>();
  const groups = current.groups.map(group => {
    const next = positions.get("group:" + group.id);
    if (!next || (next.x === group.x && next.y === group.y)) return group;
    changed = true;
    for (const id of group.cardIds) if (!groupDeltas.has(id)) groupDeltas.set(id, { x: next.x - group.x, y: next.y - group.y });
    return { ...group, ...next };
  });
  const cards = current.cards.map(card => {
    const delta = groupDeltas.get(card.id);
    const position = positions.get("card:" + card.id) ?? (delta ? { x: card.x + delta.x, y: card.y + delta.y } : card);
    const size = dimensions.get("card:" + card.id) ?? card;
    const width = Math.max(CARD_MIN_WIDTH, size.width), height = Math.max(CARD_MIN_HEIGHT, size.height);
    if (position.x === card.x && position.y === card.y && width === card.width && height === card.height) return card;
    changed = true;
    return { ...card, x: position.x, y: position.y, width, height };
  });
  return changed ? { ...current, cards, groups } : current;
}

export function arrangeCanvasCards(document: KnowledgeCanvasDocument): KnowledgeCanvasDocument {
  if (document.cards.length < 2) return document;
  const columns = Math.ceil(Math.sqrt(document.cards.length));
  const cellWidth = Math.max(...document.cards.map(card => card.width)) + 72;
  const cellHeight = Math.max(...document.cards.map(card => card.height)) + 90;
  const originX = Math.min(...document.cards.map(card => card.x));
  const originY = Math.min(...document.cards.map(card => card.y));
  const cards = document.cards.map((card, index) => ({ ...card, x: originX + (index % columns) * cellWidth, y: originY + Math.floor(index / columns) * cellHeight }));
  const groups = document.groups.map(group => {
    const members = cards.filter(card => group.cardIds.includes(card.id));
    if (!members.length) return group;
    const x = Math.min(...members.map(card => card.x)) - 30;
    const y = Math.min(...members.map(card => card.y)) - 50;
    return { ...group, x, y, width: Math.max(...members.map(card => card.x + card.width)) - x + 30, height: Math.max(...members.map(card => card.y + card.height)) - y + 30 };
  });
  return { ...document, cards, groups };
}

function normalizeCard(value: unknown): CanvasCard | null {
  if (!isRecord(value)) return null;
  const type = value.type === "table" || value.type === "note" ? value.type : value.type === "text" ? "text" : null;
  if (!type) return null;
  const table = isRecord(value.table)
    ? {
        columns: Array.isArray(value.table.columns) ? value.table.columns.map((column) => safeString(column, "")) : [],
        rows: Array.isArray(value.table.rows)
          ? value.table.rows.map((row) => Array.isArray(row) ? row.map((cell) => safeString(cell, "")) : [])
          : []
      }
    : undefined;
  return {
    id: safeString(value.id, createId(type)),
    type,
    x: finiteNumber(value.x, 0),
    y: finiteNumber(value.y, 0),
    width: Math.max(CARD_MIN_WIDTH, finiteNumber(value.width, type === "table" ? 380 : 260)),
    height: Math.max(CARD_MIN_HEIGHT, finiteNumber(value.height, type === "table" ? 250 : 170)),
    title: safeString(value.title, ""),
    text: typeof value.text === "string" ? value.text : undefined,
    table,
    notePath: typeof value.notePath === "string" ? value.notePath : undefined
  };
}

function normalizeConnection(value: unknown): CanvasConnection | null {
  if (!isRecord(value)) return null;
  const relationship = isRelationship(value.relationship) ? value.relationship : "relates";
  return {
    id: safeString(value.id, createId("edge")),
    sourceId: safeString(value.sourceId, ""),
    targetId: safeString(value.targetId, ""),
    label: safeString(value.label, RELATIONSHIP_LABELS[relationship]),
    relationship
  };
}

function normalizeGroup(value: unknown, cardIds: Set<string>): CanvasGroup | null {
  if (!isRecord(value)) return null;
  const validCardIds = Array.isArray(value.cardIds)
    ? value.cardIds.filter((id): id is string => typeof id === "string" && cardIds.has(id))
    : [];
  if (validCardIds.length === 0) return null;
  return {
    id: safeString(value.id, createId("group")),
    x: finiteNumber(value.x, 0),
    y: finiteNumber(value.y, 0),
    width: Math.max(240, finiteNumber(value.width, 520)),
    height: Math.max(180, finiteNumber(value.height, 360)),
    title: safeString(value.title, "主题分组"),
    cardIds: validCardIds
  };
}

function isCanvasCard(value: CanvasCard | null): value is CanvasCard {
  return value !== null;
}

function isRelationship(value: unknown): value is CanvasRelationship {
  return value === "relates"
    || value === "supports"
    || value === "contradicts"
    || value === "depends"
    || value === "references";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function noteExcerpt(content: string): string {
  return content
    .replace(/^---[\s\S]*?---\s*/u, "")
    .replace(/!\[\[[^\]]+\]\]/gu, "")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/gu, (_, target: string, alias?: string) => alias ?? target)
    .replace(/[#>*_`~-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 220);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
