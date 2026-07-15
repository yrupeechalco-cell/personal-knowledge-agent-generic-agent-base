import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Orbit, Sparkles } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { VaultIndex } from "@knowledge-agent/core";
import {
  buildKnowledgeRoleModel,
  type KnowledgeContribution,
  type KnowledgeDomain,
  type KnowledgeDomainKind,
  type KnowledgeNoteRole,
  type KnowledgeRoleModel
} from "./knowledgeRoleModel";

interface KnowledgeRoleMapProps {
  index: VaultIndex;
  onSelectNote(path: string): void;
}

const DOMAIN_COLORS: Record<KnowledgeDomainKind, number> = {
  project: 0xc97857,
  topic: 0x8e78d8,
  method: 0x62a294,
  archive: 0x74767d
};

const ROLE_LABELS: Record<KnowledgeNoteRole, string> = {
  question: "问题",
  evidence: "证据",
  decision: "决策",
  output: "成果",
  reference: "背景"
};

const ROLE_ORDER: KnowledgeNoteRole[] = ["question", "evidence", "decision", "output", "reference"];

interface InkDomainNode {
  root: THREE.Group;
  wash: THREE.Sprite;
  rim: THREE.Sprite;
  core: THREE.Sprite;
}

export function KnowledgeRoleMap({ index, onSelectNote }: KnowledgeRoleMapProps) {
  const model = useMemo(() => buildKnowledgeRoleModel(index), [index]);
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const selectedDomain = model.domains.find((domain) => domain.id === selectedDomainId);

  useEffect(() => {
    if (selectedDomainId && !model.domains.some((domain) => domain.id === selectedDomainId)) {
      setSelectedDomainId(null);
    }
  }, [model.domains, selectedDomainId]);

  if (model.domains.length === 0) {
    return (
      <div className="knowledge-empty">
        <Orbit size={28} />
        <strong>知识地形尚未形成</strong>
        <span>当前知识库没有可分析的 Markdown 文档。</span>
      </div>
    );
  }

  if (selectedDomain) {
    return (
      <DomainRootMap
        domain={selectedDomain}
        model={model}
        onBack={() => setSelectedDomainId(null)}
        onSelectNote={onSelectNote}
      />
    );
  }

  return <MacroKnowledgeTerrain model={model} onSelectDomain={setSelectedDomainId} />;
}

