const landing = document.querySelector("#landing");
const video = document.querySelector("#landing-video");
const toggleVideo = document.querySelector("#toggle-video");
const reduceMotion = document.querySelector("#reduce-motion");
const mediaNote = document.querySelector("#media-note");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function showFallback(message) {
  video.pause();
  video.hidden = true;
  landing.dataset.media = "fallback";
  toggleVideo.disabled = true;
  toggleVideo.textContent = "图片回退 / Image fallback";
  reduceMotion.setAttribute("aria-pressed", "true");
  mediaNote.textContent = message;
}

function useReducedMotion() {
  showFallback("已跳过视频；当前显示真实项目图，两条入口仍可直接进入。");
}

video.addEventListener("canplay", () => {
  if (reducedMotion.matches || reduceMotion.getAttribute("aria-pressed") === "true") return;
  landing.dataset.media = "video";
  toggleVideo.disabled = false;
  mediaNote.textContent = "真实项目视频 · 静音循环播放，可随时暂停或跳过。";
  video.play().catch(() => showFallback("浏览器阻止了自动播放；当前显示真实项目图，两条入口仍可直接进入。"));
}, { once: true });

video.addEventListener("error", () => showFallback("视频未能载入；当前显示真实项目图，两条入口仍可直接进入。"), { once: true });

toggleVideo.addEventListener("click", () => {
  if (video.paused) {
    video.play().then(() => {
      toggleVideo.innerHTML = '暂停视频 <span>Pause</span>';
      toggleVideo.setAttribute("aria-pressed", "false");
    }).catch(() => showFallback("视频无法继续播放；当前显示真实项目图。"));
  } else {
    video.pause();
    toggleVideo.innerHTML = '继续视频 <span>Play</span>';
    toggleVideo.setAttribute("aria-pressed", "true");
  }
});

reduceMotion.addEventListener("click", useReducedMotion);

if (reducedMotion.matches) useReducedMotion();
else {
  window.setTimeout(() => {
    if (landing.dataset.media !== "video") showFallback("视频载入较慢；当前显示真实项目图，两条入口仍可直接进入。");
  }, 8000);
}
