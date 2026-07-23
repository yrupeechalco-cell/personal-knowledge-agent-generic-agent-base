import {
  BoxSelect,
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
  type PointerEvent as ReactPointerEvent,
  type WheelEvent
} from "react";
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

interface DragState {
  startClientX: number;
  startClientY: number;
  startDocument: KnowledgeCanvasDocument;
  cardPositions: Map<string, { x: number; y: number }>;
  groupId?: string;
  groupPosition?: { x: number; y: number };
  moved: boolean;
}

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
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<{ x: number; y: number; viewport: CanvasViewport } | null>(null);
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
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

  function addNoteCard(note: CanvasNoteReference) {
    if (readOnly) return;
    const center = viewportCenter();
    const offset = documentRef.current.cards.length % 5;
    const card: CanvasCard = {
      id: createId("note"),
      type: "note",
      x: center.x - 150 + offset * 24,
      y: center.y - 100 + offset * 18,
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
    if (!snapshot || snapshot.updatedAt === documentRef.current.updatedAt) return;
    pushUndo(snapshot);
    redoStackRef.current = [];
    setHistoryRevision((value) => value + 1);
  }

  function selectCard(event: ReactPointerEvent, cardId: string) {
    if (connectSourceId && connectSourceId !== cardId) {
      createConnection(connectSourceId, cardId);
      return;
    }
    setSelectedConnectionId(null);
    setSelectedGroupId(null);
    setSelectedCardIds((current) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        return current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId];
      }
      return current.includes(cardId) ? current : [cardId];
    });
  }

  function beginCardDrag(event: ReactPointerEvent<HTMLDivElement>, cardId: string) {
    if (readOnly || event.button !== 0) return;
    event.stopPropagation();
    selectCard(event, cardId);
    if (connectSourceId && connectSourceId !== cardId) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const selected = selectedCardIds.includes(cardId) ? selectedCardIds : [cardId];
    const current = documentRef.current;
    dragRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startDocument: current,
      cardPositions: new Map(
        current.cards
          .filter((card) => selected.includes(card.id))
          .map((card) => [card.id, { x: card.x, y: card.y }])
      ),
      moved: false
    };
  }

  function moveCards(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const viewport = drag.startDocument.viewport;
    const dx = (event.clientX - drag.startClientX) / viewport.scale;
    const dy = (event.clientY - drag.startClientY) / viewport.scale;
    if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;
    const current = documentRef.current;
    publish({
      ...current,
      cards: current.cards.map((card) => {
        const start = drag.cardPositions.get(card.id);
        return start ? { ...card, x: start.x + dx, y: start.y + dy } : card;
      })
    });
  }

  function finishDrag() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.moved) return;
    pushUndo(drag.startDocument);
    redoStackRef.current = [];
    setHistoryRevision((value) => value + 1);
  }

  function beginGroupDrag(event: ReactPointerEvent<HTMLDivElement>, group: CanvasGroup) {
    if (readOnly || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedGroupId(group.id);
    setSelectedCardIds([]);
    setSelectedConnectionId(null);
    const current = documentRef.current;
    dragRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startDocument: current,
      groupId: group.id,
      groupPosition: { x: group.x, y: group.y },
      cardPositions: new Map(
        current.cards
          .filter((card) => group.cardIds.includes(card.id))
          .map((card) => [card.id, { x: card.x, y: card.y }])
      ),
      moved: false
    };
  }

  function moveGroup(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag?.groupId || !drag.groupPosition) return;
    const scale = drag.startDocument.viewport.scale;
    const dx = (event.clientX - drag.startClientX) / scale;
    const dy = (event.clientY - drag.startClientY) / scale;
    if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;
    const current = documentRef.current;
    publish({
      ...current,
      groups: current.groups.map((group) => (
        group.id === drag.groupId
          ? { ...group, x: drag.groupPosition!.x + dx, y: drag.groupPosition!.y + dy }
          : group
      )),
      cards: current.cards.map((card) => {
        const start = drag.cardPositions.get(card.id);
        return start ? { ...card, x: start.x + dx, y: start.y + dy } : card;
      })
    });
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
    const stage = stageRef.current;
    if (!stage) return;
    const items = [
      ...documentRef.current.cards.map((card) => ({ x: card.x, y: card.y, width: card.width, height: card.height })),
      ...documentRef.current.groups
    ];
    if (items.length === 0) {
      publish({ ...documentRef.current, viewport: { x: 0, y: 0, scale: 1 } });
      return;
    }
    const left = Math.min(...items.map((item) => item.x));
    const top = Math.min(...items.map((item) => item.y));
    const right = Math.max(...items.map((item) => item.x + item.width));
    const bottom = Math.max(...items.map((item) => item.y + item.height));
    const padding = 110;
    const scale = clamp(Math.min(
      (stage.clientWidth - padding * 2) / Math.max(1, right - left),
      (stage.clientHeight - padding * 2) / Math.max(1, bottom - top)
    ), MIN_SCALE, 1.3);
    publish({
      ...documentRef.current,
      viewport: {
        scale,
        x: (stage.clientWidth - (right - left) * scale) / 2 - left * scale,
        y: (stage.clientHeight - (bottom - top) * scale) / 2 - top * scale
      }
    });
  }

  function handleStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedCardIds([]);
    setSelectedConnectionId(null);
    setSelectedGroupId(null);
    setConnectSourceId(null);
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      viewport: documentRef.current.viewport
    };
  }

  function handleStagePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan) return;
    publish({
      ...documentRef.current,
      viewport: {
        ...pan.viewport,
        x: pan.viewport.x + event.clientX - pan.x,
        y: pan.viewport.y + event.clientY - pan.y
      }
    });
  }

  function handleStagePointerUp() {
    panRef.current = null;
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    const current = documentRef.current;
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const worldX = (pointerX - current.viewport.x) / current.viewport.scale;
    const worldY = (pointerY - current.viewport.y) / current.viewport.scale;
    const factor = Math.exp(-event.deltaY * 0.0012);
    const scale = clamp(current.viewport.scale * factor, MIN_SCALE, MAX_SCALE);
    publish({
      ...current,
      viewport: {
        scale,
        x: pointerX - worldX * scale,
        y: pointerY - worldY * scale
      }
    });
  }

  return (
    <section className="knowledge-canvas" aria-label={t("知识画布")}>
      <div className="canvas-toolbar">
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
              <button type="button" key={note.path} onClick={() => addNoteCard(note)}>
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

      <div
        ref={stageRef}
        className={`canvas-stage${panRef.current ? " is-panning" : ""}${connectSourceId ? " is-connecting" : ""}`}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerUp}
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) addTextCard();
        }}
        onWheel={handleWheel}
      >
        {document.cards.length === 0 ? (
          <div className="canvas-empty-state">
            <BoxSelect size={28} />
            <strong>{t("从卡片开始组织知识")}</strong>
            <span>{t("添加文本、表格或真实笔记，再用有意义的连线表达关系。")}</span>
          </div>
        ) : null}
        <div
          className="canvas-world"
          style={{
            transform: `translate3d(${document.viewport.x}px, ${document.viewport.y}px, 0) scale(${document.viewport.scale})`
          }}
        >
          <svg className="canvas-connections" aria-hidden="true">
            <defs>
              <marker id="canvas-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" />
              </marker>
            </defs>
            {document.connections.map((connection) => {
              const source = document.cards.find((card) => card.id === connection.sourceId);
              const target = document.cards.find((card) => card.id === connection.targetId);
              if (!source || !target) return null;
              const line = connectionLine(source, target);
              const selected = selectedConnectionId === connection.id;
              return (
                <g
                  key={connection.id}
                  className={`canvas-connection is-${connection.relationship}${selected ? " is-selected" : ""}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectedConnectionId(connection.id);
                    setSelectedCardIds([]);
                    setSelectedGroupId(null);
                  }}
                >
                  <path className="canvas-connection-hit" d={line.path} />
                  <path className="canvas-connection-line" d={line.path} markerEnd="url(#canvas-arrow)" />
                  <g transform={`translate(${line.labelX} ${line.labelY})`}>
                    <rect x={-42} y={-11} width={84} height={22} rx={5} />
                    <text textAnchor="middle" dominantBaseline="central">{connection.label || RELATIONSHIP_LABELS[connection.relationship]}</text>
                  </g>
                </g>
              );
            })}
          </svg>

          {document.groups.map((group) => (
            <div
              key={group.id}
              className={`canvas-group${selectedGroupId === group.id ? " is-selected" : ""}`}
              style={{ left: group.x, top: group.y, width: group.width, height: group.height }}
              onPointerDown={(event) => {
                event.stopPropagation();
                setSelectedGroupId(group.id);
                setSelectedCardIds([]);
                setSelectedConnectionId(null);
              }}
            >
              <div
                className="canvas-group-header"
                onPointerDown={(event) => beginGroupDrag(event, group)}
                onPointerMove={moveGroup}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
              >
                <Group size={14} />
                <input
                  value={group.title}
                  disabled={readOnly}
                  onFocus={beginEdit}
                  onBlur={finishEdit}
                  onChange={(event) => {
                    const current = documentRef.current;
                    publish({
                      ...current,
                      groups: current.groups.map((item) => (
                        item.id === group.id ? { ...item, title: event.target.value } : item
                      ))
                    });
                  }}
                  aria-label={t("分组名称")}
                />
              </div>
            </div>
          ))}

          {document.cards.map((card) => {
            const selected = selectedCardIds.includes(card.id);
            const note = card.notePath ? notesByPath.get(card.notePath) : undefined;
            return (
              <article
                key={card.id}
                className={`canvas-card canvas-card-${card.type}${selected ? " is-selected" : ""}${connectSourceId === card.id ? " is-link-source" : ""}`}
                style={{ left: card.x, top: card.y, width: card.width, height: card.height }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  selectCard(event, card.id);
                }}
              >
                <div
                  className="canvas-card-header"
                  onPointerDown={(event) => beginCardDrag(event, card.id)}
                  onPointerMove={moveCards}
                  onPointerUp={finishDrag}
                  onPointerCancel={finishDrag}
                >
                  {card.type === "text" ? <Type size={14} /> : card.type === "table" ? <Table2 size={14} /> : <FileText size={14} />}
                  <input
                    value={card.type === "note" && note ? note.title : card.title}
                    disabled={readOnly || card.type === "note"}
                    onPointerDown={(event) => event.stopPropagation()}
                    onFocus={beginEdit}
                    onBlur={finishEdit}
                    onChange={(event) => updateCard(card.id, (current) => ({ ...current, title: event.target.value }))}
                    aria-label={t("卡片标题")}
                  />
                  <button
                    type="button"
                    className={connectSourceId === card.id ? "is-active" : ""}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setConnectSourceId((current) => current === card.id ? null : card.id);
                    }}
                    disabled={readOnly}
                    title={t("从此卡片建立连线")}
                  >
                    <Link2 size={14} />
                  </button>
                </div>

                {card.type === "text" ? (
                  <textarea
                    value={card.text ?? ""}
                    disabled={readOnly}
                    onPointerDown={(event) => event.stopPropagation()}
                    onFocus={beginEdit}
                    onBlur={finishEdit}
                    onChange={(event) => updateCard(card.id, (current) => ({ ...current, text: event.target.value }))}
                    placeholder={t("写下观点、问题或结论…")}
                  />
                ) : null}

                {card.type === "note" ? (
                  <button
                    type="button"
                    className="canvas-note-card-body"
                    onPointerDown={(event) => event.stopPropagation()}
                    onDoubleClick={() => card.notePath && onOpenNote(card.notePath)}
                  >
                    <p>{note ? noteExcerpt(note.content) : t("原笔记已不存在")}</p>
                    <div>
                      {(note?.tags ?? []).slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}
                    </div>
                    <small>{card.notePath}</small>
                  </button>
                ) : null}

                {card.type === "table" ? (
                  <CanvasTableEditor
                    card={card}
                    readOnly={readOnly}
                    onFocus={beginEdit}
                    onBlur={finishEdit}
                    onChange={(table) => updateCard(card.id, (current) => ({ ...current, table }))}
                    onCommit={(table) => updateCard(card.id, (current) => ({ ...current, table }), true)}
                  />
                ) : null}

                <button
                  type="button"
                  className="canvas-card-resize"
                  disabled={readOnly}
                  aria-label={t("调整卡片大小")}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    const startX = event.clientX;
                    const startY = event.clientY;
                    const startWidth = card.width;
                    const startHeight = card.height;
                    const snapshot = documentRef.current;
                    const target = event.currentTarget;
                    target.setPointerCapture(event.pointerId);
                    const move = (moveEvent: PointerEvent) => {
                      const scale = documentRef.current.viewport.scale;
                      updateCard(card.id, (current) => ({
                        ...current,
                        width: Math.max(CARD_MIN_WIDTH, startWidth + (moveEvent.clientX - startX) / scale),
                        height: Math.max(CARD_MIN_HEIGHT, startHeight + (moveEvent.clientY - startY) / scale)
                      }));
                    };
                    const finish = () => {
                      target.removeEventListener("pointermove", move);
                      target.removeEventListener("pointerup", finish);
                      target.removeEventListener("pointercancel", finish);
                      pushUndo(snapshot);
                      redoStackRef.current = [];
                      setHistoryRevision((value) => value + 1);
                    };
                    target.addEventListener("pointermove", move);
                    target.addEventListener("pointerup", finish);
                    target.addEventListener("pointercancel", finish);
                  }}
                />
              </article>
            );
          })}
        </div>
      </div>

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
    <div className="canvas-table-wrap" onPointerDown={(event) => event.stopPropagation()}>
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

function connectionLine(source: CanvasCard, target: CanvasCard) {
  const sourceX = source.x + source.width / 2;
  const sourceY = source.y + source.height / 2;
  const targetX = target.x + target.width / 2;
  const targetY = target.y + target.height / 2;
  const curve = Math.max(42, Math.abs(targetX - sourceX) * 0.32);
  return {
    path: `M ${sourceX} ${sourceY} C ${sourceX + curve} ${sourceY}, ${targetX - curve} ${targetY}, ${targetX} ${targetY}`,
    labelX: (sourceX + targetX) / 2,
    labelY: (sourceY + targetY) / 2
  };
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
