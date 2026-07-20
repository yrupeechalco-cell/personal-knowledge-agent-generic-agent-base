import type { KnowledgeTagKind, VaultIndex } from "@knowledge-agent/core";
import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useLocalization } from "@knowledge-agent/ui";
import {
  buildTagKnowledgeModel,
  buildTagRootDomain,
  domainNodeWeight,
  globalNodeScale,
  relationLineOpacity,
  type KnowledgeViewDomain,
  type TagKnowledgeModel,
  type TagKnowledgeNode
} from "./tagKnowledgeModel";
import { buildKnowledgeRoleModel } from "./knowledgeRoleModel";
import { DomainRootMap } from "./KnowledgeRoleMap";

interface TagKnowledgeMapProps {
  index: VaultIndex;
  onSelectNote(path: string): void;
}

interface VisualNode {
  root: THREE.Group;
  wash: THREE.Sprite;
  rim: THREE.Sprite;
  core: THREE.Sprite;
  target: THREE.Vector3;
  targetScale: number;
  emphasis: number;
  targetEmphasis: number;
  label: HTMLDivElement;
}

interface VisualRelation {
  source: string;
  target: string;
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  baseColor: number;
  baseOpacity: number;
}

interface SceneState {
  nodes: Map<string, VisualNode>;
  applyDomain(domain: KnowledgeViewDomain): void;
}

const DOMAIN_OPTIONS: Array<{ value: KnowledgeViewDomain; label: string }> = [
  { value: "classification", label: "分类域" },
  { value: "context", label: "脉络域" },
  { value: "application", label: "应用域" },
  { value: "source", label: "来源域" }
];

const TAG_COLORS: Record<KnowledgeTagKind, number> = {
  concept: 0x9074d2,
  method: 0x65a899,
  entity: 0xc47e60,
  evidence: 0x777a83
};

