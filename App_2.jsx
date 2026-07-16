import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/**
 * App = ImageScrollGallery (bản Click-to-Random-Spin)
 * ------------------------------------------------------------------
 * Thay vì cuộn chuột để chuyển ảnh, giờ CLICK vào canvas sẽ:
 *   1. Chạy nhanh qua nhiều ảnh liên tiếp (hiệu ứng slot machine)
 *   2. Chậm dần (deceleration)
 *   3. Dừng lại ở một ảnh ngẫu nhiên
 * Vẫn giữ nguyên shader blend + displace gốc khi chuyển giữa 2 ảnh.
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
 * Tạo mảng thời lượng (ms) cho từng bước xoay, tăng dần để tạo cảm giác
 * chậm dần (giống máy xèng / slot machine).
 */
function buildStepDurations(totalSteps, minDur = 60, maxDur = 650) {
  const durations = [];
  for (let i = 0; i < totalSteps; i++) {
    const t = totalSteps === 1 ? 1 : i / (totalSteps - 1);
    // easeIn: chậm dần về cuối
    const eased = t * t;
    durations.push(minDur + (maxDur - minDur) * eased);
  }
  return durations;
}

const IMAGE_SIZE = 512;

// ------------------------- App Component -------------------------------

function App() {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);

  // Cấu hình nguồn ảnh - chỉnh trực tiếp ở đây
  const root = 'https://mwmwmw.github.io/files/Ragnar';
  const files = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const ext = 'jpg';
  const imageSize = IMAGE_SIZE;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let renderer = null;
    let rafId = 0;

    const canvas = document.createElement('canvas');
    canvas.width = imageSize;
    canvas.height = imageSize;
    const ctx = canvas.getContext('2d');

    function resizeImage(image) {
      const { width, height } = image;
      if (ctx) {
        ctx.clearRect(0, 0, imageSize, imageSize);
        ctx.drawImage(image, 0, 0, width, height, 0, 0, imageSize, imageSize);
        return ctx.getImageData(0, 0, imageSize, imageSize);
      }
      throw new Error('Canvas 2D context not available');
    }

    function makeThreeTexture(imageData) {
      const tex = new THREE.DataTexture(
        imageData.data,
        imageSize,
        imageSize,
        THREE.RGBAFormat
      );
      tex.needsUpdate = true;
      tex.flipY = true;
      return tex;
    }

    function loadImages() {
      const promises = [];
      for (let i = 0; i < files.length; i++) {
        promises.push(
          new Promise((resolve) => {
            const img = document.createElement('img');
            img.crossOrigin = 'anonymous';
            img.src = `${root}/${files[i]}.${ext}`;
            img.onload = () => resolve(img);
          })
            .then(resizeImage)
            .then(makeThreeTexture)
        );
      }
      return Promise.all(promises);
    }

    loadImages().then((textures) => {
      if (disposed || !container) return;
      setLoading(false);
      init(textures);
    });

    const cleanupRefs = {};

    function init(textures) {
      if (!container) return;

      renderer = new THREE.WebGLRenderer({ antialias: false });
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

      const geometry = new THREE.PlaneGeometry(4.75, 7, 4, 4);

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
      });

      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      // ---------------- Trạng thái spin (click) ----------------
      const spin = {
        active: false,
        fromIdx: 0,
        toIdx: 0,
        stepIndex: 0,
        totalSteps: 0,
        durations: [],
        stepStart: 0,
      };

      function startNextStep() {
        const totalImages = textures.length;
        spin.fromIdx = spin.toIdx;
        spin.toIdx = (spin.fromIdx + 1) % totalImages;
        material.uniforms.tex2.value = textures[spin.fromIdx];
        material.uniforms.tex1.value = textures[spin.toIdx];
        material.uniforms.blend.value = 0;
        spin.stepStart = performance.now();
      }

      function spinToRandom() {
        if (spin.active) return;
        const totalImages = textures.length;
        if (totalImages < 2) return;

        // Chọn ảnh đích ngẫu nhiên, khác ảnh hiện tại
        let finalIdx = Math.floor(Math.random() * totalImages);
        if (finalIdx === currentIndex) {
          finalIdx = (finalIdx + 1) % totalImages;
        }

        // Số vòng "chạy dư" để tạo hiệu ứng quay nhanh trước khi dừng
        const extraLoops = 2 + Math.floor(Math.random() * 2); // 2-3 vòng
        let stepsToFinal = (finalIdx - currentIndex + totalImages) % totalImages;
        if (stepsToFinal === 0) stepsToFinal = totalImages;

        const totalSteps = extraLoops * totalImages + stepsToFinal;

        spin.active = true;
        spin.stepIndex = 0;
        spin.totalSteps = totalSteps;
        spin.durations = buildStepDurations(totalSteps);
        spin.toIdx = currentIndex; // sẽ được +1 ở startNextStep()
        startNextStep();
      }

      function onClick() {
        spinToRandom();
      }
      container.addEventListener('click', onClick);

      function draw() {
        rafId = requestAnimationFrame(draw);

        if (spin.active) {
          const stepDuration = spin.durations[spin.stepIndex] || 300;
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
              startNextStep();
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
  }, [root, files, ext, imageSize]);

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
      {loading && (
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
