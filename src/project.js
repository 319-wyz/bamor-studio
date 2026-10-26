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
    source: "木板切缝形变试验",
    english: "Eleven kerf-pattern families compared through deformation tests.",
  },
  bending: {
    src: "sample-assets/a02_t1final_p022.png",
    alt: "切割图案弯曲与扭转比较项目页",
    title: "弯曲、扭转与水平弯曲比较",
    source: "弯曲、扭转与水平弯曲比较",
    english: "A comparison of vertical bending, twisting and horizontal bending.",
  },
  legs: {
    src: "sample-assets/a03_t1final_p024.png",
    alt: "两支腿、三支腿和四支腿构型原型项目页",
    title: "2 / 3 / 4支腿构型原型",
    source: "构型与支撑方式原型",
    english: "Physical configuration studies shown as two-, three- and four-leg units.",
  },
  evaluation: {
    src: "sample-assets/a04_t1final_p028.png",
    alt: "2支腿、3支腿和4支腿构型多维评价表项目页",
    title: "构型多维评价表",
    source: "十一项构型对照",
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
  { src: "sample-assets/a03_t1final_p024.png", alt: "两支腿、三支腿与四支腿的早期构型原型", zh: "问题与目标", description: "早期构型原型将空间需求转化为可搭建的支撑问题。" },
  { src: "sample-assets/a02_t1final_p022.png", alt: "切缝图案的弯曲与扭转比较", zh: "材料试验", description: "切缝图案比较材料在弯曲、扭转与水平弯曲中的形变差异。" },
  { src: "sample-assets/a04_t1final_p028.png", alt: "两支腿、三支腿与四支腿构型评价表", zh: "结构取舍", description: "构型对照把支撑、稳定与空间关系放进同一组设计判断。" },
  { src: "sample-assets/a08_t2final_p030.png", alt: "Unity三维交互界面与状态控制", zh: "交互行为", description: "数字界面组织视角、环境输入、行为状态与颜色配置。" },
  { src: "sample-assets/a07_t2final_p027.png", alt: "竹构与网格壳体研究原型", zh: "原型证据", description: "竹构与网格壳体研究原型连接材料、构型和现场展示。" },
];
const trailField = document.querySelector("#trail-field");
const trailPreview = document.querySelector("#trail-preview");
const trailImage = document.querySelector("#trail-image");
const trailCaption = document.querySelector("#trail-caption");
const trailDescription = document.querySelector("#trail-description");
const trailButtons = [...document.querySelectorAll("[data-trail-stage]")];
let activeTrailStage = 0;

function selectTrailStage(index, focus = false) {
  const nextIndex = Math.max(0, Math.min(trailSequence.length - 1, index));
  if (nextIndex === activeTrailStage && trailPreview.dataset.ready === "true") return;
  const item = trailSequence[nextIndex];
  activeTrailStage = nextIndex;
  trailPreview.classList.add("is-switching");
  const update = () => {
    trailImage.src = item.src;
    trailImage.alt = item.alt;
    trailCaption.textContent = item.zh;
    trailDescription.textContent = item.description;
    trailPreview.style.setProperty("--trail-left", `${(nextIndex + 0.5) * 20}%`);
    trailPreview.dataset.ready = "true";
    trailPreview.classList.remove("is-switching");
    trailButtons.forEach((button, buttonIndex) => {
      if (buttonIndex === nextIndex) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    if (focus) trailButtons[nextIndex].focus();
  };
  if (document.documentElement.dataset.motion === "off") update();
  else window.setTimeout(update, 90);
}

function trailIndexFromPointer(clientX) {
  const rect = trailField.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.max(0, Math.min(4, Math.ceil(ratio * 5) - 1));
}

trailField.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "touch") selectTrailStage(trailIndexFromPointer(event.clientX));
});
trailField.addEventListener("pointerdown", (event) => selectTrailStage(trailIndexFromPointer(event.clientX)));
trailButtons.forEach((button, index) => {
  button.addEventListener("focus", () => selectTrailStage(index));
  button.addEventListener("click", () => selectTrailStage(index));
  button.addEventListener("keydown", (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    selectTrailStage((index + direction + trailButtons.length) % trailButtons.length, true);
  });
});
selectTrailStage(0);

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
  parameterSource.textContent = `${state} 行为状态研究；原参数含义与测量日期待核。`;
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