export function TagKnowledgeMap({ index, onSelectNote }: TagKnowledgeMapProps) {
  const { runtime, t } = useLocalization();
  const model = useMemo(() => buildTagKnowledgeModel(index), [index]);
  const roleModel = useMemo(() => buildKnowledgeRoleModel(index), [index]);
  const [domain, setDomain] = useState<KnowledgeViewDomain>("classification");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const sceneHostRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const sceneStateRef = useRef<SceneState | null>(null);
  const domainRef = useRef(domain);
  domainRef.current = domain;
  const selected = model.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedDomain = useMemo(() => selected ? buildTagRootDomain(selected, roleModel) : null, [roleModel, selected]);
  const hovered = model.nodes.find((node) => node.id === hoveredId) ?? null;

  useEffect(() => {
    sceneStateRef.current?.applyDomain(domain);
  }, [domain]);

  useEffect(() => {
    if (selectedId || !sceneHostRef.current || !labelLayerRef.current || model.nodes.length === 0) return;
    const host = sceneHostRef.current;
    const labelLayer = labelLayerRef.current;
    labelLayer.replaceChildren();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 180);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setClearColor(0x1e1e1e, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const radius = mapRadius(model.nodes.length);
    camera.position.set(radius * 0.62, radius * 0.32, radius * 3.15);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.46;
    controls.zoomSpeed = 0.64;
    controls.minDistance = Math.max(3.5, radius * 0.66);
    controls.maxDistance = radius * 5.6;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xd8d3ff, 0x171719, 1.35));
    const keyLight = new THREE.PointLight(0xffdac8, 17, 28);
    keyLight.position.set(6, 7, 8);
    scene.add(keyLight);
    const fillLight = new THREE.PointLight(0xa68cff, 11, 24);
    fillLight.position.set(-7, -3, 4);
    scene.add(fillLight);

    const group = new THREE.Group();
    scene.add(group);
    const washTexture = createWashTexture();
    const rimTexture = createRimTexture();
    const coreTexture = createCoreTexture();
    const visualNodes = new Map<string, VisualNode>();
    const modelNodesById = new Map(model.nodes.map((node) => [node.id, node]));
    const initialPositions = domainPositions(model, domain);
    let visibleLabelIds = rankedLabelIds(model, domain, host.clientWidth);

    for (const node of model.nodes) {
      const color = new THREE.Color(TAG_COLORS[node.kind]).multiplyScalar(0.6);
      const wash = new THREE.Sprite(new THREE.SpriteMaterial({ map: washTexture, color, transparent: true, opacity: 0.88, depthWrite: false }));
      const rim = new THREE.Sprite(new THREE.SpriteMaterial({
        map: rimTexture,
        color: new THREE.Color(TAG_COLORS[node.kind]).lerp(new THREE.Color(0xe5e1ea), 0.32),
        transparent: true,
        opacity: 0.43,
        depthWrite: false
      }));
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: coreTexture, color: 0xebe8f0, transparent: true, opacity: 0.8, depthWrite: false }));
      const root = new THREE.Group();
      root.position.copy(initialPositions.get(node.id) ?? new THREE.Vector3());
      root.userData = { id: node.id };
      wash.userData = { id: node.id };
      rim.userData = { id: node.id };
      core.userData = { id: node.id };
      rim.position.z = 0.004;
      core.position.z = 0.008;
      root.add(wash, rim, core);
      group.add(root);

      const label = document.createElement("div");
      label.className = `tag-knowledge-label kind-${node.kind}`;
      label.textContent = node.label;
      labelLayer.appendChild(label);
      const targetScale = globalNodeScale(node);
      const emphasis = domainNodeWeight(node, domain);
      const visual = { root, wash, rim, core, target: root.position.clone(), targetScale, emphasis, targetEmphasis: emphasis, label };
      setVisualNodeScale(visual, targetScale);
      visualNodes.set(node.id, visual);
    }

    const visualRelations: VisualRelation[] = [];
    for (const relation of model.relations) {
      const source = visualNodes.get(relation.source)?.root.position;
      const target = visualNodes.get(relation.target)?.root.position;
      if (!source || !target) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints([source, target]);
      const baseColor = relation.basis === "explicit-link" ? 0x615a72 : 0x454449;
      const baseOpacity = relationLineOpacity(relation.strength);
      const material = new THREE.LineBasicMaterial({
        color: baseColor,
        transparent: true,
        opacity: baseOpacity
      });
      const line = new THREE.Line(geometry, material);
      line.userData = { source: relation.source, target: relation.target };
      group.add(line);
      visualRelations.push({ source: relation.source, target: relation.target, line, baseColor, baseOpacity });
    }

    const related = new Map<string, Set<string>>();
    for (const node of model.nodes) related.set(node.id, new Set([node.id]));
    for (const relation of model.relations) {
      related.get(relation.source)?.add(relation.target);
      related.get(relation.target)?.add(relation.source);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let focusedId: string | null = null;
    let pointerStart = { x: 0, y: 0 };
    let cameraWasAdjusted = false;

    function nodeAt(clientX: number, clientY: number): string | null {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      pointer.y = -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const targets = [...visualNodes.values()].flatMap((node) => [node.wash, node.rim, node.core]);
      const hit = raycaster.intersectObjects(targets, false)[0];
      return (hit?.object.userData.id as string | undefined) ?? null;
    }

    function focus(nextId: string | null) {
      if (focusedId === nextId) return;
      focusedId = nextId;
      setHoveredId(nextId);
      renderer.domElement.style.cursor = nextId ? "pointer" : "grab";
      const connected = nextId ? related.get(nextId) ?? new Set([nextId]) : null;
      for (const [id, visual] of visualNodes) {
        const visible = !connected || connected.has(id);
        visual.label.classList.toggle("dimmed", !visible);
      }
      for (const relation of visualRelations) {
        const active = nextId && (relation.source === nextId || relation.target === nextId);
        relation.line.material.color.setHex(active ? 0x9873ef : relation.baseColor);
        relation.line.material.opacity = nextId ? (active ? 0.72 : 0.018) : relation.baseOpacity;
      }
    }

    function onPointerMove(event: PointerEvent) {
      focus(nodeAt(event.clientX, event.clientY));
    }

    function onPointerDown(event: PointerEvent) {
      pointerStart = { x: event.clientX, y: event.clientY };
    }

    function onPointerUp(event: PointerEvent) {
      const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5;
      if (!moved) {
        const nextId = nodeAt(event.clientX, event.clientY);
        if (nextId) {
          setHoveredId(null);
          setSelectedId(nextId);
        }
      }
    }

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", () => focus(null));
    controls.addEventListener("start", () => {
      cameraWasAdjusted = true;
    });

    function applyDomain(nextDomain: KnowledgeViewDomain) {
      const positions = domainPositions(model, nextDomain);
      visibleLabelIds = rankedLabelIds(model, nextDomain, host.clientWidth);
      for (const node of model.nodes) {
        const visual = visualNodes.get(node.id);
        if (!visual) continue;
        visual.target.copy(positions.get(node.id) ?? new THREE.Vector3());
        visual.targetScale = globalNodeScale(node);
        visual.targetEmphasis = domainNodeWeight(node, nextDomain);
      }
    }

    sceneStateRef.current = { nodes: visualNodes, applyDomain };

    function resize() {
      const rect = host.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
      const verticalFit = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov * 0.5));
      const narrowFit = camera.aspect < 1 ? 1 / Math.max(camera.aspect, 0.62) : 1;
      const fitDistance = verticalFit * 0.94 * narrowFit;
      if (!cameraWasAdjusted) camera.position.set(radius * 0.62, radius * 0.32, fitDistance);
      visibleLabelIds = rankedLabelIds(model, domainRef.current, rect.width);
      camera.updateProjectionMatrix();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const projected = new THREE.Vector3();
    const cameraSpacePosition = new THREE.Vector3();
    const cameraSpaceTarget = new THREE.Vector3();
    let frame = 0;
    function animate() {
      frame = requestAnimationFrame(animate);
      controls.update();
      camera.updateMatrixWorld();
      cameraSpaceTarget.copy(controls.target).applyMatrix4(camera.matrixWorldInverse);
      const referenceDepth = Math.max(0.1, Math.abs(cameraSpaceTarget.z));
      const connected = focusedId ? related.get(focusedId) ?? new Set([focusedId]) : null;
      for (const [id, visual] of visualNodes) {
        visual.root.position.lerp(visual.target, 0.075);
        cameraSpacePosition.copy(visual.root.position).applyMatrix4(camera.matrixWorldInverse);
        const depthCompensation = THREE.MathUtils.clamp(Math.abs(cameraSpacePosition.z) / referenceDepth, 0.68, 1.46);
        const screenStableScale = visual.targetScale * depthCompensation;
        const nextScale = THREE.MathUtils.lerp(visual.root.scale.x, screenStableScale, 0.08);
        visual.root.scale.setScalar(nextScale);
        visual.emphasis = THREE.MathUtils.lerp(visual.emphasis, visual.targetEmphasis, 0.085);
        const active = id === focusedId;
        const visible = !connected || connected.has(id);
        const washOpacity = 0.42 + visual.emphasis * 0.42;
        const rimOpacity = 0.18 + visual.emphasis * 0.38;
        const coreOpacity = 0.62 + modelNodesById.get(id)!.weight * 0.22;
        visual.wash.material.opacity = THREE.MathUtils.lerp(visual.wash.material.opacity, visible ? (active ? 1 : washOpacity) : 0.05, 0.16);
        visual.rim.material.opacity = THREE.MathUtils.lerp(visual.rim.material.opacity, visible ? (active ? 0.8 : rimOpacity) : 0.04, 0.16);
        visual.core.material.opacity = THREE.MathUtils.lerp(visual.core.material.opacity, visible ? (active ? 0.94 : coreOpacity) : 0.06, 0.16);
      }
      for (const relation of visualRelations) {
        const source = visualNodes.get(relation.source)?.root.position;
        const target = visualNodes.get(relation.target)?.root.position;
        if (!source || !target) continue;
        const positions = relation.line.geometry.attributes.position as THREE.BufferAttribute;
        positions.setXYZ(0, source.x, source.y, source.z);
        positions.setXYZ(1, target.x, target.y, target.z);
        positions.needsUpdate = true;
      }
      renderer.render(scene, camera);
      const rect = renderer.domElement.getBoundingClientRect();
      for (const [id, visual] of visualNodes) {
        projected.copy(visual.root.position).project(camera);
        const visible = projected.z < 1 && (focusedId === id || visibleLabelIds.has(id));
        visual.label.style.transform = `translate(-50%, -50%) translate(${(projected.x * 0.5 + 0.5) * rect.width}px, ${(-projected.y * 0.5 + 0.5) * rect.height}px)`;
        visual.label.style.opacity = visible ? "1" : "0";
      }
    }
    animate();

    return () => {
      sceneStateRef.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      scene.traverse((object) => {
        if (object instanceof THREE.Line) {
          object.geometry.dispose();
          object.material.dispose();
        } else if (object instanceof THREE.Sprite) {
          object.material.dispose();
        }
      });
      washTexture.dispose();
      rimTexture.dispose();
      coreTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labelLayer.replaceChildren();
    };
  }, [model, selectedId]);

  if (model.nodes.length === 0) {
    return (
      <section className="tag-knowledge-map empty">
        <Sparkles size={18} />
        <strong>{t("标签知识图谱尚未形成")}</strong>
        <span>{t("先为资料添加标签，或在笔记中使用 Agent 拆解。")}</span>
      </section>
    );
  }

  if (selectedDomain) {
    return (
      <DomainRootMap
        domain={selectedDomain}
        model={roleModel}
        onBack={() => setSelectedId(null)}
        onSelectNote={onSelectNote}
      />
    );
  }

  return (
    <section className="tag-knowledge-map" aria-label={t("标签知识图谱")}>
      <div className="tag-knowledge-scene" ref={sceneHostRef} />
      <div className="tag-knowledge-label-layer" ref={labelLayerRef} />
      <header className="tag-knowledge-heading">
        <span><Sparkles size={13} /> {t("标签知识图谱")}</span>
        <strong>{t(domainHeading(domain))}</strong>
        <small>{runtime(`${model.nodes.length} 个标签 · ${model.relations.length} 条本地关系 · ${model.sourceCount} 个来源`)}</small>
      </header>
      <div className="knowledge-domain-switch" aria-label={t("知识观察域")} role="tablist">
        {DOMAIN_OPTIONS.map((option) => (
          <button
            aria-selected={domain === option.value}
            className={domain === option.value ? "active" : ""}
            key={option.value}
            onClick={() => setDomain(option.value)}
            role="tab"
            type="button"
          >
            {t(option.label)}
          </button>
        ))}
      </div>
      <div className="tag-knowledge-legend">
        <span><i className="concept" />{t("概念")}</span>
        <span><i className="method" />{t("方法")}</span>
        <span><i className="entity" />{t("对象")}</span>
        <span><i className="evidence" />{t("证据")}</span>
      </div>
      {hovered ? (
        <TagHoverInsight node={hovered} />
      ) : null}
    </section>
  );
}

