import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
    getRadioGenreAnchor,
    RADIO_GENRE_FAMILIES,
    type IRadioSceneNode,
    type RadioSceneLayout,
} from '../../data/sceneLayout';

export interface IRadioSceneEngineCallbacks {
    onHover: (key: string | null) => void;
    onSelect: (key: string) => void;
    onInteractionStart: () => void;
    onInteractionEnd: (centerKey: string | null) => void;
    onContextLost: () => void;
    onContextRestored: () => void;
}

function cssColor(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function createDotTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.28, 'rgba(255,255,255,.95)');
    gradient.addColorStop(0.62, 'rgba(255,255,255,.35)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function createGraticule(radius: number): THREE.LineSegments {
    const vertices: number[] = [];
    const appendSegment = (a: THREE.Vector3, b: THREE.Vector3) => {
        vertices.push(a.x, a.y, a.z, b.x, b.y, b.z);
    };
    const point = (lat: number, lon: number) => {
        const phi = THREE.MathUtils.degToRad(lat);
        const lambda = THREE.MathUtils.degToRad(lon);
        return new THREE.Vector3(
            radius * Math.cos(phi) * Math.sin(lambda),
            radius * Math.sin(phi),
            radius * Math.cos(phi) * Math.cos(lambda),
        );
    };

    for (let lat = -60; lat <= 60; lat += 30) {
        for (let lon = -180; lon < 180; lon += 5) {
            appendSegment(point(lat, lon), point(lat, lon + 5));
        }
    }
    for (let lon = -150; lon <= 180; lon += 30) {
        for (let lat = -85; lat < 85; lat += 5) {
            appendSegment(point(lat, lon), point(lat + 5, lon));
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({ transparent: true, opacity: 0.12 }),
    );
}

function createStars(): THREE.Points {
    const positions: number[] = [];
    for (let index = 0; index < 600; index++) {
        const radius = 13 + Math.random() * 9;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions.push(
            radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.sin(theta),
        );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.025,
            transparent: true,
            opacity: 0.28,
        }),
    );
}

function createGenreLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 72;
    const context = canvas.getContext('2d')!;
    context.font = '600 25px "Microsoft YaHei", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(238,247,242,.84)';
    context.fillText(text, 160, 36);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.85, 0.42, 1);
    sprite.userData.labelTexture = texture;
    return sprite;
}

export class RadioSceneEngine {
    private renderer: THREE.WebGLRenderer;
    private scene = new THREE.Scene();
    private camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
    private controls: OrbitControls;
    private raycaster = new THREE.Raycaster();
    private pointer = new THREE.Vector2();
    private resizeObserver: ResizeObserver;
    private nodes: IRadioSceneNode[] = [];
    private nodeIndexByKey = new Map<string, number>();
    private layout: RadioSceneLayout = 'globe';
    private pointTexture = createDotTexture();
    private pointGeometry = new THREE.BufferGeometry();
    private pointMaterial: THREE.PointsMaterial;
    private points: THREE.Points;
    private globe: THREE.Mesh;
    private graticule = createGraticule(4.015);
    private genreLabels = new THREE.Group();
    private selectedHalo: THREE.Sprite;
    private playingHalo: THREE.Sprite;
    private selectedKey: string | null = null;
    private playingKey: string | null = null;
    private animationFrame: number | null = null;
    private transitionStart = 0;
    private transitionDuration = 0;
    private transitionFrom: Float32Array | null = null;
    private transitionTo: Float32Array | null = null;
    private pointerDown: { x: number; y: number } | null = null;
    private pointerMoved = false;
    private userGesture = false;
    private interactionAnnounced = false;
    private wheelEndTimer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;
    private visible = true;