function MacroKnowledgeTerrain({ model, onSelectDomain }: { model: KnowledgeRoleModel; onSelectDomain(id: string): void }) {
  const sceneHostRef = useRef<HTMLDivElement | null>(null);
  const labelLayerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredDomainId, setHoveredDomainId] = useState<string | null>(null);
  const hoveredDomain = model.domains.find((domain) => domain.id === hoveredDomainId);

  useEffect(() => {
    const host = sceneHostRef.current;
    const labelLayer = labelLayerRef.current;
    if (!host || !labelLayer) return;
    const measuredHost = host;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x1e1e1e, 0.045);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    const terrainRadius = domainTerrainRadius(model.domains.length);
    camera.position.set(0, terrainRadius * 0.16, terrainRadius * 3.15);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setClearColor(0x1e1e1e, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    measuredHost.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.48;
    controls.zoomSpeed = 0.66;
    controls.minDistance = Math.max(3.4, terrainRadius * 0.72);
    controls.maxDistance = terrainRadius * 5.4;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xd8d3ff, 0x171719, 1.4));
    const keyLight = new THREE.PointLight(0xffd7c5, 18, 24);
    keyLight.position.set(4, 5, 5);
    scene.add(keyLight);
    const fillLight = new THREE.PointLight(0xa68cff, 12, 20);
    fillLight.position.set(-5, -2, 3);
    scene.add(fillLight);

    const group = new THREE.Group();
    scene.add(group);
    const positions = domainPositions(model.domains);
    const inkTexture = createInkWashTexture();
    const rimTexture = createInkRimTexture();
    const coreTexture = createInkCoreTexture();
    const nodes = new Map<string, InkDomainNode>();
    const labels = new Map<string, HTMLDivElement>();
    const related = new Map<string, Set<string>>();

    for (const domain of model.domains) related.set(domain.id, new Set([domain.id]));
    for (const relation of model.domainRelations) {
      related.get(relation.source)?.add(relation.target);
      related.get(relation.target)?.add(relation.source);
    }

    for (const relation of model.domainRelations) {
      const source = positions.get(relation.source);
      const target = positions.get(relation.target);
      if (!source || !target) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints([source, target]);
      const material = new THREE.LineBasicMaterial({
        color: 0x57545e,
        transparent: true,
        opacity: 0.2 + relation.strength * 0.24
      });
      const line = new THREE.Line(geometry, material);
      line.userData = { source: relation.source, target: relation.target };
      group.add(line);
    }

    for (const domain of model.domains) {
      const baseScale = 0.76 + domain.importance * 0.58;
      const washColor = new THREE.Color(DOMAIN_COLORS[domain.kind]).multiplyScalar(0.58);
      const washMaterial = new THREE.SpriteMaterial({
        map: inkTexture,
        color: washColor,
        transparent: true,
        opacity: 0.9,
        depthWrite: false
      });
      const coreMaterial = new THREE.SpriteMaterial({
        map: coreTexture,
        color: 0xe8e4ee,
        transparent: true,
        opacity: 0.86,
        depthWrite: false
      });
      const rimMaterial = new THREE.SpriteMaterial({
        map: rimTexture,
        color: new THREE.Color(DOMAIN_COLORS[domain.kind]).lerp(new THREE.Color(0xe6e2ea), 0.34),
        transparent: true,
        opacity: 0.4,
        depthWrite: false
      });
      const wash = new THREE.Sprite(washMaterial);
      wash.scale.setScalar(baseScale);
      wash.userData = { id: domain.id };
      const rim = new THREE.Sprite(rimMaterial);
      rim.scale.setScalar(baseScale * 0.9);
      rim.position.z = 0.004;
      rim.userData = { id: domain.id };
      const core = new THREE.Sprite(coreMaterial);
      core.scale.setScalar(0.044 + domain.importance * 0.022);
      core.position.z = 0.008;
      core.userData = { id: domain.id };
      const root = new THREE.Group();
      root.position.copy(positions.get(domain.id) ?? new THREE.Vector3());
      root.add(wash, rim, core);
      nodes.set(domain.id, { root, wash, rim, core });
      group.add(root);

      const label = document.createElement("div");
      label.className = "knowledge-domain-label";
      label.textContent = domain.label;
      labelLayer.appendChild(label);
      labels.set(domain.id, label);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoveredId: string | null = null;
    let pointerStart = { x: 0, y: 0 };

    function domainAt(clientX: number, clientY: number): string | null {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      pointer.y = -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hitTargets = [...nodes.values()].flatMap((node) => [node.wash, node.rim, node.core]);
      const hit = raycaster.intersectObjects(hitTargets, false)[0];
      return (hit?.object.userData.id as string | undefined) ?? null;
    }

    function applyFocus(nextId: string | null) {
      if (hoveredId === nextId) return;
      hoveredId = nextId;
      setHoveredDomainId(nextId);
      renderer.domElement.style.cursor = nextId ? "pointer" : "grab";
      const relatedIds = nextId ? related.get(nextId) ?? new Set([nextId]) : null;

      for (const [id, node] of nodes) {
        const active = id === nextId;
        const connected = !relatedIds || relatedIds.has(id);
        node.wash.material.opacity = connected ? (active ? 1 : 0.9) : 0.07;
        node.rim.material.opacity = connected ? (active ? 0.78 : 0.4) : 0.06;
        node.core.material.opacity = connected ? (active ? 0.94 : 0.68) : 0.1;
        node.root.scale.setScalar(active ? 1.16 : 1);
        const label = labels.get(id);
        if (label) label.classList.toggle("dimmed", !connected);
      }

      for (const child of group.children) {
        if (!(child instanceof THREE.Line)) continue;
        const material = child.material as THREE.LineBasicMaterial;
        const isActive = nextId && (child.userData.source === nextId || child.userData.target === nextId);
        material.color.setHex(isActive ? 0x9a79ff : 0x57545e);
        material.opacity = nextId ? (isActive ? 0.82 : 0.06) : 0.28;
      }
    }

    function onPointerMove(event: PointerEvent) {
      applyFocus(domainAt(event.clientX, event.clientY));
    }

    function onPointerDown(event: PointerEvent) {
      pointerStart = { x: event.clientX, y: event.clientY };
    }

    function onPointerUp(event: PointerEvent) {
      const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5;
      if (!moved) {
        const id = domainAt(event.clientX, event.clientY);
        if (id) onSelectDomain(id);
      }
    }

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", () => applyFocus(null));

    let cameraWasAdjusted = false;
    controls.addEventListener("start", () => {
      cameraWasAdjusted = true;
    });

    function resize() {
      const rect = measuredHost.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
      const verticalFit = terrainRadius / Math.sin(THREE.MathUtils.degToRad(camera.fov * 0.5));
      const narrowFit = camera.aspect < 1 ? 1 / Math.max(camera.aspect, 0.62) : 1;
      const fitDistance = verticalFit * 1.14 * narrowFit;
      if (!cameraWasAdjusted) {
        camera.position.set(0, terrainRadius * 0.16, fitDistance);
      } else {
        const currentDistance = camera.position.distanceTo(controls.target);
        if (currentDistance < fitDistance) {
          const viewDirection = camera.position.clone().sub(controls.target).normalize();
          camera.position.copy(controls.target).addScaledVector(viewDirection, fitDistance);
        }
      }
      camera.updateProjectionMatrix();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(measuredHost);
    resize();

    let frame = 0;
    const projected = new THREE.Vector3();
    function animate() {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
      const rect = renderer.domElement.getBoundingClientRect();
      for (const [id, node] of nodes) {
        projected.copy(node.root.position).project(camera);
        const label = labels.get(id);
        if (!label) continue;
        label.style.transform = `translate(-50%, -50%) translate(${(projected.x * 0.5 + 0.5) * rect.width}px, ${(-projected.y * 0.5 + 0.5) * rect.height}px)`;
        label.style.opacity = projected.z < 1 ? "1" : "0";
      }
    }
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        } else if (object instanceof THREE.Sprite) {
          object.material.dispose();
        }
      });
      inkTexture.dispose();
      rimTexture.dispose();
      coreTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labelLayer.replaceChildren();
    };
  }, [model, onSelectDomain]);

  return (
    <section className="knowledge-terrain" aria-label="宏观知识地形">
      <div className="knowledge-terrain-scene" ref={sceneHostRef} />
      <div className="knowledge-label-layer" ref={labelLayerRef} />
      <header className="knowledge-map-heading">
        <span><Sparkles size={13} /> 知识作用图谱</span>
        <strong>宏观知识地形</strong>
        <small>{model.domains.length} 个领域 · {model.domainRelations.length} 条跨域依据</small>
      </header>
      <div className="knowledge-legend" aria-label="知识领域类型">
        <span><i className="project" />项目</span>
        <span><i className="topic" />专题</span>
        <span><i className="method" />方法</span>
        <span><i className="archive" />资料</span>
      </div>
      {hoveredDomain ? <DomainInsight domain={hoveredDomain} /> : null}
    </section>
  );
}