function TagHoverInsight({ node }: { node: TagKnowledgeNode }) {
  const { runtime, t } = useLocalization();
  return (
    <aside className="tag-knowledge-insight hover">
      <span>{t(tagKindLabel(node.kind))}</span>
      <strong>{node.label}</strong>
      <small>{runtime(`${node.documentPaths.length} 篇资料 · ${node.dominantSource}`)}</small>
    </aside>
  );
}

function domainHeading(domain: KnowledgeViewDomain): string {
  return ({
    classification: "知识分类",
    context: "知识脉络",
    application: "应用视角",
    source: "来源分布"
  } as Record<KnowledgeViewDomain, string>)[domain];
}

function tagKindLabel(kind: KnowledgeTagKind): string {
  return ({ concept: "概念", method: "方法", entity: "对象", evidence: "证据" } as Record<KnowledgeTagKind, string>)[kind];
}

function rankedLabelIds(model: TagKnowledgeModel, domain: KnowledgeViewDomain, width: number): Set<string> {
  const count = Math.min(model.nodes.length, Math.max(12, Math.min(28, Math.round(width / 34))));
  return new Set(
    [...model.nodes]
      .sort((left, right) => domainNodeWeight(right, domain) - domainNodeWeight(left, domain))
      .slice(0, count)
      .map((node) => node.id)
  );
}

