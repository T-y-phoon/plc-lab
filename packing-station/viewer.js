import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const aim = new THREE.Vector3(0, 0.8, 0);
const layerKinds = { Foam: 4, Product: 3 };
const stationNames = ["Left", "Center", "Right"];
const lampNames = ["Auto", "Manual", "Stop", "Foam", "Product", "Conveyor"];

export async function createStationViewer(viewport, onSelect, selectableParts) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const embedded = document.getElementById("offline-glb");
    const loader = new GLTFLoader();
    const { scene: model, cameras } = embedded
      ? await loader.parseAsync(Uint8Array.from(atob(embedded.textContent), c => c.charCodeAt(0)).buffer, "")
      : await loader.loadAsync("./assets/station.glb");
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#d4dedc");
    scene.add(model);
    scene.add(new THREE.HemisphereLight(0xf4fbff, 0x5d6868, 2.3));
    const key = new THREE.DirectionalLight(0xfff0de, 2.2);
    key.position.set(-3, 6, 5);
    scene.add(key);

    // CAD export uses glTF's default metallic factor. Use a matte teaching finish
    // so details are readable under the viewer's directional lighting.
    model.traverse(mesh => {
      if (!mesh.isMesh) return;
      for (const material of [mesh.material].flat()) {
        material.metalness = Math.min(material.metalness ?? 0, 0.24);
        material.roughness = 0.65;
      }
    });

    const camera = new THREE.PerspectiveCamera(27, 1, .02, 40);
    const teachingCamera = cameras.find(item => item.name === "TeachingFront");
    const defaultPosition = teachingCamera?.getWorldPosition(new THREE.Vector3()) ??
      new THREE.Vector3(1.45, 2.85, 5.85);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.maxPolarAngle = Math.PI / 2;
    controls.minDistance = 2.3;
    controls.maxDistance = 14;
    controls.target.copy(aim);
    camera.position.copy(defaultPosition);
    controls.update();
    controls.saveState();

    const station = model.getObjectByName("Station");
    function get(name) {
      const object = station?.getObjectByName(name);
      if (!object) throw new Error(`GLB 节点缺失：${name}`);
      return object;
    }
    for (const name of selectableParts) get(name);
    const carton = get("Carton");
    const datums = Object.fromEntries(stationNames.map(name => [name, get("Datum" + name)]));
    const indicators = new Map();
    function addIndicator(key, nodeName, color) {
      const materials = [];
      function clone(material) {
        const copy = material.clone();
        copy.emissive?.set(color);
        materials.push(copy);
        return copy;
      }
      get(nodeName).traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
      });
      indicators.set(key, materials);
    }
    stationNames.forEach(name => addIndicator("sensor" + name, name + "Lens", 0xff7850));
    lampNames.forEach(name => addIndicator("lamp" + name, "Lamp" + name,
      name === "Stop" ? 0xff4535 : 0x46ffac));

    let outline;
    const canvas = renderer.domElement;
    canvas.setAttribute("aria-label", "可拖动旋转的工作站模型");
    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);
    new ResizeObserver(() => {
      if (viewport.clientWidth && viewport.clientHeight) {
        renderer.setSize(viewport.clientWidth, viewport.clientHeight, false);
        camera.aspect = viewport.clientWidth / viewport.clientHeight;
        // Keep the complete conveyor and branch close-ups in frame on narrow screens.
        camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(
          Math.tan(THREE.MathUtils.degToRad(27 / 2)) * Math.max(1, 1.8 / camera.aspect)
        ));
        camera.updateProjectionMatrix();
        render();
      }
    }).observe(viewport);

    function highlight(name) {
      if (outline) {
        scene.remove(outline);
        outline.dispose();
      }
      outline = name ? new THREE.BoxHelper(get(name), 0xa84e10) : null;
      if (outline) scene.add(outline);
      render();
    }

    const ray = new THREE.Raycaster();
    let pointerStart;
    canvas.addEventListener("pointerdown", event => {
      pointerStart = event.isPrimary ? [event.clientX, event.clientY] : null;
    });
    canvas.addEventListener("pointercancel", () => { pointerStart = null; });
    canvas.addEventListener("pointerup", event => {
      if (!pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 6) return;
      const bounds = canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1,
        1 - (event.clientY - bounds.top) / bounds.height * 2), camera);
      for (const hit of ray.intersectObject(station, true)) {
        let node = hit.object;
        let selected;
        while (node && node !== station) {
          if (!node.visible) { selected = null; break; }
          if (!selected && selectableParts.has(node.name)) selected = node.name;
          node = node.parent;
        }
        if (selected) { onSelect(selected); break; }
      }
      pointerStart = null;
    });

    const layers = Object.fromEntries(Object.entries(layerKinds).map(([kind, count]) => [
      kind, Array.from({ length: count }, (_, index) => {
        const suffix = kind + "_0" + (index + 1);
        const boxLayer = get(suffix);
        return [boxLayer, get("Stock" + suffix), boxLayer.position.clone()];
      }),
    ]));

    const topProduct = get("Product_03");
    const chip = get("Product_03_Processor");
    const seatedChip = chip.position.clone();
    const crackPath = [[-.19, -.15], [-.11, -.105], [-.13, -.07], [-.046, -.037],
      [-.065, .002], [.022, .052], [.012, .084], [.13, .15]];
    const crack = new THREE.Group();
    crack.name = "TeachingTransportCrack";
    const fractureInk = new THREE.MeshBasicMaterial({ color: 0x601a12 });
    for (let i = 1; i < crackPath.length; i++) {
      const start = new THREE.Vector3(...crackPath[i - 1], .023);
      const end = new THREE.Vector3(...crackPath[i], .023);
      const edge = new THREE.Mesh(new THREE.CylinderGeometry(.004, .005, start.distanceTo(end), 8), fractureInk);
      edge.position.addVectors(start, end).multiplyScalar(.5);
      edge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
      crack.add(edge);
    }
    topProduct.add(crack);
    let followingCarton = false;
    let cameraX = 0;

    function showShippingImpact(progress) {
      // The third product alone can lift into the unfilled space and shift on impact.
      const shake = Math.sin(Math.PI * progress) * Math.sin(8 * Math.PI * progress);
      carton.rotation.y = .055 * shake;
      carton.position.z += .025 * Math.abs(shake);
      topProduct.position.z += .054 * Math.abs(shake);
      topProduct.rotation.y = -.15 * shake;
      const damage = THREE.MathUtils.clamp((progress - .48) * 4.5, 0, 1);
      chip.position.copy(seatedChip);
      chip.position.x += .087 * damage;
      chip.position.y -= .055 * damage;
      chip.position.z += .04 * Math.sin(Math.PI * damage);
      chip.rotation.z = -.63 * damage;
      crack.visible = damage > 0;
    }

    const stockWorld = new THREE.Vector3();
    function setState({ station: stop, positionX, foam, product, sensors = [], lamps = [], material, progress = 0, missedDrop, impact = 0, stack }) {
      if (!Object.hasOwn(datums, stop)) throw new RangeError("Unknown stop");
      if (![foam, product].every(Number.isInteger) || foam < 0 || foam > 4 || product < 0 || product > 3) {
        throw new RangeError("Invalid packing count");
      }
      if (positionX !== undefined && (!Number.isFinite(positionX) || positionX > 1.45 || positionX < (missedDrop === undefined ? -1.45 : -1.831))) {
        throw new RangeError("Invalid carton positionX");
      }
      carton.position.copy(datums[stop].position);
      if (positionX !== undefined) carton.position.x = positionX;
      const heights = { Foam: [], Product: [] };
      if (stack) {
        // In manual mode, stack in the student's actual loading order.
        let nextHeight = .020;
        for (const kind of [...stack, ...(material ? [material] : [])]) {
          heights[kind].push(nextHeight + (kind === "Foam" ? .016 : 0));
          nextHeight += kind === "Foam" ? .032 : .052;
        }
      }
      for (const [kind, count] of [["Foam", foam], ["Product", product]]) {
        layers[kind].forEach(([boxLayer, stockLayer, packedPosition], index) => {
          const missed = missedDrop !== undefined && kind === "Foam" && index === 0;
          const transferring = missed || (kind === material && index === count);
          if (kind === "Foam" && index === 0) boxLayer.rotation.y = 0;
          boxLayer.position.copy(packedPosition);
          boxLayer.position.z = heights[kind][index] ?? packedPosition.z;
          boxLayer.visible = index < count || transferring;
          stockLayer.visible = index >= count && !transferring;
          if (transferring) {
            stockLayer.getWorldPosition(stockWorld);
            boxLayer.parent.worldToLocal(stockWorld);
            if (missed) {
              // Work in the carton's local frame (Z up). The drop starts
              // directly under the rack even as the carton moves out from under it.
              const descend = Math.min(missedDrop / .44, 1);
              const slide = THREE.MathUtils.clamp((missedDrop - .44) / .28, 0, 1);
              const fall = Math.max((missedDrop - .72) / .28, 0);
              boxLayer.position.copy(stockWorld);
              boxLayer.position.x += .31 * slide;
              boxLayer.position.z = THREE.MathUtils.lerp(stockWorld.z, .36, descend * descend)
                - .344 * fall * fall;
              boxLayer.rotation.y = .14 * Math.sin(Math.PI * fall);
            } else {
              boxLayer.position.lerp(stockWorld, 1 - progress);
            }
          }
        });
      }
      showShippingImpact(impact);
      if (followingCarton) {
        const shift = carton.position.x - cameraX;
        controls.target.x += shift;
        camera.position.x += shift;
        cameraX = carton.position.x;
        controls.update();
      }
      const active = new Set([...sensors.map(name => "sensor" + name), ...lamps.map(name => "lamp" + name)]);
      for (const [key, materials] of indicators) {
        for (const material of materials) material.emissiveIntensity = active.has(key) ? 1.4 : 0;
      }
      if (outline) outline.update();
      render();
    }
    function frameLeftStation() {
      followingCarton = false;
      controls.target.set(-1.54, 1.07, 0);
      camera.position.set(-1.13, 2.10, 2.75);
      controls.update();
      render();
    }
    function frameProduct() {
      cameraX = carton.position.x;
      followingCarton = true;
      controls.target.set(cameraX, 1.04, 0);
      camera.position.set(cameraX + .36, 1.84, 1.47);
      controls.update();
      render();
    }
    function resetView() {
      followingCarton = false;
      controls.reset();
      render();
    }
    viewport.prepend(canvas);
    return { setState, highlight, frameLeftStation, frameProduct, resetView };
  } catch (error) {
    renderer.dispose();
    throw error;
  }
}
