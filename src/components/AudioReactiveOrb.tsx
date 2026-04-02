import { useRef, useEffect } from "react";
import * as THREE from "three";

interface AudioReactiveOrbProps {
  audioLevel: number;
  className?: string;
}

const VERTEX_SHADER = `
// Simplex 3D noise
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
  + i.y + vec4(0.0, i1.y, i2.y, 1.0))
  + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

uniform float uTime;
uniform float uDistortion;
uniform float uAudioLevel;

varying vec3 vNormal;
varying vec3 vPosition;

void main() {
  vNormal = normalize(normalMatrix * normal);

  float slowTime = uTime * 0.3;
  float noise = snoise(vec3(position.x * 0.5, position.y * 0.5, position.z * 0.5 + slowTime));
  vec3 pos = position + normal * noise * 0.2 * uDistortion * (1.0 + uAudioLevel);

  vPosition = pos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const FRAGMENT_SHADER = `
uniform float uAudioLevel;

varying vec3 vNormal;
varying vec3 vPosition;

void main() {
  vec3 viewDirection = normalize(cameraPosition - vPosition);
  float fresnel = 1.0 - max(0.0, dot(viewDirection, vNormal));
  fresnel = pow(fresnel, 2.0 + uAudioLevel * 2.0);

  vec3 color = mix(vec3(0.47, 0.55, 0.36), vec3(0.71, 0.90, 0.18), fresnel);
  float alpha = 0.3 + fresnel * 0.7;

  gl_FragColor = vec4(color, alpha);
}
`;

const GLOW_FRAGMENT = `
uniform float uAudioLevel;

varying vec3 vNormal;
varying vec3 vPosition;

void main() {
  vec3 viewDirection = normalize(cameraPosition - vPosition);
  float fresnel = 1.0 - max(0.0, dot(viewDirection, vNormal));
  fresnel = pow(fresnel, 1.5);

  vec3 color = vec3(0.71, 0.90, 0.18); // #b4e62e
  float alpha = fresnel * (0.15 + uAudioLevel * 0.25);

  gl_FragColor = vec4(color, alpha);
}
`;

const GLOW_VERTEX = `
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vec3 pos = position + normal * 0.15;
  vPosition = pos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export function AudioReactiveOrb({ audioLevel, className }: AudioReactiveOrbProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const audioLevelRef = useRef(audioLevel);

  audioLevelRef.current = audioLevel;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const w = container.clientWidth;
    const h = container.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);

    // Adapt camera distance so orb fills ~60% of the smaller viewport dimension
    const fitDistance = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const aspect = cw / ch;
      // Base distance for a 600px viewport, scale inversely with size
      const minDim = Math.min(cw, ch);
      const scale = Math.max(0.6, Math.min(1.4, 600 / minDim));
      // Pull camera back for portrait, push in for landscape
      return (aspect < 1 ? 4.5 : 3.5) * scale;
    };
    camera.position.set(0, 0, fitDistance());

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a0f, 1);
    container.appendChild(renderer.domElement);

    // Main orb — wireframe icosahedron
    const geometry = new THREE.IcosahedronGeometry(1.2, 4);
    const uniforms = {
      uTime: { value: 0 },
      uDistortion: { value: 1.0 },
      uAudioLevel: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      wireframe: true,
      transparent: true,
      depthWrite: false,
    });

    const orb = new THREE.Mesh(geometry, material);
    scene.add(orb);

    // Glow sphere (BackSide, additive)
    const glowUniforms = {
      uAudioLevel: { value: 0 },
    };

    const glowMaterial = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      uniforms: glowUniforms,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const glowSphere = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 3), glowMaterial);
    scene.add(glowSphere);

    // Resize handler — refit camera distance + aspect
    const onResize = () => {
      if (!container) return;
      const rw = container.clientWidth;
      const rh = container.clientHeight;
      camera.aspect = rw / rh;
      camera.position.z = fitDistance();
      camera.updateProjectionMatrix();
      renderer.setSize(rw, rh);
    };
    window.addEventListener("resize", onResize);

    // Animation
    let animId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      const level = audioLevelRef.current;

      uniforms.uTime.value = elapsed;
      uniforms.uDistortion.value = 0.8 + level * 1.5;
      uniforms.uAudioLevel.value = level;
      glowUniforms.uAudioLevel.value = level;

      orb.rotation.y = elapsed * 0.15;
      orb.rotation.x = elapsed * 0.08;
      glowSphere.rotation.y = elapsed * 0.1;

      renderer.render(scene, camera);
    };
    animate();

    cleanupRef.current = () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      glowMaterial.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };

    return () => {
      cleanupRef.current?.();
    };
  }, []);

  return <div ref={containerRef} className={className} style={{ width: "100%", height: "100%" }} />;
}