function setVisualNodeScale(node: VisualNode, scale: number) {
  node.root.scale.setScalar(scale);
  node.wash.scale.setScalar(0.78);
  node.rim.scale.setScalar(0.72);
  node.core.scale.setScalar(0.065);
}

function domainPositions(model: TagKnowledgeModel, domain: KnowledgeViewDomain): Map<string, THREE.Vector3> {
  if (domain === "context") return forcePositions(model);
  if (domain === "application") return applicationPositions(model);
  const groupFor = domain === "source" ? (node: TagKnowledgeNode) => node.dominantSource : (node: TagKnowledgeNode) => node.kind;
  return groupedPositions(model.nodes, groupFor);
}

function groupedPositions(nodes: TagKnowledgeNode[], groupFor: (node: TagKnowledgeNode) => string): Map<string, THREE.Vector3> {
  const groups = new Map<string, TagKnowledgeNode[]>();
  for (const node of nodes) groups.set(groupFor(node), [...(groups.get(groupFor(node)) ?? []), node]);
  const centers = sphereDirections(groups.size);
  const radius = mapRadius(nodes.length);
  const result = new Map<string, THREE.Vector3>();
  [...groups.entries()].forEach(([key, group], groupIndex) => {
    const center = centers[groupIndex].clone().multiplyScalar(groups.size === 1 ? 0 : radius * 0.72);
    const local = sphereDirections(group.length, hashString(key));
    const localRadius = Math.max(1.05, Math.sqrt(group.length) * 0.5);
    group.forEach((node, index) => result.set(node.id, center.clone().add(local[index].clone().multiplyScalar(localRadius))));
  });
  return normalizePositions(result, radius * 1.08);
}