    constructor(
        private readonly container: HTMLElement,
        private readonly callbacks: IRadioSceneEngineCallbacks,
    ) {
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.domElement.className = 'radio-scene__canvas';
        this.renderer.domElement.tabIndex = 0;
        this.renderer.domElement.setAttribute(
            'aria-label',
            '电台空间视图，可拖动旋转并使用滚轮缩放',
        );
        this.container.appendChild(this.renderer.domElement);

        this.camera.position.set(0, 0.3, 11.5);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enablePan = false;
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.075;
        this.controls.rotateSpeed = 0.48;
        this.controls.zoomSpeed = 0.7;
        this.controls.minDistance = 6.2;
        this.controls.maxDistance = 17;

        this.pointMaterial = new THREE.PointsMaterial({
            size: 0.11,
            map: this.pointTexture,
            transparent: true,
            opacity: 0.92,
            alphaTest: 0.04,
            depthWrite: false,
            vertexColors: true,
            sizeAttenuation: true,
        });
        this.points = new THREE.Points(this.pointGeometry, this.pointMaterial);
        this.raycaster.params.Points = { threshold: 0.18 };

        this.globe = new THREE.Mesh(
            new THREE.SphereGeometry(4, 48, 32),
            new THREE.MeshBasicMaterial({
                transparent: true,
                opacity: 0.065,
                side: THREE.DoubleSide,
            }),
        );
        this.selectedHalo = this.createHalo(0.25, 0.95);
        this.playingHalo = this.createHalo(0.34, 0.7);
        this.scene.add(
            createStars(),
            this.globe,
            this.graticule,
            this.points,
            this.genreLabels,
            this.selectedHalo,
            this.playingHalo,
        );
        this.genreLabels.visible = false;

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);
        this.bindEvents();
        this.updateTheme();
        this.resize();
    }

    setNodes(nodes: IRadioSceneNode[]): void {
        this.nodes = nodes;
        this.nodeIndexByKey = new Map(nodes.map((node, index) => [node.key, index]));
        const positions = new Float32Array(nodes.length * 3);
        const colors = new Float32Array(nodes.length * 3);
        const brand = new THREE.Color(cssColor('--color-text-brand', '#38d6a2'));
        const warm = new THREE.Color('#f0a55b');

        nodes.forEach((node, index) => {
            const position = this.layout === 'globe' ? node.globePosition : node.genrePosition;
            position.toArray(positions, index * 3);
            const color = brand
                .clone()
                .lerp(
                    warm,
                    this.layout === 'genres' ? node.popularity * 0.72 : node.popularity * 0.3,
                );
            color.toArray(colors, index * 3);
        });

        this.pointGeometry.dispose();
        this.pointGeometry = new THREE.BufferGeometry();
        this.pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.pointGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        this.points.geometry = this.pointGeometry;
        this.pointGeometry.computeBoundingSphere();
        this.rebuildGenreLabels();
        this.updateHalos();
        this.requestRender();
    }

    setLayout(layout: RadioSceneLayout, animate = true): void {
        if (layout === this.layout) return;
        this.layout = layout;
        this.globe.visible = layout === 'globe';
        this.graticule.visible = layout === 'globe';
        this.genreLabels.visible = layout === 'genres';
        this.controls.enablePan = layout === 'genres';
        const attribute = this.pointGeometry.getAttribute('position') as
            | THREE.BufferAttribute
            | undefined;
        if (!attribute) return;
        const target = new Float32Array(this.nodes.length * 3);
        this.nodes.forEach((node, index) => {
            const position = layout === 'globe' ? node.globePosition : node.genrePosition;
            position.toArray(target, index * 3);
        });
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!animate || reduceMotion) {
            attribute.array.set(target);
            attribute.needsUpdate = true;
            this.transitionTo = null;
        } else {
            this.transitionFrom = new Float32Array(attribute.array as ArrayLike<number>);
            this.transitionTo = target;
            this.transitionStart = performance.now();
            this.transitionDuration = 460;
        }
        this.controls.target.set(0, 0, 0);
        this.requestRender();
    }

    setSelected(key: string | null): void {
        this.selectedKey = key;
        this.updateHalos();
        this.requestRender();
    }

    setPlaying(key: string | null): void {
        this.playingKey = key;
        this.updateHalos();
        this.requestRender();
    }

    focusNode(key: string): void {
        const index = this.nodeIndexByKey.get(key);
        if (index == null) return;
        const node = this.nodes[index];
        const position = this.layout === 'globe' ? node.globePosition : node.genrePosition;
        if (this.layout === 'globe') {
            const direction = position.clone().normalize();
            this.camera.position.copy(direction.multiplyScalar(10.5));
            this.controls.target.set(0, 0, 0);
        } else {
            this.controls.target.copy(position);
            this.camera.position.copy(position).add(new THREE.Vector3(0, 0, 8.5));
        }
        this.camera.lookAt(this.controls.target);
        this.controls.update();
        this.requestRender();
    }

    getCenterKey(): string | null {
        if (this.nodes.length === 0) return null;
        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const hit = this.raycaster.intersectObject(this.points, false)[0];
        return hit?.index == null ? null : (this.nodes[hit.index]?.key ?? null);
    }

    updateTheme(): void {
        const brand = new THREE.Color(cssColor('--color-text-brand', '#38d6a2'));
        const border = new THREE.Color(cssColor('--color-border-default', '#6c8178'));
        this.pointMaterial.color.set(0xffffff);
        (this.globe.material as THREE.MeshBasicMaterial).color.copy(brand);
        (this.graticule.material as THREE.LineBasicMaterial).color.copy(border);
        (this.selectedHalo.material as THREE.SpriteMaterial).color.copy(brand);
        (this.playingHalo.material as THREE.SpriteMaterial).color.set('#f4a261');
        this.requestRender();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.animationFrame != null) cancelAnimationFrame(this.animationFrame);
        if (this.wheelEndTimer) clearTimeout(this.wheelEndTimer);
        this.resizeObserver.disconnect();
        this.unbindEvents();
        this.controls.dispose();
        this.scene.traverse((object) => {
            if (
                object instanceof THREE.Mesh ||
                object instanceof THREE.Points ||
                object instanceof THREE.LineSegments
            ) {
                object.geometry?.dispose();
                const materials = Array.isArray(object.material)
                    ? object.material
                    : [object.material];
                materials.forEach((material) => material?.dispose());
            }
            if (object instanceof THREE.Sprite) {
                const texture = object.userData.labelTexture as THREE.Texture | undefined;
                texture?.dispose();
                object.material.dispose();
            }
        });
        this.pointTexture.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }

    private rebuildGenreLabels(): void {
        for (const child of [...this.genreLabels.children]) {
            this.genreLabels.remove(child);
            if (child instanceof THREE.Sprite) {
                const texture = child.userData.labelTexture as THREE.Texture | undefined;
                texture?.dispose();
                child.material.dispose();
            }
        }
        const counts = new Map<string, number>();
        this.nodes.forEach((node) =>
            counts.set(node.genreFamily, (counts.get(node.genreFamily) ?? 0) + 1),
        );
        for (const family of RADIO_GENRE_FAMILIES) {
            const count = counts.get(family) ?? 0;
            if (count === 0) continue;
            const label = createGenreLabel(`${family}  ${count}`);
            label.position.copy(getRadioGenreAnchor(family)).add(new THREE.Vector3(0, 0.52, 0));
            this.genreLabels.add(label);
        }
    }

    private createHalo(scale: number, opacity: number): THREE.Sprite {
        const material = new THREE.SpriteMaterial({
            map: this.pointTexture,
            transparent: true,
            opacity,
            depthTest: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.setScalar(scale);
        sprite.visible = false;
        return sprite;
    }

    private updateHalos(): void {
        this.updateHalo(this.selectedHalo, this.selectedKey);
        this.updateHalo(this.playingHalo, this.playingKey);
    }

    private updateHalo(halo: THREE.Sprite, key: string | null): void {
        const index = key ? this.nodeIndexByKey.get(key) : undefined;
        if (index == null) {
            halo.visible = false;
            return;
        }
        const position =
            this.layout === 'globe'
                ? this.nodes[index].globePosition
                : this.nodes[index].genrePosition;
        halo.position.copy(position);
        halo.visible = true;
    }

    private resize(): void {
        const width = Math.max(1, this.container.clientWidth);
        const height = Math.max(1, this.container.clientHeight);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(
            Math.min(window.devicePixelRatio || 1, width < 700 ? 1.4 : 1.75),
        );
        this.renderer.setSize(width, height, false);
        this.requestRender();
    }

    private pick(clientX: number, clientY: number): string | null {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.set(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hit = this.raycaster.intersectObject(this.points, false)[0];
        return hit?.index == null ? null : (this.nodes[hit.index]?.key ?? null);
    }

    private bindEvents(): void {
        const canvas = this.renderer.domElement;
        canvas.addEventListener('pointerdown', this.handlePointerDown);
        canvas.addEventListener('pointermove', this.handlePointerMove);
        canvas.addEventListener('pointerup', this.handlePointerUp);
        canvas.addEventListener('pointerleave', this.handlePointerLeave);
        canvas.addEventListener('wheel', this.handleWheel, { passive: true });
        canvas.addEventListener('webglcontextlost', this.handleContextLost);
        canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
        this.controls.addEventListener('start', this.handleControlStart);
        this.controls.addEventListener('change', this.handleControlChange);
        this.controls.addEventListener('end', this.handleControlEnd);
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    private unbindEvents(): void {
        const canvas = this.renderer.domElement;
        canvas.removeEventListener('pointerdown', this.handlePointerDown);
        canvas.removeEventListener('pointermove', this.handlePointerMove);
        canvas.removeEventListener('pointerup', this.handlePointerUp);
        canvas.removeEventListener('pointerleave', this.handlePointerLeave);
        canvas.removeEventListener('wheel', this.handleWheel);
        canvas.removeEventListener('webglcontextlost', this.handleContextLost);
        canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
        this.controls.removeEventListener('start', this.handleControlStart);
        this.controls.removeEventListener('change', this.handleControlChange);
        this.controls.removeEventListener('end', this.handleControlEnd);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    private handlePointerDown = (event: PointerEvent) => {
        this.pointerDown = { x: event.clientX, y: event.clientY };
        this.pointerMoved = false;
        this.userGesture = false;
        this.interactionAnnounced = false;
    };

    private handlePointerMove = (event: PointerEvent) => {
        if (this.pointerDown) {
            const distance = Math.hypot(
                event.clientX - this.pointerDown.x,
                event.clientY - this.pointerDown.y,
            );
            if (distance > 5 && !this.pointerMoved) {
                this.pointerMoved = true;
                this.userGesture = true;
                this.announceInteractionStart();
            }
        }
        if (!this.pointerMoved) this.callbacks.onHover(this.pick(event.clientX, event.clientY));
    };

    private handlePointerUp = (event: PointerEvent) => {
        if (!this.pointerMoved) {
            const key = this.pick(event.clientX, event.clientY);
            if (key) this.callbacks.onSelect(key);
        }
        this.pointerDown = null;
        this.pointerMoved = false;
        this.callbacks.onHover(this.pick(event.clientX, event.clientY));
    };

    private handlePointerLeave = () => {
        this.pointerDown = null;
        this.pointerMoved = false;
        this.callbacks.onHover(null);
    };

    private handleWheel = () => {
        this.userGesture = true;
        this.announceInteractionStart();
        if (this.wheelEndTimer) clearTimeout(this.wheelEndTimer);
        this.wheelEndTimer = setTimeout(() => {
            this.wheelEndTimer = null;
            if (this.userGesture) this.callbacks.onInteractionEnd(this.getCenterKey());
            this.userGesture = false;
            this.interactionAnnounced = false;
        }, 180);
    };

    private announceInteractionStart(): void {
        if (this.interactionAnnounced) return;
        this.interactionAnnounced = true;
        this.callbacks.onInteractionStart();
    }

    private handleControlStart = () => {
        if (this.userGesture) this.announceInteractionStart();
    };

    private handleControlChange = () => {
        this.updateHalos();
        this.requestRender();
    };

    private handleControlEnd = () => {
        if (this.userGesture) {
            this.callbacks.onInteractionEnd(this.getCenterKey());
        }
        this.userGesture = false;
        this.interactionAnnounced = false;
    };

    private handleVisibilityChange = () => {
        this.visible = !document.hidden;
        if (this.visible) this.requestRender();
    };

    private handleContextLost = (event: Event) => {
        event.preventDefault();
        this.visible = false;
        this.callbacks.onContextLost();
    };

    private handleContextRestored = () => {
        this.visible = true;
        this.callbacks.onContextRestored();
        this.updateTheme();
        this.requestRender();
    };

    private requestRender(): void {
        if (this.disposed || !this.visible || this.animationFrame != null) return;
        this.animationFrame = requestAnimationFrame(this.renderFrame);
    }

    private renderFrame = (now: number) => {
        this.animationFrame = null;
        let keepRendering = this.controls.update();
        if (this.transitionTo && this.transitionFrom) {
            const progress = Math.min(1, (now - this.transitionStart) / this.transitionDuration);
            const eased = 1 - Math.pow(1 - progress, 3);
            const attribute = this.pointGeometry.getAttribute('position') as THREE.BufferAttribute;
            for (let index = 0; index < this.transitionTo.length; index++) {
                attribute.array[index] = THREE.MathUtils.lerp(
                    this.transitionFrom[index],
                    this.transitionTo[index],
                    eased,
                );
            }
            attribute.needsUpdate = true;
            this.updateHalos();
            if (progress < 1) keepRendering = true;
            else {
                this.transitionFrom = null;
                this.transitionTo = null;
            }
        }
        this.renderer.render(this.scene, this.camera);
        if (keepRendering) this.requestRender();
    };
}
