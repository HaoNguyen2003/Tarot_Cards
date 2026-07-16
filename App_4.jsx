import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/**
 * App = ImageScrollGallery
 * ------------------------------------------------------------------
 * - Danh sách ảnh lấy TỰ ĐỘNG từ GitHub Contents API.
 * - Ảnh được scale theo đúng tỉ lệ gốc (contain-fit), không bị bể/méo.
 * - Click vào canvas -> xáo ngẫu nhiên qua các ảnh (kiểu bốc bài, không
 *   lặp lại ảnh cho đến khi đã duyệt hết) trong TỐI ĐA 3 GIÂY, chậm dần,
 *   rồi dừng ở 1 ảnh ngẫu nhiên.
 * - Vẫn giữ nguyên shader blend + displace gốc khi chuyển giữa 2 ảnh.
 *
 * Nguồn gốc hiệu ứng (artwork) by Thomas Denmark
 * https://www.artstation.com/thomden
 * ------------------------------------------------------------------
 */

// ------------------------- Shaders -------------------------------

const vertexShader = `
precision mediump float;
precision mediump int;
attribute vec4 color;
varying vec3 vPosition;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vUv = uv;
  vPosition = position;
  vColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
precision mediump float;
precision mediump int;
uniform float time;
uniform float blend;
varying vec3 vPosition;
varying vec4 vColor;

uniform sampler2D tex1;
uniform sampler2D tex2;
varying vec2 vUv;

float displaceAmount = 0.3;

void main() {
  float blend2 = 1.0 - blend;
  vec4 image1 = texture2D(tex1, vUv);
  vec4 image2 = texture2D(tex2, vUv);

  float t1 = ((image2.r * displaceAmount) * blend) * 2.0;
  float t2 = ((image1.r * displaceAmount) * blend2) * 2.0;

  vec4 imageA = texture2D(tex2, vec2(vUv.x, vUv.y - t1)) * blend2;
  vec4 imageB = texture2D(tex1, vec2(vUv.x, vUv.y + t2)) * blend;

  gl_FragColor = imageA.bbra * blend + imageA * blend2 +
                 imageB.bbra * blend2 + imageB * blend;
}
`;

// ---------------------- Easing helpers -----------------------------

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Tạo mảng thời lượng (ms) cho từng bước xoay sao cho TỔNG luôn bằng
 * đúng `totalDurationMs` (mặc định 3000ms = 3 giây), bất kể số bước
 * hay số lượng ảnh. Bước đầu ngắn (quay nhanh), bước cuối dài hơn
 * (chậm dần) nhờ trọng số tăng dần theo bình phương.
 */
function buildStepDurations(totalSteps, totalDurationMs = 3000) {
  const minWeight = 0.4;
  const weights = [];
  for (let i = 0; i < totalSteps; i++) {
    const t = totalSteps === 1 ? 1 : i / (totalSteps - 1);
    weights.push(minWeight + t * t * (1 - minWeight) * 4);
  }
  const sumWeights = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / sumWeights) * totalDurationMs);
}

/**
 * Xáo trộn kiểu Fisher-Yates, loại trừ 1 chỉ số (để tránh lặp ngay
 * cạnh chỗ nối giữa 2 lượt xáo).
 */
