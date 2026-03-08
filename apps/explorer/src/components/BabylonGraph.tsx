import { useRef, useEffect } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Vector3, Color3, Color4 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ActionManager } from "@babylonjs/core/Actions/actionManager";
import { ExecuteCodeAction } from "@babylonjs/core/Actions/directActions";
import { Animation } from "@babylonjs/core/Animations/animation";
import { CubicEase, EasingFunction } from "@babylonjs/core/Animations/easing";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type {
  Organization,
  AgentCertificate,
  Task,
  PeerNode,
  GraphNode,
} from "../sui/types.ts";
import { NODE_COLORS } from "./utils.ts";
import { buildGraph } from "./graphUtils.ts";
import { layout3d } from "./layout3d.ts";

interface Props {
  organizations: Organization[];
  agents: AgentCertificate[];
  tasks: Task[];
  peers: PeerNode[];
  activeView: "org" | "tasks" | "peers";
  onNodeClick: (node: GraphNode) => void;
}

function hexToColor3(hex: string): Color3 {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new Color3(r, g, b);
}

function nodeRadius(type: GraphNode["type"], data: GraphNode["data"]): number {
  switch (type) {
    case "org": {
      const org = data as Organization;
      return Math.min(0.5 + (org.agent_count ?? 0) * 0.06, 0.9);
    }
    case "suborg":
      return 0.4;
    case "agent":
      return 0.35;
    case "task":
      return 0.25;
    case "peer":
      return 0.3;
    default:
      return 0.25;
  }
}

/** Shared cubic ease-out for all animations */
function makeEase(): CubicEase {
  const ease = new CubicEase();
  ease.setEasingMode(EasingFunction.EASINGMODE_EASEOUT);
  return ease;
}

const GRAPH_TAG = "isGraph";
const AUTO_ORBIT_SPEED = 0.001; // radians per frame
const IDLE_RESUME_MS = 3000; // resume auto-orbit after 3s idle

