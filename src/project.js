document.documentElement.classList.add("js");

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const motionToggle = document.querySelector("#motion-toggle");

function setMotionOff(off) {
  document.documentElement.dataset.motion = off ? "off" : "on";
  motionToggle.setAttribute("aria-pressed", String(off));
  motionToggle.innerHTML = off
    ? '动效关闭 <span>Motion off</span>'
    : '动效开启 <span>Motion on</span>';
}

setMotionOff(reducedMotionQuery.matches);
motionToggle.addEventListener("click", () => setMotionOff(document.documentElement.dataset.motion !== "off"));
reducedMotionQuery.addEventListener?.("change", (event) => setMotionOff(event.matches));

let lastScrollY = window.scrollY;
window.addEventListener("scroll", () => {
  const direction = window.scrollY >= lastScrollY ? "down" : "up";
  document.documentElement.dataset.scrollDirection = direction;
  lastScrollY = window.scrollY;
}, { passive: true });

const revealObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -8%" })
  : null;

for (const element of document.querySelectorAll(".reveal-block, .reveal-media")) {
  if (revealObserver) revealObserver.observe(element);
  else element.classList.add("is-visible");
}

const chapters = [...document.querySelectorAll("[data-chapter]")];
const chapterLinks = [...document.querySelectorAll("[data-chapter-link]")];
const chapterCurrent = document.querySelector("#chapter-current");
const progressBar = document.querySelector("#chapter-progress-bar");

function setActiveChapter(id) {
  const index = Math.max(0, chapters.findIndex((section) => section.dataset.chapter === id));
  chapterCurrent.textContent = String(index + 1).padStart(2, "0");
  progressBar.style.height = `${((index + 1) / chapters.length) * 100}%`;
  for (const link of chapterLinks) {
    const active = link.dataset.chapterLink === id;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
}

if ("IntersectionObserver" in window) {
  const chapterObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) setActiveChapter(visible.target.dataset.chapter);
  }, { threshold: [0.2, 0.45, 0.7], rootMargin: "-18% 0px -48%" });
  chapters.forEach((chapter) => chapterObserver.observe(chapter));
}

const archiveItems = {
  patterns: {
    src: "sample-assets/a01_t1final_p018.png",
    alt: "11类切割图案目录项目页",
    title: "11类切割图案目录",
    source: "term1_final-pre.pdf · p18 · PDF整页导出",
    english: "Eleven kerf-pattern families collected on one exported project page.",
  },
  bending: {
    src: "sample-assets/a02_t1final_p022.png",
    alt: "切割图案弯曲与扭转比较项目页",
    title: "弯曲、扭转与水平弯曲比较",
    source: "term1_final-pre.pdf · p22 · PDF整页导出",
    english: "A project-page comparison of vertical bending, twisting and horizontal bending.",
  },
  legs: {
    src: "sample-assets/a03_t1final_p024.png",
    alt: "两支腿、三支腿和四支腿构型原型项目页",
    title: "2 / 3 / 4支腿构型原型",
    source: "term1_final-pre.pdf · p24 · PDF整页导出",
    english: "Physical configuration studies shown as two-, three- and four-leg units.",
  },
  evaluation: {
    src: "sample-assets/a04_t1final_p028.png",
    alt: "2支腿、3支腿和4支腿构型多维评价表项目页",
    title: "构型多维评价表",
    source: "term1_final-pre.pdf · p28 · PDF整页导出",
    english: "An eleven-criterion comparison used to document a configuration decision.",
  },
};

const archiveViewer = document.querySelector(".archive-viewer");
const archiveImage = document.querySelector("#archive-image");
const archiveCaption = document.querySelector("#archive-caption");
const archiveTabs = [...document.querySelectorAll("[data-archive]")];

function selectArchive(key, focus = false) {
  const item = archiveItems[key];
  if (!item) return;
  archiveViewer.classList.add("is-switching");
  for (const tab of archiveTabs) {
    const selected = tab.dataset.archive === key;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  const update = () => {
    archiveImage.src = item.src;
    archiveImage.alt = item.alt;
    archiveCaption.innerHTML = `<strong>${item.title}</strong><span>${item.source}</span><span lang="en">${item.english}</span>`;
    archiveViewer.classList.remove("is-switching");
  };
  if (document.documentElement.dataset.motion === "off") update();
  else window.setTimeout(update, 180);
}

archiveTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectArchive(tab.dataset.archive));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
    const next = (index + direction + archiveTabs.length) % archiveTabs.length;
    selectArchive(archiveTabs[next].dataset.archive, true);
  });
});

const trailSequence = [
  { src: "sample-assets/a01_t1final_p018.png", zh: "01 · 材料问题：切割图案", en: "Material question · kerf patterns" },
  { src: "sample-assets/a02_t1final_p022.png", zh: "02 · 材料试验：弯曲与扭转", en: "Material test · bending and twisting" },
  { src: "sample-assets/a04_t1final_p028.png", zh: "03 · 结构取舍：构型评价", en: "Structure decision · configuration evaluation" },
  { src: "sample-assets/a06_t2final_p022.png", zh: "04 · 交互行为：Awake状态", en: "Responsive behaviour · Awake state" },
  { src: "sample-assets/a07_t2final_p027.png", zh: "05 · 原型证据：竹构与网壳", en: "Prototype evidence · bamboo and gridshell" },
];
const trailField = document.querySelector("#trail-field");
let trailIndex = 0;
let lastTrailPoint = null;
let lastTrailTime = 0;