function shuffledIndices(totalImages, excludeIndex) {
  const arr = [];
  for (let i = 0; i < totalImages; i++) {
    if (i !== excludeIndex) arr.push(i);
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Tạo chuỗi `totalSteps` chỉ số ảnh, đảm bảo không lặp lại ảnh nào
 * cho đến khi đã duyệt qua gần hết các ảnh khác (giống bốc bài không
 * hoàn lại), sau đó mới xáo lại lượt mới.
 */
function buildSpinSequence(totalSteps, totalImages, startIndex) {
  const sequence = [];
  let lastUsed = startIndex;
  while (sequence.length < totalSteps) {
    const batch = shuffledIndices(totalImages, lastUsed);
    for (const idx of batch) {
      if (sequence.length >= totalSteps) break;
      sequence.push(idx);
      lastUsed = idx;
    }
  }
  return sequence;
}

// ---------------------- GitHub image list ---------------------------

const IMAGE_EXT_REGEX = /\.(png|jpe?g|webp|gif)$/i;

/**
 * Lấy danh sách URL ảnh trực tiếp (raw) từ 1 thư mục trên GitHub,
 * dùng GitHub Contents API (không cần token cho repo public).
 */
async function fetchGithubImageUrls(owner, repo, path, branch = 'main') {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const res = await fetch(apiUrl, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });
  if (!res.ok) {
    throw new Error(
      `Không lấy được danh sách ảnh từ GitHub (HTTP ${res.status})`
    );
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('Đường dẫn không phải là thư mục hoặc repo private');
  }
  return data
    .filter((item) => item.type === 'file' && IMAGE_EXT_REGEX.test(item.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((item) => item.download_url);
}

// ---------------------- Cấu hình kích thước ---------------------------

// Tỉ lệ khung hiển thị (khớp với PlaneGeometry bên dưới) - giống thẻ tarot
const PLANE_WIDTH = 4.75;
const PLANE_HEIGHT = 7;
// Độ phân giải texture (canvas) theo ĐÚNG tỉ lệ khung, không bóp méo
const CANVAS_HEIGHT = 768;
const CANVAS_WIDTH = Math.round(CANVAS_HEIGHT * (PLANE_WIDTH / PLANE_HEIGHT));

const MAX_SPIN_DURATION_MS = 3000; // tổng thời gian quay tối đa: 3 giây
const MIN_SPIN_STEPS = 14;
const MAX_SPIN_STEPS = 20;

// ------------------------- App Component -------------------------------

function App() {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ---- Cấu hình nguồn ảnh GitHub - chỉnh trực tiếp ở đây ----
  const githubOwner = 'HaoNguyen2003';
  const githubRepo = 'Tarot_Cards';
  const githubPath = 'Img';
  const githubBranch = 'main';

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let renderer = null;
    let rafId = 0;

    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');

    // Contain-fit: scale ảnh theo đúng tỉ lệ gốc, căn giữa, phần thừa
    // để trong suốt (không cắt, không bóp méo).
    function resizeImage(image) {
      const { width, height } = image;
      if (!ctx) throw new Error('Canvas 2D context not available');

      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      const scale = Math.min(CANVAS_WIDTH / width, CANVAS_HEIGHT / height);
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      const offsetX = (CANVAS_WIDTH - drawWidth) / 2;
      const offsetY = (CANVAS_HEIGHT - drawHeight) / 2;

      ctx.drawImage(image, 0, 0, width, height, offsetX, offsetY, drawWidth, drawHeight);
      return ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    function makeThreeTexture(imageData) {
      const tex = new THREE.DataTexture(
        imageData.data,
        CANVAS_WIDTH,
        CANVAS_HEIGHT,
        THREE.RGBAFormat
      );
      tex.needsUpdate = true;
      tex.flipY = true;
      return tex;
    }

    async function loadImages() {
      const urls = await fetchGithubImageUrls(
        githubOwner,
        githubRepo,
        githubPath,
        githubBranch
      );
      if (urls.length < 2) {
        throw new Error('Thư mục ảnh cần ít nhất 2 ảnh để chạy hiệu ứng');
      }
      const promises = urls.map((url) =>
        new Promise((resolve, reject) => {
          const img = document.createElement('img');
          img.crossOrigin = 'anonymous';
          img.src = url;
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error(`Không tải được ảnh: ${url}`));
        })
          .then(resizeImage)
          .then(makeThreeTexture)
      );
      return Promise.all(promises);
    }

    loadImages()
      .then((textures) => {
        if (disposed || !container) return;
        setLoading(false);
        init(textures);
      })
      .catch((err) => {
        if (disposed) return;
        console.error(err);
        setError(err.message || String(err));
        setLoading(false);
      });

    const cleanupRefs = {};

    function init(textures) {
      if (!container) return;

      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
      container.appendChild(renderer.domElement);
      renderer.domElement.style.cursor = 'pointer';

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        45,
        container.clientWidth / container.clientHeight,
        0.1,
        2000
      );
      camera.position.set(0, 0, 10);
      scene.add(camera);

      const geometry = new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT, 4, 4);

      let currentIndex = 0; // ảnh đang hiển thị đầy đủ (blend = 0)

      const material = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 1.0 },
          blend: { value: 0.0 },
          tex1: { value: textures[1 % textures.length] },
          tex2: { value: textures[0] },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
      });

      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      // ---------------- Trạng thái spin (click) ----------------
      const spin = {
        active: false,
        sequence: [],
        fromIdx: 0,
        toIdx: 0,
        stepIndex: 0,
        totalSteps: 0,
        durations: [],
        stepStart: 0,
      };

      function startStep(idx) {
        spin.fromIdx = spin.toIdx;
        spin.toIdx = spin.sequence[idx];
        material.uniforms.tex2.value = textures[spin.fromIdx];
        material.uniforms.tex1.value = textures[spin.toIdx];
        material.uniforms.blend.value = 0;
        spin.stepStart = performance.now();
      }

      function spinToRandom() {
        if (spin.active) return;
        const totalImages = textures.length;
        if (totalImages < 2) return;

        const totalSteps =
          MIN_SPIN_STEPS +
          Math.floor(Math.random() * (MAX_SPIN_STEPS - MIN_SPIN_STEPS + 1));

        spin.active = true;
        spin.sequence = buildSpinSequence(totalSteps, totalImages, currentIndex);
        spin.stepIndex = 0;
        spin.totalSteps = totalSteps;
        spin.durations = buildStepDurations(totalSteps, MAX_SPIN_DURATION_MS);
        spin.toIdx = currentIndex; // startStep(0) sẽ set fromIdx = currentIndex
        startStep(0);
      }

      function onClick() {
        spinToRandom();
      }
      container.addEventListener('click', onClick);

      function draw() {
        rafId = requestAnimationFrame(draw);

        if (spin.active) {
          const stepDuration = spin.durations[spin.stepIndex] || 150;
          const elapsed = performance.now() - spin.stepStart;
          const rawProgress = Math.min(elapsed / stepDuration, 1);
          material.uniforms.blend.value = easeInOutQuad(rawProgress);

          if (rawProgress >= 1) {
            currentIndex = spin.toIdx;
            spin.stepIndex += 1;
            if (spin.stepIndex >= spin.totalSteps) {
              spin.active = false;
              material.uniforms.blend.value = 0;
              material.uniforms.tex2.value = textures[currentIndex];
              material.uniforms.tex1.value =
                textures[(currentIndex + 1) % textures.length];
            } else {
              startStep(spin.stepIndex);
            }
          }
        }

        material.uniforms.time.value += 0.1;
        renderer.render(scene, camera);
      }

      function resize() {
        if (!container || !renderer) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(container.clientWidth, container.clientHeight);
      }

      window.addEventListener('resize', resize);

      resize();
      draw();

      cleanupRefs.resize = resize;
      cleanupRefs.onClick = onClick;
      cleanupRefs.geometry = geometry;
      cleanupRefs.material = material;
      cleanupRefs.textures = textures;
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);

      if (cleanupRefs.resize) {
        window.removeEventListener('resize', cleanupRefs.resize);
      }
      if (cleanupRefs.onClick && container) {
        container.removeEventListener('click', cleanupRefs.onClick);
      }

      if (cleanupRefs.geometry) cleanupRefs.geometry.dispose();
      if (cleanupRefs.material) cleanupRefs.material.dispose();
      if (cleanupRefs.textures) {
        cleanupRefs.textures.forEach((t) => t.dispose());
      }

      if (renderer) {
        renderer.dispose();
        if (renderer.domElement.parentElement === container) {
          container.removeChild(renderer.domElement);
        }
      }
    };
  }, [githubOwner, githubRepo, githubPath, githubBranch]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: 'black',
      }}
    >
      {loading && !error && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: 100,
            height: 100,
            marginTop: -50,
            marginLeft: -50,
            border: '0.2em dashed white',
            borderRadius: '100%',
            animation: 'img-gallery-spin 5s linear infinite',
          }}
        />
      )}
      {error && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'white',
            fontFamily: 'sans-serif',
            textAlign: 'center',
            maxWidth: '80%',
          }}
        >
          Lỗi tải ảnh: {error}
        </div>
      )}
      <style>{`
        @keyframes img-gallery-spin {
          0% { transform: rotateZ(0deg); }
          100% { transform: rotateZ(360deg); }
        }
      `}</style>
    </div>
  );
}

export default App;