export default function BabylonGraph({
  organizations,
  agents,
  tasks,
  peers,
  activeView,
  onNodeClick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const guiRef = useRef<AdvancedDynamicTexture | null>(null);
  const autoOrbitRef = useRef(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entryDoneRef = useRef(false);
  const glowRef = useRef<GlowLayer | null>(null);
  const selectedMeshRef = useRef<Mesh | null>(null);

  // Mount engine/scene/camera/lights once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, { adaptToDeviceRatio: true });
    engineRef.current = engine;

    const scene = new Scene(engine);
    scene.clearColor = new Color4(3 / 255, 7 / 255, 18 / 255, 1); // #030712
    sceneRef.current = scene;

    const camera = new ArcRotateCamera(
      "camera",
      Math.PI / 4,
      Math.PI / 3,
      60, // start far for entry animation
      Vector3.Zero(),
      scene,
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 3;
    camera.upperRadiusLimit = 100;
    camera.wheelPrecision = 20;
    camera.panningSensibility = 100;

    new HemisphericLight("hemi", new Vector3(0, 1, 0.5), scene);

    // Point lights for depth
    const pl1 = new PointLight("pl1", new Vector3(10, 8, 10), scene);
    pl1.intensity = 0.6;
    pl1.diffuse = new Color3(0.6, 0.7, 1.0);

    const pl2 = new PointLight("pl2", new Vector3(-10, -5, -8), scene);
    pl2.intensity = 0.4;
    pl2.diffuse = new Color3(1.0, 0.6, 0.8);

    // GlowLayer for node emission
    const glow = new GlowLayer("glow", scene);
    glow.intensity = 0.6;
    glowRef.current = glow;

    // Rendering pipeline: bloom + FXAA
    const pipeline = new DefaultRenderingPipeline("pipeline", true, scene, [
      camera,
    ]);
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.3;
    pipeline.bloomWeight = 0.4;
    pipeline.bloomKernel = 64;
    pipeline.fxaaEnabled = true;

    const gui = AdvancedDynamicTexture.CreateFullscreenUI("UI", true, scene);
    guiRef.current = gui;

    // Auto-orbit: slowly rotate camera when idle
    scene.onBeforeRenderObservable.add(() => {
      if (autoOrbitRef.current) {
        camera.alpha += AUTO_ORBIT_SPEED;
      }
    });

    // Pause auto-orbit on user interaction, resume after idle
    const pauseOrbit = () => {
      autoOrbitRef.current = false;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        autoOrbitRef.current = true;
      }, IDLE_RESUME_MS);
    };

    canvas.addEventListener("pointerdown", pauseOrbit);
    canvas.addEventListener("wheel", pauseOrbit);

    engine.runRenderLoop(() => scene.render());

    const container = canvas.parentElement;
    let resizeObserver: ResizeObserver | undefined;
    if (container) {
      resizeObserver = new ResizeObserver(() => engine.resize());
      resizeObserver.observe(container);
    }

    return () => {
      canvas.removeEventListener("pointerdown", pauseOrbit);
      canvas.removeEventListener("wheel", pauseOrbit);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      resizeObserver?.disconnect();
      gui.dispose();
      engine.dispose();
      engineRef.current = null;
      sceneRef.current = null;
      guiRef.current = null;
      glowRef.current = null;
      selectedMeshRef.current = null;
    };
  }, []);

  // Rebuild meshes when data/view changes
  useEffect(() => {
    const scene = sceneRef.current;
    const gui = guiRef.current;
    if (!scene || !gui) return;

    // Dispose old graph meshes
    const toDispose: AbstractMesh[] = [];
    for (const mesh of scene.meshes) {
      if (mesh.metadata?.[GRAPH_TAG]) {
        toDispose.push(mesh);
      }
    }
    for (const mesh of toDispose) {
      mesh.dispose();
    }

    // Remove old labels
    const controls = gui.getDescendants();
    for (const ctrl of controls) {
      if (ctrl.name?.startsWith("label_")) {
        ctrl.dispose();
      }
    }

    const { nodes, links } = buildGraph(
      organizations,
      agents,
      tasks,
      peers,
      activeView,
    );

    if (nodes.length === 0) return;

    const positions = layout3d(nodes, links);
    const posMap = new Map(positions.map((p) => [p.id, p]));

    // Create node spheres
    for (const node of nodes) {
      const pos = posMap.get(node.id);
      if (!pos) continue;

      const radius = nodeRadius(node.type, node.data);
      const sphere = MeshBuilder.CreateSphere(
        `node_${node.id}`,
        { diameter: radius * 2, segments: 12 },
        scene,
      );
      sphere.position = new Vector3(pos.x, pos.y, pos.z);
      sphere.metadata = { [GRAPH_TAG]: true, graphNode: node };

      const mat = new StandardMaterial(`mat_${node.id}`, scene);
      const color = hexToColor3(NODE_COLORS[node.type] ?? "#6b7280");
      mat.diffuseColor = color;
      mat.emissiveColor = color.scale(0.4);
      mat.specularColor = new Color3(0.2, 0.2, 0.2);
      sphere.material = mat;

      // Add to glow layer
      if (glowRef.current) {
        glowRef.current.addIncludedOnlyMesh(sphere);
      }

      // Click handling — fly camera to node + highlight
      sphere.actionManager = new ActionManager(scene);
      sphere.actionManager.registerAction(
        new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
          // Unhighlight previous selection
          const prev = selectedMeshRef.current;
          if (prev && prev.material) {
            const prevMat = prev.material as StandardMaterial;
            const prevNode = prev.metadata?.graphNode as GraphNode | undefined;
            const prevColor = hexToColor3(
              NODE_COLORS[prevNode?.type ?? ""] ?? "#6b7280",
            );
            prevMat.emissiveColor = prevColor.scale(0.4);
          }

          // Highlight new selection
          selectedMeshRef.current = sphere;
          mat.emissiveColor = color.scale(1.2);

          // Pause auto-orbit during fly-to
          autoOrbitRef.current = false;
          if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

          const cam = scene.activeCamera as ArcRotateCamera;
          const targetPos = sphere.position.clone();
          animateCameraTo(cam, targetPos, 5, scene);

          // Resume orbit after fly-to + idle
          idleTimerRef.current = setTimeout(() => {
            autoOrbitRef.current = true;
          }, IDLE_RESUME_MS + 1000);

          onNodeClick(node);
        }),
      );

      // Hover cursor
      sphere.actionManager.registerAction(
        new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
          if (scene.getEngine().getRenderingCanvas()) {
            scene.getEngine().getRenderingCanvas()!.style.cursor = "pointer";
          }
        }),
      );
      sphere.actionManager.registerAction(
        new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
          if (scene.getEngine().getRenderingCanvas()) {
            scene.getEngine().getRenderingCanvas()!.style.cursor = "default";
          }
        }),
      );

      // Label
      const label = new TextBlock(`label_${node.id}`);
      const maxLen = node.type === "org" || node.type === "suborg" ? 24 : 16;
      label.text =
        node.label.length > maxLen
          ? node.label.slice(0, maxLen - 2) + "…"
          : node.label;
      label.color = "#d1d5db";
      label.fontSize = 12;
      label.outlineWidth = 2;
      label.outlineColor = "#030712";
      label.linkOffsetY = -radius * 80 - 20;
      gui.addControl(label);
      label.linkWithMesh(sphere);
    }

    // Create link lines with hierarchy-based widths
    for (const link of links) {
      const sPos = posMap.get(link.source as string);
      const tPos = posMap.get(link.target as string);
      if (!sPos || !tPos) continue;

      const from = new Vector3(sPos.x, sPos.y, sPos.z);
      const to = new Vector3(tPos.x, tPos.y, tPos.z);

      if (link.type === "parent" || link.type === "contains") {
        // Thick tubes for structural links
        const dist = Vector3.Distance(from, to);
        if (dist < 0.01) continue;
        const dir = to.subtract(from);
        const mid = from.add(dir.scale(0.5));

        const isParent = link.type === "parent";
        const tubeRadius = isParent ? 0.06 : 0.035;

        const tube = MeshBuilder.CreateTube(
          `link_${link.source}_${link.target}`,
          {
            path: [from, mid, to],
            radius: tubeRadius,
            tessellation: 6,
            cap: 0,
          },
          scene,
        );
        const tubeMat = new StandardMaterial(
          `linkMat_${link.source}_${link.target}`,
          scene,
        );
        const linkColor = isParent
          ? new Color3(0.45, 0.5, 0.65)
          : new Color3(0.3, 0.35, 0.45);
        tubeMat.diffuseColor = linkColor;
        tubeMat.emissiveColor = linkColor.scale(0.3);
        tubeMat.alpha = isParent ? 0.7 : 0.5;
        tube.material = tubeMat;
        tube.metadata = { [GRAPH_TAG]: true };
      } else {
        // Thin lines for assigned / peer-link
        const line = MeshBuilder.CreateLines(
          `link_${link.source}_${link.target}`,
          { points: [from, to] },
          scene,
        );
        line.color = link.type === "assigned"
          ? new Color3(0.4, 0.4, 0.2)
          : new Color3(0.3, 0.35, 0.45);
        line.alpha = 0.4;
        line.metadata = { [GRAPH_TAG]: true };
      }
    }

    // Auto-fit camera + entry fly-in
    const camera = scene.activeCamera as ArcRotateCamera | null;
    if (camera && positions.length > 0) {
      let cx = 0,
        cy = 0,
        cz = 0;
      for (const p of positions) {
        cx += p.x;
        cy += p.y;
        cz += p.z;
      }
      cx /= positions.length;
      cy /= positions.length;
      cz /= positions.length;

      let maxDist = 0;
      for (const p of positions) {
        const d = Math.sqrt(
          (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2,
        );
        if (d > maxDist) maxDist = d;
      }

      const finalRadius = Math.max(maxDist * 2.5, 8);
      const finalTarget = new Vector3(cx, cy, cz);

      if (!entryDoneRef.current) {
        // Entry fly-in: start far, animate to final position
        entryDoneRef.current = true;
        camera.target = finalTarget;
        camera.radius = finalRadius * 4;
        animateCameraTo(camera, finalTarget, finalRadius, scene, 90);
      } else {
        camera.target = finalTarget;
        camera.radius = finalRadius;
      }
    }
  }, [organizations, agents, tasks, peers, activeView, onNodeClick]);

  return (
    <div className="w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full outline-none"
        style={{ background: "transparent" }}
      />
    </div>
  );
}

/** Animate camera target + radius smoothly */
function animateCameraTo(
  camera: ArcRotateCamera,
  target: Vector3,
  radius: number,
  scene: Scene,
  frames = 60,
) {
  const fps = 60;
  const ease = makeEase();

  // Animate target
  const targetAnim = new Animation(
    "camTarget",
    "target",
    fps,
    Animation.ANIMATIONTYPE_VECTOR3,
    Animation.ANIMATIONLOOPMODE_CONSTANT,
  );
  targetAnim.setKeys([
    { frame: 0, value: camera.target.clone() },
    { frame: frames, value: target },
  ]);
  targetAnim.setEasingFunction(ease);

  // Animate radius
  const radiusAnim = new Animation(
    "camRadius",
    "radius",
    fps,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CONSTANT,
  );
  radiusAnim.setKeys([
    { frame: 0, value: camera.radius },
    { frame: frames, value: radius },
  ]);
  radiusAnim.setEasingFunction(ease);

  camera.animations = [targetAnim, radiusAnim];
  scene.beginAnimation(camera, 0, frames, false);
}
