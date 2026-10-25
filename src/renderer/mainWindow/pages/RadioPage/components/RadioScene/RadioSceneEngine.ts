import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
    getRadioGenreAnchor,
    RADIO_GENRE_FAMILIES,
    type IRadioSceneNode,
    type RadioGenreFamily,
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

function createRingTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.clearRect(0, 0, 128, 128);
    context.beginPath();
    context.arc(64, 64, 52, 0, Math.PI * 2);
    context.lineWidth = 4;
    context.strokeStyle = 'rgba(56, 214, 162, 0.9)';
    context.shadowColor = 'rgba(56, 214, 162, 0.85)';
    context.shadowBlur = 10;
    context.stroke();
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

function createGenreLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 72;
    const context = canvas.getContext('2d')!;
    context.font =
        '600 25px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgba(0, 0, 0, 0.92)';
    context.shadowBlur = 8;
    context.fillStyle = 'rgba(245, 252, 248, 0.95)';
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
    private ringTexture = createRingTexture();
    private pointGeometry = new THREE.BufferGeometry();
    private pointMaterial: THREE.PointsMaterial;
    private points: THREE.Points;
    private globe: THREE.Mesh;
    private graticule = createGraticule(4.015);
    private genreLabels = new THREE.Group();
    private selectedHalo: THREE.Sprite;
    private playingHalo: THREE.Sprite;
    private signalWaves: THREE.Sprite[] = [];
    private selectedKey: string | null = null;
    private playingKey: string | null = null;
    private isLivePlaying = false;
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

    // 宇宙星空着色器（参考 roamdial.com 的多层闪烁星空、流星与深空光晕）
    private skyQuad: THREE.Mesh;
    private skyMaterial: THREE.ShaderMaterial;
    private targetTilt = new THREE.Vector2(0, 0);
    private currentTilt = new THREE.Vector2(0, 0);

    // 平滑镜头巡航
    private cameraFlyStart = 0;
    private cameraFlyDuration = 0;
    private cameraFlyFromPos = new THREE.Vector3();
    private cameraFlyToPos = new THREE.Vector3();
    private cameraFlyFromTarget = new THREE.Vector3();
    private cameraFlyToTarget = new THREE.Vector3();
    private isCameraFlying = false;

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
        this.controls.minDistance = 5.8;
        this.controls.maxDistance = 17;

        // 构建全屏深空着色器背景
        const skyGeometry = new THREE.PlaneGeometry(2, 2);
        this.skyMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.9999, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uAspect;
                uniform float uTime;
                uniform float uLive;
                uniform vec2 uTilt;

                varying vec2 vUv;

                float hh(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
                }

                float stars(vec2 q, float dens, float rad, float time, float live) {
                    vec2 c = floor(q);
                    float h1 = hh(c);
                    if (h1 > dens) return 0.0;
                    vec2 o = vec2(hh(c + 7.1), hh(c + 13.7)) - 0.5;
                    float d = length(fract(q) - 0.5 - o * 0.6);
                    float h2 = hh(c + 3.3);
                    float tw = mix(0.35, 0.75, live);
                    float speed = (0.28 + h2 * 1.15) * mix(1.0, 1.55, live);
                    float twinkle = max(0.0, 1.0 - tw + tw * sin(time * speed + h2 * 40.0));
                    return smoothstep(rad, 0.0, d) * (0.35 + 0.65 * hh(c + 5.9)) * twinkle;
                }

                void main() {
                    vec2 p = vUv - 0.5;
                    p.x *= uAspect;

                    // 1. 深空氛围晕光（参考 roamdial.com 墨绿暗青基调与径向辐射）
                    float g = exp(-dot(p, p) * 2.8);
                    vec3 c = vec3(0.0035, 0.0085, 0.0078) + mix(vec3(0.0025, 0.0068, 0.0055), vec3(0.0020, 0.0058, 0.0075), 0.5) * g;
                    c += vec3(0.008, 0.024, 0.018) * exp(-length(p - vec2(0.2, -0.15)) * 3.0);
                    c += vec3(0.010, 0.016, 0.024) * exp(-length(p - vec2(-0.25, 0.22)) * 3.2);

                    vec2 s = vUv * vec2(uAspect, 1.0);
                    float dr = mix(1.0, 2.2, uLive);

                    // 2. 多层级闪烁星空（远景微尘、中景闪烁恒星、近景明亮星点）
                    float st1 = stars((s + uTilt * 0.012) * 80.0 + uTime * vec2(0.035, 0.010) * dr, 0.12, 0.13, uTime, uLive);
                    float st2 = stars((s + uTilt * 0.028) * 36.0 + uTime * vec2(0.045, 0.014) * dr, 0.065, 0.088, uTime, uLive) * 2.5;
                    float st3 = stars((s + uTilt * 0.045) * 16.0 + uTime * vec2(0.055, 0.016) * dr, 0.028, 0.055, uTime, uLive) * 4.2;

                    float st = st1 + st2 + st3;
                    vec3 starColor = mix(vec3(0.72, 0.88, 0.82), vec3(0.96, 0.98, 1.0), hh(floor((s + uTilt * 0.02) * 36.0)));
                    c += starColor * st * 0.09 * mix(1.0, 1.35, uLive);

                    // 3. 动态流星划过天际（roamdial.com 招牌灵动画感）
                    float mt = uTime / 12.0;
                    float mi = floor(mt);
                    float mf = fract(mt) * 12.0;
                    if (mf < 1.25 && hh(vec2(mi, 0.72)) < 0.88) {
                        vec2 h0 = vec2(uAspect * (0.28 + 0.62 * hh(vec2(mi, 1.3))), 0.65 + 0.32 * hh(vec2(mi, 7.9))) + uTilt * 0.03;
                        vec2 dir = normalize(vec2(-0.76 - 0.45 * hh(vec2(mi, 3.1)), -0.42));
                        float k = mf / 1.25;
                        vec2 q = s - (h0 + dir * k * 0.62);
                        float along = dot(q, -dir);
                        float across = abs(q.x * dir.y - q.y * dir.x);
                        float streak = step(0.0, along) * (1.0 - smoothstep(0.0, 0.20, along)) * (1.0 - smoothstep(0.0, 0.0024, across)) * sin(3.14159 * k);
                        c += vec3(0.40, 0.55, 0.50) * streak * 1.6;
                    }

                    gl_FragColor = vec4(c, 1.0);
                }
            `,
            uniforms: {
                uAspect: { value: 1.0 },
                uTime: { value: 0.0 },
                uLive: { value: 0.0 },
                uTilt: { value: new THREE.Vector2(0, 0) },
            },
            depthTest: false,
            depthWrite: false,
        });
        this.skyQuad = new THREE.Mesh(skyGeometry, this.skyMaterial);
        this.skyQuad.frustumCulled = false;
        this.skyQuad.renderOrder = -1000;

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

        // 3D 广播信号波纹（从激活电台向外辐射扩散的同心光环）
        for (let i = 0; i < 3; i++) {
            const mat = new THREE.SpriteMaterial({
                map: this.ringTexture,
                transparent: true,
                opacity: 0,
                depthTest: false,
            });
            const sprite = new THREE.Sprite(mat);
            sprite.visible = false;
            this.signalWaves.push(sprite);
            this.scene.add(sprite);
        }

        this.scene.add(
            this.skyQuad,
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
        this.startLoop();
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
            this.transitionDuration = 520;
        }
        this.controls.target.set(0, 0, 0);
    }

    setSelected(key: string | null): void {
        this.selectedKey = key;
        this.updateHalos();
    }

    setPlaying(key: string | null): void {
        this.playingKey = key;
        this.updateHalos();
    }

    setLivePlaying(isLive: boolean): void {
        this.isLivePlaying = isLive;
    }

    focusNode(key: string, smooth = true): void {
        const index = this.nodeIndexByKey.get(key);
        if (index == null) return;
        const node = this.nodes[index];
        const position = this.layout === 'globe' ? node.globePosition : node.genrePosition;
        let targetCameraPos: THREE.Vector3;
        let targetLookAt: THREE.Vector3;

        if (this.layout === 'globe') {
            const direction = position.clone().normalize();
            targetCameraPos = direction.clone().multiplyScalar(10.2);
            targetLookAt = new THREE.Vector3(0, 0, 0);
        } else {
            targetLookAt = position.clone();
            targetCameraPos = position.clone().add(new THREE.Vector3(0, 0.25, 5.6));
        }

        if (!smooth) {
            this.controls.target.copy(targetLookAt);
            this.camera.position.copy(targetCameraPos);
            this.camera.lookAt(targetLookAt);
            this.controls.update();
            return;
        }

        this.startCameraFlight(targetCameraPos, targetLookAt, 680);
    }

    /** 平滑飞行聚焦流派星云簇 */
    focusGenreFamily(family: RadioGenreFamily, smooth = true): void {
        const anchor = getRadioGenreAnchor(family);
        const targetLookAt = anchor.clone();
        const targetCameraPos = anchor.clone().add(new THREE.Vector3(0, 0.35, 6.5));

        if (!smooth) {
            this.controls.target.copy(targetLookAt);
            this.camera.position.copy(targetCameraPos);
            this.camera.lookAt(targetLookAt);
            this.controls.update();
            return;
        }

        this.startCameraFlight(targetCameraPos, targetLookAt, 750);
    }

    /** 高亮突出选中流派粒子簇，其他流派粒子优雅暗化 */
    highlightGenreFamily(family: RadioGenreFamily | null): void {
        const colorAttr = this.pointGeometry.getAttribute('color') as
            | THREE.BufferAttribute
            | undefined;
        if (!colorAttr) return;

        const brand = new THREE.Color(cssColor('--color-text-brand', '#38d6a2'));
        const warm = new THREE.Color('#f0a55b');
        const dimmed = new THREE.Color('#19322b');

        this.nodes.forEach((node, index) => {
            const isMatched = family == null || node.genreFamily === family;
            let c: THREE.Color;
            if (isMatched) {
                c = brand
                    .clone()
                    .lerp(
                        warm,
                        this.layout === 'genres' ? node.popularity * 0.72 : node.popularity * 0.3,
                    );
                if (family != null) {
                    c.multiplyScalar(1.22);
                }
            } else {
                c = dimmed;
            }
            c.toArray(colorAttr.array as Float32Array, index * 3);
        });
        colorAttr.needsUpdate = true;
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
        this.skyMaterial.dispose();
        this.skyQuad.geometry.dispose();
        this.pointTexture.dispose();
        this.ringTexture.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }

    private startCameraFlight(
        targetPos: THREE.Vector3,
        targetLookAt: THREE.Vector3,
        duration = 700,
    ): void {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion) {
            this.camera.position.copy(targetPos);
            this.controls.target.copy(targetLookAt);
            this.camera.lookAt(targetLookAt);
            this.controls.update();
            return;
        }

        this.cameraFlyFromPos.copy(this.camera.position);
        this.cameraFlyToPos.copy(targetPos);
        this.cameraFlyFromTarget.copy(this.controls.target);
        this.cameraFlyToTarget.copy(targetLookAt);
        this.cameraFlyDuration = duration;
        this.cameraFlyStart = performance.now();
        this.isCameraFlying = true;
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
        const rect = this.renderer.domElement.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            this.targetTilt.set(
                ((event.clientX - rect.left) / rect.width - 0.5) * 2,
                ((event.clientY - rect.top) / rect.height - 0.5) * 2,
            );
        }

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
        this.targetTilt.set(0, 0);
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
        if (this.visible) this.startLoop();
        else if (this.animationFrame != null) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    };

    private handleContextLost = (event: Event) => {
        event.preventDefault();
        this.visible = false;
        if (this.animationFrame != null) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        this.callbacks.onContextLost();
    };

    private handleContextRestored = () => {
        this.visible = true;
        this.callbacks.onContextRestored();
        this.updateTheme();
        this.startLoop();
    };

    private startLoop(): void {
        if (this.disposed || !this.visible || this.animationFrame != null) return;
        this.animationFrame = requestAnimationFrame(this.renderLoop);
    }

    private renderLoop = (now: number) => {
        this.animationFrame = null;
        if (this.disposed || !this.visible) return;
        this.renderFrame(now);
        this.animationFrame = requestAnimationFrame(this.renderLoop);
    };

    private renderFrame(now: number): void {
        this.controls.update();

        // 1. 更新全景星空着色器（视差平滑跟随 + 闪烁时间 + 电台活力反应）
        this.currentTilt.lerp(this.targetTilt, 0.05);
        this.skyMaterial.uniforms.uAspect.value = this.camera.aspect;
        this.skyMaterial.uniforms.uTime.value = now * 0.001;
        this.skyMaterial.uniforms.uLive.value = this.isLivePlaying ? 1.0 : 0.0;
        this.skyMaterial.uniforms.uTilt.value.copy(this.currentTilt);

        // 2. 镜头平滑巡航飞行
        if (this.isCameraFlying) {
            const elapsed = now - this.cameraFlyStart;
            const progress = Math.min(1, elapsed / this.cameraFlyDuration);
            const eased = 1 - Math.pow(1 - progress, 3);
            this.camera.position.lerpVectors(this.cameraFlyFromPos, this.cameraFlyToPos, eased);
            this.controls.target.lerpVectors(
                this.cameraFlyFromTarget,
                this.cameraFlyToTarget,
                eased,
            );
            this.controls.update();
            if (progress >= 1) {
                this.isCameraFlying = false;
            }
        }

        // 3. 布局形态过渡（地球与流派星云）
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
            if (progress >= 1) {
                this.transitionFrom = null;
                this.transitionTo = null;
            }
        }

        // 4. 3D 广播信号波纹动态扩散
        const activeKey = this.playingKey ?? this.selectedKey;
        const activeIndex = activeKey ? this.nodeIndexByKey.get(activeKey) : undefined;
        if (activeIndex != null) {
            const node = this.nodes[activeIndex];
            const pos = this.layout === 'globe' ? node.globePosition : node.genrePosition;
            const sec = now * 0.001;
            this.signalWaves.forEach((sprite, i) => {
                sprite.position.copy(pos);
                sprite.visible = true;
                const phase = (sec * 0.55 + i * 0.333) % 1.0;
                const scale = 0.2 + phase * 2.2;
                sprite.scale.set(scale, scale, 1);
                (sprite.material as THREE.SpriteMaterial).opacity =
                    Math.sin(phase * Math.PI) * 0.85;
            });
        } else {
            this.signalWaves.forEach((sprite) => {
                sprite.visible = false;
            });
        }

        this.renderer.render(this.scene, this.camera);
    }
}