function DomainRootMap({
  domain,
  model,
  onBack,
  onSelectNote
}: {
  domain: KnowledgeDomain;
  model: KnowledgeRoleModel;
  onBack(): void;
  onSelectNote(path: string): void;
}) {
  const contributions = domain.contributions.slice(0, 12);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const positions = useMemo(() => contributionPositions(contributions), [contributions]);
  const rolePositions = useMemo(() => roleNodePositions(contributions, positions), [contributions, positions]);
  const visiblePaths = useMemo(() => new Set(contributions.map((contribution) => contribution.path)), [contributions]);
  const relations = model.noteRelations.filter(
    (relation) => visiblePaths.has(relation.source) && visiblePaths.has(relation.target)
  );
  const hoveredContribution = contributions.find((contribution) => contribution.path === hoveredPath);
  const connectedPaths = useMemo(() => {
    if (!hoveredPath) return null;
    const connected = new Set([hoveredPath]);
    for (const relation of relations) {
      if (relation.source === hoveredPath) connected.add(relation.target);
      if (relation.target === hoveredPath) connected.add(relation.source);
    }
    return connected;
  }, [hoveredPath, relations]);

  return (
    <section className="knowledge-root-map" aria-label={`${domain.label} 知识根系`}>
      <header className="knowledge-root-heading">
        <button onClick={onBack} title="返回宏观知识地形" type="button"><ArrowLeft size={16} /></button>
        <div>
          <span>{domainKindLabel(domain.kind)} · 关系置信度 {Math.round(domain.confidence * 100)}%</span>
          <strong>{domain.label}</strong>
        </div>
        <div className="knowledge-root-score">
          <small>领域影响</small>
          <b>{Math.round(domain.importance * 100)}</b>
        </div>
      </header>

      <svg className="knowledge-root-canvas" viewBox="0 0 980 620" role="img" aria-label={`${domain.label} 的问题、证据、决策与成果根系`}>
        <g className="knowledge-root-trunk">
          {[...rolePositions.entries()].map(([role, position]) => (
            <path d={`M 126 310 C 210 310, 220 ${position.y}, ${position.x - 26} ${position.y}`} key={role} />
          ))}
        </g>

        <g className="knowledge-note-relations">
          {relations.map((relation) => {
            const source = positions.get(relation.source);
            const target = positions.get(relation.target);
            if (!source || !target) return null;
            const active = hoveredPath === relation.source || hoveredPath === relation.target;
            const dimmed = Boolean(hoveredPath && !active);
            return (
              <path
                className={`${relation.basis === "shared-tag" ? "candidate" : "explicit"}${active ? " active" : ""}${dimmed ? " dimmed" : ""}`}
                d={`M ${source.x} ${source.y} C ${(source.x + target.x) / 2} ${source.y}, ${(source.x + target.x) / 2} ${target.y}, ${target.x} ${target.y}`}
                key={`${relation.source}-${relation.target}`}
              />
            );
          })}
        </g>

        <g className="knowledge-role-branches">
          {[...rolePositions.entries()].map(([role, rolePosition]) => (
            <g key={role}>
              {contributions.filter((item) => item.role === role).map((item) => {
                const target = positions.get(item.path);
                if (!target) return null;
                return <path d={`M ${rolePosition.x + 18} ${rolePosition.y} C 430 ${rolePosition.y}, 480 ${target.y}, ${target.x - 13} ${target.y}`} key={item.path} />;
              })}
              <g className={`knowledge-role-node role-${role}`} transform={`translate(${rolePosition.x} ${rolePosition.y})`}>
                <circle r="18" />
                <text y="4">{ROLE_LABELS[role]}</text>
              </g>
            </g>
          ))}
        </g>

        <g className="knowledge-domain-root" transform="translate(126 310)">
          <circle r="48" />
          <circle className="root-ring" r="60" />
          <text y="-4">{trimLabel(domain.label, 10)}</text>
          <text className="root-count" y="16">{domain.notePaths.length} 篇</text>
        </g>

        <g className="knowledge-contribution-nodes">
          {contributions.map((contribution) => {
            const position = positions.get(contribution.path);
            if (!position) return null;
            const radius = 8 + contribution.score * 13;
            const dimmed = Boolean(connectedPaths && !connectedPaths.has(contribution.path));
            return (
              <g
                className={`knowledge-contribution role-${contribution.role}${hoveredPath === contribution.path ? " active" : ""}${dimmed ? " dimmed" : ""}`}
                key={contribution.path}
                onClick={() => onSelectNote(contribution.path)}
                onMouseEnter={() => setHoveredPath(contribution.path)}
                onMouseLeave={() => setHoveredPath(null)}
                role="button"
                tabIndex={0}
                transform={`translate(${position.x} ${position.y})`}
              >
                <circle className="knowledge-contribution-hit" r={Math.max(22, radius + 8)} />
                <circle className="knowledge-contribution-dot" r={radius} />
                <text y={radius + 18}>{trimLabel(contribution.title, 15)}</text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="knowledge-relation-key">
        <span><i className="solid" />原文双链</span>
        <span><i className="dashed" />待确认关联</span>
      </div>
      {hoveredContribution ? <ContributionInsight contribution={hoveredContribution} /> : null}
    </section>
  );
}

function DomainInsight({ domain }: { domain: KnowledgeDomain }) {
  const leading = domain.contributions[0];
  return (
    <aside className="knowledge-insight domain-insight">
      <span>{domainKindLabel(domain.kind)}</span>
      <strong>{domain.label}</strong>
      <p>{domain.notePaths.length} 篇文档 · 影响 {Math.round(domain.importance * 100)} · 依据置信度 {Math.round(domain.confidence * 100)}%</p>
      {leading ? <small>当前核心：{leading.title}</small> : null}
    </aside>
  );
}

function ContributionInsight({ contribution }: { contribution: KnowledgeContribution }) {
  return (
    <aside className="knowledge-insight contribution-insight">
      <span>{ROLE_LABELS[contribution.role]} · 相对贡献 {Math.round(contribution.score * 100)}</span>
      <strong>{contribution.title}</strong>
      <p>{contribution.explanation}</p>
      <div className="contribution-metrics">
        <Metric label="结构" value={contribution.structural} />
        <Metric label="项目" value={contribution.projectUse} />
        <Metric label="证据" value={contribution.evidence} />
        <Metric label="独特" value={contribution.uniqueness} />
      </div>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <span><i style={{ width: `${Math.max(4, value * 100)}%` }} />{label}</span>;
}

function domainPositions(domains: KnowledgeDomain[]): Map<string, THREE.Vector3> {
  const positions = new Map<string, THREE.Vector3>();
  const radius = domainTerrainRadius(domains.length);
  const directions = maximizeAngularDirections(domains.length);
  domains.forEach((domain, index) => {
    positions.set(domain.id, directions[index].clone().multiplyScalar(radius));
  });
  return positions;
}

function createInkWashTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  context.clearRect(0, 0, canvas.width, canvas.height);
  const layers = [
    { x: 80, y: 80, radius: 68, alpha: 0.58 },
    { x: 72, y: 75, radius: 51, alpha: 0.28 },
    { x: 89, y: 86, radius: 44, alpha: 0.2 },
    { x: 83, y: 68, radius: 32, alpha: 0.14 }
  ];

  for (const layer of layers) {
    const gradient = context.createRadialGradient(layer.x, layer.y, 0, layer.x, layer.y, layer.radius);
    gradient.addColorStop(0, `rgba(255,255,255,${layer.alpha})`);
    gradient.addColorStop(0.34, `rgba(255,255,255,${layer.alpha * 0.82})`);
    gradient.addColorStop(0.72, `rgba(255,255,255,${layer.alpha * 0.25})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createInkCoreTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  const gradient = context.createRadialGradient(24, 24, 0, 24, 24, 22);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.26, "rgba(255,255,255,1)");
  gradient.addColorStop(0.42, "rgba(255,255,255,0.72)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createInkRimTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  const gradient = context.createRadialGradient(80, 80, 57, 80, 80, 66);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.38, "rgba(255,255,255,0.18)");
  gradient.addColorStop(0.56, "rgba(255,255,255,0.82)");
  gradient.addColorStop(0.72, "rgba(255,255,255,0.24)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function domainTerrainRadius(count: number): number {
  return Math.min(7.2, 3.9 + Math.sqrt(Math.max(1, count)) * 0.42);
}

export function maximizeAngularDirections(count: number): THREE.Vector3[] {
  if (count <= 0) return [];
  const directions = regularSolidDirections(count) ?? fibonacciSphereDirections(count);

  if (count > 8) {
    for (let iteration = 0; iteration < 180; iteration += 1) {
      const step = 0.024 * (1 - iteration / 220);
      const next = directions.map((point, index) => {
        const force = new THREE.Vector3();
        for (let otherIndex = 0; otherIndex < directions.length; otherIndex += 1) {
          if (index === otherIndex) continue;
          const delta = point.clone().sub(directions[otherIndex]);
          const distanceSq = Math.max(delta.lengthSq(), 0.035);
          force.addScaledVector(delta, 1 / (distanceSq * Math.sqrt(distanceSq)));
        }
        force.addScaledVector(point, -force.dot(point));
        return point.clone().addScaledVector(force, step).normalize();
      });
      directions.splice(0, directions.length, ...next);
    }
  }

  const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.38, 0.56, 0.14));
  return directions.map((point) => point.applyQuaternion(orientation).normalize());
}

function fibonacciSphereDirections(count: number): THREE.Vector3[] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, index) => {
    const y = 1 - (2 * (index + 0.5)) / count;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = index * goldenAngle;
    return new THREE.Vector3(Math.cos(theta) * radial, y, Math.sin(theta) * radial);
  });
}

function regularSolidDirections(count: number): THREE.Vector3[] | null {
  if (count === 1) return [new THREE.Vector3(0, 0, 0)];
  if (count === 2) return [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0)];
  if (count === 3) return ringDirections(3);
  if (count === 4) {
    return normalizeDirections([
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1]
    ]);
  }
  if (count === 5) return [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), ...ringDirections(3)];
  if (count === 6) {
    return normalizeDirections([
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1]
    ]);
  }
  if (count === 7) return [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), ...ringDirections(5)];
  if (count === 8) {
    return normalizeDirections([
      [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
      [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]
    ]);
  }
  return null;
}

function ringDirections(count: number): THREE.Vector3[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  });
}

function normalizeDirections(values: Array<[number, number, number]>): THREE.Vector3[] {
  return values.map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());
}

function contributionPositions(contributions: KnowledgeContribution[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const columnSize = Math.max(1, Math.ceil(contributions.length / 2));
  contributions.forEach((contribution, index) => {
    const column = Math.floor(index / columnSize);
    const itemIndex = index % columnSize;
    const countInColumn = column === 0 ? Math.min(columnSize, contributions.length) : contributions.length - columnSize;
    const gap = countInColumn <= 1 ? 0 : Math.min(56, 470 / (countInColumn - 1));
    const startY = 310 - ((countInColumn - 1) * gap) / 2;
    positions.set(contribution.path, { x: column === 0 ? 650 : 850, y: startY + itemIndex * gap });
  });
  return positions;
}

function roleNodePositions(
  contributions: KnowledgeContribution[],
  positions: Map<string, { x: number; y: number }>
): Map<KnowledgeNoteRole, { x: number; y: number }> {
  const result = new Map<KnowledgeNoteRole, { x: number; y: number }>();
  for (const role of ROLE_ORDER) {
    const roleItems = contributions.filter((contribution) => contribution.role === role);
    if (roleItems.length === 0) continue;
    const averageY = roleItems.reduce((sum, item) => sum + (positions.get(item.path)?.y ?? 310), 0) / roleItems.length;
    result.set(role, { x: 320, y: averageY });
  }
  return result;
}

function domainKindLabel(kind: KnowledgeDomainKind): string {
  return { project: "项目", topic: "知识专题", method: "方法体系", archive: "资料集合" }[kind];
}

function trimLabel(label: string, maxLength: number): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}