function applicationPositions(model: TagKnowledgeModel): Map<string, THREE.Vector3> {
  const radius = mapRadius(model.nodes.length);
  const directions = sphereDirections(model.nodes.length, 23);
  const result = new Map<string, THREE.Vector3>();
  model.nodes.forEach((node, index) => {
    const distance = radius * (0.38 + (1 - node.application) * 0.72);
    const position = directions[index].clone().multiplyScalar(distance);
    position.x += (node.application - 0.5) * radius * 0.62;
    result.set(node.id, position);
  });
  return result;
}

function forcePositions(model: TagKnowledgeModel): Map<string, THREE.Vector3> {
  const radius = mapRadius(model.nodes.length);
  const directions = sphereDirections(model.nodes.length, 41);
  const positions = new Map(model.nodes.map((node, index) => [node.id, directions[index].clone().multiplyScalar(radius * 0.78)]));
  const velocity = new Map(model.nodes.map((node) => [node.id, new THREE.Vector3()]));
  for (let iteration = 0; iteration < 96; iteration += 1) {
    for (let index = 0; index < model.nodes.length; index += 1) {
      const source = model.nodes[index];
      const sourcePosition = positions.get(source.id)!;
      const sourceVelocity = velocity.get(source.id)!;
      for (let targetIndex = index + 1; targetIndex < model.nodes.length; targetIndex += 1) {
        const target = model.nodes[targetIndex];
        const targetPosition = positions.get(target.id)!;
        const delta = sourcePosition.clone().sub(targetPosition);
        const distanceSq = Math.max(0.2, delta.lengthSq());
        const force = delta.normalize().multiplyScalar(0.13 / distanceSq);
        sourceVelocity.add(force);
        velocity.get(target.id)!.sub(force);
      }
    }
    for (const relation of model.relations) {
      const source = positions.get(relation.source);
      const target = positions.get(relation.target);
      if (!source || !target) continue;
      const delta = target.clone().sub(source);
      const force = delta.multiplyScalar((0.00055 + relation.strength * 0.00135) * Math.max(0.18, delta.length() - 2.2));
      velocity.get(relation.source)!.add(force);
      velocity.get(relation.target)!.sub(force);
    }
    for (const node of model.nodes) {
      const current = positions.get(node.id)!;
      const nextVelocity = velocity.get(node.id)!.multiplyScalar(0.79);
      current.add(nextVelocity).multiplyScalar(0.999);
    }
  }
  return normalizePositionsByAxis(positions, radius * 0.82);
}