function addTrailCard(clientX, clientY) {
  if (document.documentElement.dataset.motion === "off" && trailField.querySelector(".trail-card")) return;
  const rect = trailField.getBoundingClientRect();
  const item = trailSequence[trailIndex % trailSequence.length];
  trailIndex += 1;
  const card = document.createElement("figure");
  card.className = "trail-card";
  const x = Math.min(rect.width - 95, Math.max(95, clientX - rect.left));
  const y = Math.min(rect.height - 75, Math.max(90, clientY - rect.top));
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
  card.style.setProperty("--z", String(trailIndex));
  card.innerHTML = `<img src="${item.src}" alt="" /><figcaption><strong>${item.zh}</strong><span lang="en">${item.en}</span><span>PDF整页导出 / full-page export</span></figcaption>`;
  trailField.append(card);
  const cards = [...trailField.querySelectorAll(".trail-card")];
  if (cards.length > 5) {
    cards[0].classList.add("is-leaving");
    window.setTimeout(() => cards[0].remove(), 320);
  }
}

trailField.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") {
    if (!lastTrailPoint) lastTrailPoint = { x: event.clientX, y: event.clientY };
    const distance = Math.hypot(event.clientX - lastTrailPoint.x, event.clientY - lastTrailPoint.y);
    if (distance < 54) return;
  } else {
    const now = performance.now();
    const distance = lastTrailPoint ? Math.hypot(event.clientX - lastTrailPoint.x, event.clientY - lastTrailPoint.y) : 999;
    if (distance < 82 || now - lastTrailTime < 160) return;
    lastTrailTime = now;
  }
  lastTrailPoint = { x: event.clientX, y: event.clientY };
  addTrailCard(event.clientX, event.clientY);
});
trailField.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "touch") addTrailCard(event.clientX, event.clientY);
});
document.querySelector(".story-trail").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  const rect = trailField.getBoundingClientRect();
  addTrailCard(rect.left + rect.width / 2 + ((trailIndex % 3) - 1) * 80, rect.top + rect.height / 2);
});

function parseMeasurementCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",");
  return lines.map((line) => Object.fromEntries(line.split(",").map((value, index) => [headers[index], value])));
}

let measurements = [];
const parameterGrid = document.querySelector("#parameter-grid");
const parameterSource = document.querySelector("#parameter-source");
const stateTabs = [...document.querySelectorAll("[data-state]")];

function renderState(state) {
  const records = measurements.filter((record) => record.state === state);
  for (const tab of stateTabs) tab.setAttribute("aria-selected", String(tab.dataset.state === state));
  if (!records.length) {
    parameterGrid.innerHTML = "<p>当前状态没有可读取的参数记录。</p>";
    return;
  }
  parameterGrid.innerHTML = records.map((record) => `<div><span>${record.parameter}</span><strong>${record.value}<small>${record.unit}</small></strong></div>`).join("");
  parameterSource.textContent = `来源：${records[0].source_document} · p${records[0].source_page}；原参数含义与测量日期待核。`;
}

fetch("data/measurements.csv", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  })
  .then((text) => {
    measurements = parseMeasurementCsv(text);
    renderState("Awake");
  })
  .catch(() => {
    parameterGrid.innerHTML = "<p>参数文件暂时无法读取；项目影像与其他章节仍可浏览。</p>";
  });

stateTabs.forEach((tab) => tab.addEventListener("click", () => renderState(tab.dataset.state)));

async function setupOptionalVideo() {
  const figure = document.querySelector("#hero-media");
  try {
    const response = await fetch("/api/project-media", { cache: "no-store" });
    if (!response.ok) return;
    const media = await response.json();
    if (!media.video_available || !media.video_url) return;
    const source = media.video_url;
    const frame = document.querySelector("#hero-media-frame");
    const video = document.createElement("video");
    video.src = source;
    video.poster = "sample-assets/a07_t2final_p027.png";
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = "metadata";
    const control = document.createElement("button");
    control.className = "video-control";
    control.type = "button";
    control.textContent = "暂停 / Pause";
    control.addEventListener("click", () => {
      if (video.paused) {
        video.play().catch(() => {});
        control.textContent = "暂停 / Pause";
      } else {
        video.pause();
        control.textContent = "播放 / Play";
      }
    });
    video.addEventListener("canplay", () => {
      frame.append(video, control);
      figure.classList.add("is-video");
      figure.querySelector("figcaption").innerHTML = '<span>项目视频 · 静音循环播放，可手动暂停。</span><span lang="en">Project video · muted loop with a pause control.</span>';
    }, { once: true });
    video.load();
  } catch {
    // Missing optional media intentionally leaves the real project-page fallback in place.
  }
}

setupOptionalVideo();