function normalizePositions(positions: Map<string, THREE.Vector3>, radius: number): Map<string, THREE.Vector3> {
  const center = new THREE.Vector3();
  for (const position of positions.values()) center.add(position);
  center.multiplyScalar(1 / Math.max(1, positions.size));
  let maxDistance = 1;
  for (const position of positions.values()) {
    position.sub(center);
    maxDistance = Math.max(maxDistance, position.length());
  }
  for (const position of positions.values()) position.multiplyScalar(radius / maxDistance);
  return positions;
}

function normalizePositionsByAxis(positions: Map<string, THREE.Vector3>, axisRadius: number): Map<string, THREE.Vector3> {
  const center = new THREE.Vector3();
  for (const position of positions.values()) center.add(position);
  center.multiplyScalar(1 / Math.max(1, positions.size));
  const extent = new THREE.Vector3(0.001, 0.001, 0.001);
  for (const position of positions.values()) {
    position.sub(center);
    extent.x = Math.max(extent.x, Math.abs(position.x));
    extent.y = Math.max(extent.y, Math.abs(position.y));
    extent.z = Math.max(extent.z, Math.abs(position.z));
  }
  for (const position of positions.values()) {
    position.set(
      (position.x / extent.x) * axisRadius,
      (position.y / extent.y) * axisRadius,
      (position.z / extent.z) * axisRadius
    );
  }
  return positions;
}

function sphereDirections(count: number, seed = 0): THREE.Vector3[] {
  if (count <= 0) return [];
  const points: THREE.Vector3[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const y = count === 1 ? 0 : 1 - ((index + 0.5) / count) * 2;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = (index + seed * 0.017) * goldenAngle + 0.47;
    points.push(new THREE.Vector3(Math.cos(angle) * radial, y, Math.sin(angle) * radial));
  }
  return points;
}

function mapRadius(count: number): number {
  return Math.max(2.8, Math.min(7.8, 2.2 + Math.cbrt(Math.max(1, count)) * 1.15));
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash % 997;
}

function createWashTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(76, 72, 4, 80, 80, 72);
    gradient.addColorStop(0, "rgba(255,255,255,0.78)");
    gradient.addColorStop(0.38, "rgba(255,255,255,0.47)");
    gradient.addColorStop(0.76, "rgba(255,255,255,0.13)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 160, 160);
  }
  return canvasTexture(canvas);
}

function createRimTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(80, 80, 48, 80, 80, 72);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(0.72, "rgba(255,255,255,0.18)");
    gradient.addColorStop(0.88, "rgba(255,255,255,0.72)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 160, 160);
  }
  return canvasTexture(canvas);
}

function createCoreTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(22, 19, 1, 24, 24, 20);
    gradient.addColorStop(0, "rgba(255,255,255,0.94)");
    gradient.addColorStop(0.45, "rgba(255,255,255,0.7)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 48, 48);
  }
  return canvasTexture(canvas);
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
