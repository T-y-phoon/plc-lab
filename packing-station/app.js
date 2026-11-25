import { Playback, scenes, lastStep } from "./process.js";
import { choiceState, correctEnd, enableChoiceSound, leftIndex, loadedAt, missEnd, playChoiceSound, waitEnd } from "./left-choice.js";
import { productIndex, protectedState, protectedEnd, protectedAt, earlyReturnState, damageEnd } from "./product-choice.js";
import { ManualStation } from "./manual.js";
import { parts, partShortcuts, stages, preQuiz, postQuiz, acceptance } from "./content.js";

const one = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
function element(tag, text, attributes = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

const model = one("#viewer-template").content.firstElementChild.cloneNode(true);
const viewport = model.querySelector(".viewport");
let viewer, viewerPending, selectedPart, activeStage, activePage;


function selectPart(name) {
  selectedPart = name;
  const [title, description] = parts[name];
  model.querySelector("#part-info").replaceChildren(element("strong", title), element("p", description));
  for (const button of model.querySelectorAll("[data-part]")) {
    button.setAttribute("aria-pressed", String(button.dataset.part === name));
  }
  if (activePage === "prepare") viewer?.highlight(name);
}

for (const name of partShortcuts) {
  const button = element("button", parts[name][0], {
    class: "button", type: "button", "data-part": name, "aria-pressed": "false",
  });
  button.addEventListener("click", () => selectPart(name));
  model.querySelector("#part-buttons").append(button);
}
model.querySelector("[data-view=reset]").addEventListener("click", () => viewer.resetView());

const playback = new Playback();
const manual = new ManualStation();
let frame = 0, previousTime = 0, rate = 3;
let trial = null;
let cameraFrame = "overview";
const choices = all("[data-choice]");
const badge = model.querySelector(".choice-badge");
const leftDemo = () => activePage === "class" && activeStage === "steps";
const productDemo = () => activePage === "class" && activeStage === "ai-review";
const decisionIndex = () => leftDemo() ? leftIndex : productDemo() ? productIndex : undefined;
const awaitingChoice = () => !trial && playback.index === decisionIndex();
const isPlaying = () => trial ? trial.playing : playback.playing;
const branches = {
  "stop-first": { state: t => choiceState("stop-first", t), duration: correctEnd, evaluateAt: loadedAt,
    resumeAt: waitEnd, outcome: "loaded", badge: "✓ 正确 · 泡沫入箱",
    explanation: "正确。箱口保持在落料点下方，第一份泡沫入箱，计数加一。" },
  "feed-first": { state: t => choiceState("feed-first", t), duration: missEnd, evaluateAt: missEnd,
    outcome: "miss", badge: "✕ 错误 · 泡沫落在箱外",
    explanation: "错误。左行输出撤销得太晚，箱口已越过落料点。泡沫落在箱外的滚筒上，箱内仍是空的。" },
  "return-now": { state: earlyReturnState, duration: damageEnd, evaluateAt: damageEnd,
    outcome: "damage", badge: "✕ 模拟运输 · 顶层产品受损",
    explanation: "少了第 4 份泡沫。模拟运输中，裸露的顶层产品跳动、碰撞，电路板出现裂纹，元件移位。装箱计数仍是 3/3。" },
  "add-foam": { state: protectedState, duration: protectedEnd, evaluateAt: protectedAt, useRate: true,
    resumeAt: lastStep, outcome: "protected", badge: "✓ 正确 · 顶层泡沫已就位",
    explanation: "第 4 份泡沫盖住了第三件产品，形成顶部缓冲。装填达到 4/3，投后等待满 2 秒才回中。" },
};
const failedTrial = () => trial?.done && trial.branch.resumeAt === undefined;

function drawChoice() {
  const visible = awaitingChoice() || !!trial;
  one("#workstation-choice").hidden = !visible;
  one("#left-choice").hidden = !visible || !leftDemo();
  one("#product-choice").hidden = !visible || !productDemo();
  choices.forEach(button => {
    button.disabled = !viewer || !!trial;
    button.setAttribute("aria-pressed", String(button.dataset.choice === trial?.choice));
  });
  one("#choose-again").hidden = !trial?.done;
  const explanation = trial?.outcome ? trial.branch.explanation : "";
  const status = one("#choice-explanation");
  if (status.textContent !== explanation) status.textContent = explanation;
  badge.hidden = !trial?.outcome;
  if (trial?.outcome && badge.dataset.outcome !== trial.outcome) {
    badge.dataset.outcome = trial.outcome;
    badge.textContent = trial.branch.badge;
  }
  if (!trial?.outcome) delete badge.dataset.outcome;
  let frameType = "overview";
  if (visible && leftDemo()) frameType = "left";
  if (visible && productDemo() && trial?.choice !== "add-foam") frameType = "product";
  if (viewer && frameType !== cameraFrame) {
    if (frameType === "left") viewer.frameLeftStation();
    else if (frameType === "product") viewer.frameProduct();
    else viewer.resetView();
    cameraFrame = frameType;
  }
}
const controls = Object.fromEntries(["play", "step", "replay", "reset-demo", "speed",
  "phase-name", "layer-count", "transport-mode", "phase-timer", "total-timer"].map(id =>
    [id, model.querySelector("#" + id)]));
const signalGroups = {
  position: { Left: "左限位", Center: "中间检测", Right: "右限位" },
  output: { leftDrive: "左行输出", rightDrive: "右行输出", Foam: "投泡沫", Product: "投产品" },
  mode: { Auto: "运行灯", Manual: "手动运行灯", Stop: "停止灯" },
};
const indicators = Object.entries(signalGroups).flatMap(([group, names]) => {
  const row = model.querySelector(`[data-signals="${group}"]`);
  return Object.entries(names).map(([key, title]) => {
    const chip = element("span", title, { "data-signal": key });
    row.append(chip);
    return [key, chip, title];
  });
});

const manualPanel = model.querySelector("#manual-controls");
const manualNotice = manualPanel.querySelector("#manual-notice");
const manualStack = manualPanel.querySelector("#manual-stack");
const jogButtons = [...manualPanel.querySelectorAll("[data-jog]")];
const manualJogRate = 1.5;
const manualFeedRate = 2;
let manualFrame = 0;
let manualTime = 0;
let jogInput = null;

function drawManual() {
  const state = manual.state;
  drawReadout(state, "手动模式");
  const order = manual.stack.map(kind => kind === "Foam" ? "泡沫" : "产品").join(" → ");
  manualStack.textContent = "箱内从下到上　" + (order || "空箱");
  if (manualNotice.textContent !== manual.notice) manualNotice.textContent = manual.notice;
  jogButtons.forEach(button => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.jog) === manual.direction));
  });
}

function tickManual(now) {
  manualFrame = 0;
  const seconds = Math.max(0, now - manualTime) / 1000;
  const rate = manual.direction ? manualJogRate : manualFeedRate;
  manual.advance(seconds * rate);
  manualTime = now;
  drawManual();
  if (manual.direction || manual.job) manualFrame = requestAnimationFrame(tickManual);
}

function runManual() {
  drawManual();
  if (!manualFrame && (manual.direction || manual.job)) {
    manualTime = performance.now();
    manualFrame = requestAnimationFrame(tickManual);
  }
}

function stopJog() {
  jogInput = null;
  if (!manual.direction) return;
  manual.direction = 0;
  drawManual();
}

for (const button of jogButtons) {
  const direction = Number(button.dataset.jog);
  button.addEventListener("pointerdown", event => {
    if (!viewer || activePage !== "prepare" || jogInput || event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    jogInput = { button, pointer: event.pointerId };
    manual.jog(direction);
    runManual();
  });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(eventName, event => {
      if (jogInput?.button === button && jogInput.pointer === event.pointerId) stopJog();
    });
  }
  button.addEventListener("keydown", event => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!viewer || activePage !== "prepare" || jogInput || event.repeat) return;
    jogInput = { button, key: event.key };
    manual.jog(direction);
    runManual();
  });
  button.addEventListener("keyup", event => {
    if (jogInput?.button === button && jogInput.key === event.key) stopJog();
  });
  button.addEventListener("blur", () => {
    if (jogInput?.button === button) stopJog();
  });
}
window.addEventListener("blur", stopJog);
manualPanel.querySelectorAll("[data-feed]").forEach(button => {
  button.onclick = () => {
    if (!viewer || activePage !== "prepare") return;
    manual.feed(button.dataset.feed);
    runManual();
  };
});
manualPanel.querySelector("#inspect-carton").onclick = () => {
  if (!viewer || activePage !== "prepare") return;
  manual.inspect();
  drawManual();
};
manualPanel.querySelector("#clear-carton").onclick = () => {
  if (!viewer || activePage !== "prepare") return;
  stopJog();
  manual.reset();
  drawManual();
};

function setManualMode(enabled) {
  manualPanel.hidden = !enabled;
  model.querySelector(".playback-controls").hidden = enabled;
  for (const [key, chip] of indicators) {
    if (key === "Manual") chip.hidden = !enabled;
    if (key === "Auto") chip.hidden = enabled;
  }
}

function drawReadout(state, mode, label = state.label) {
  viewer?.setState(state);
  controls["phase-name"].textContent = label;
  controls["layer-count"].textContent = `泡沫 ${state.foam} / 4　产品 ${state.product} / 3`;
  controls["transport-mode"].textContent = mode;
  controls["phase-timer"].textContent = state.shippingTime > 0 ? `模拟运输 ${state.shippingTime.toFixed(1)} s` : state.duration
    ? `本步 ${state.elapsed.toFixed(1)} / ${state.duration.toFixed(1)} s` : activePage === "prepare" ? "" : "步序边界";
  controls["total-timer"].textContent = activePage === "prepare" ? "" : `工艺时钟 ${state.time.toFixed(1)} s`;
  const active = new Set([...state.sensors, ...state.lamps]);
  if (state.direction) active.add(state.direction === "左行" ? "leftDrive" : "rightDrive");
  for (const [key, chip, title] of indicators) {
    const on = active.has(key);
    if (chip.dataset.on !== String(on)) {
      chip.dataset.on = String(on);
      chip.textContent = title + (on ? " 1" : " 0");
    }
  }
}

function drawPlayback() {
  drawChoice();
  const state = trial ? trial.branch.state(trial.elapsed) : playback.state;
  const label = awaitingChoice()
    ? (leftDemo() ? "左限位刚触发，请选择动作顺序" : "第三件产品投完，请选择去向") : state.label;
  const mode = isPlaying() ? (trial && !trial.branch.useRate ? "选择演示 · 原速" : "播放中") :
    state.kind === "idle" ? "待启动" : state.kind === "done" ? "已结束" : "演示已暂停";
  drawReadout(state, mode, label);
  const finished = state.index === lastStep;
  const blocked = awaitingChoice() || failedTrial();
  controls.play.textContent = isPlaying() ? "暂停" : awaitingChoice() ? "等待选择" :
    blocked ? "请重新选择" :
    state.kind === "idle" ? "开始演示" : finished ? "本箱结束" : "继续";
  controls.play.disabled = !viewer || finished || blocked;
  controls.step.disabled = !viewer || finished || blocked || (!!trial && !trial.done);
  controls.speed.disabled = !!trial && !trial.branch.useRate && !trial.done;
  controls.replay.disabled = !viewer;
}
function cancelClock() {
  cancelAnimationFrame(frame);
  playback.playing = false;
  if (trial) trial.playing = false;
}
function advanceClock(now) {
  const seconds = Math.max(0, now - previousTime) / 1000;
  previousTime = now;
  if (trial) {
    const branch = trial.branch;
    const amount = seconds * (branch.useRate ? rate : 1);
    trial.elapsed = Math.min(branch.duration, trial.elapsed + amount);
    if (!trial.outcome && trial.elapsed >= branch.evaluateAt) {
      trial.outcome = branch.outcome;
      playChoiceSound(branch.resumeAt !== undefined);
    }
    if (trial.elapsed === branch.duration) {
      trial.done = true;
      trial.playing = false;
      if (branch.resumeAt !== undefined) playback.seek(branch.resumeAt);
    }
  } else {
    playback.advance(seconds * rate, decisionIndex());
  }
  drawPlayback();
}
function tick(now) {
  if (now - previousTime >= 32) advanceClock(now);
  if (isPlaying()) frame = requestAnimationFrame(tick);
}
function startClock() {
  if (activePage !== "class" || awaitingChoice() || failedTrial()) return;
  if (trial?.done) trial = null;
  if (trial) trial.playing = true;
  else playback.play();
  previousTime = performance.now();
  drawPlayback();
  if (isPlaying()) frame = requestAnimationFrame(tick);
}
function seek(index) {
  cancelClock();
  trial = null;
  playback.seek(index);
  drawPlayback();
}
choices.forEach(button => button.addEventListener("click", () => {
  if (!viewer || !awaitingChoice()) return;
  enableChoiceSound();
  trial = { choice: button.dataset.choice, branch: branches[button.dataset.choice], elapsed: 0, playing: false, done: false, outcome: null };
  if (matchMedia("(max-width: 840px)").matches) viewport.scrollIntoView({block: "start"});
  startClock();
}));
one("#choose-again").onclick = () => {
  seek(decisionIndex());
  choices.find(button => !button.parentElement.hidden).focus({preventScroll: true});
};
controls.speed.onchange = () => {
  if (isPlaying()) advanceClock(performance.now());
  rate = Number(controls.speed.value);
};
controls.play.onclick = () => {
  if (!isPlaying()) return startClock();
  advanceClock(performance.now());
  cancelClock();
  drawPlayback();
};
controls.step.onclick = () => {
  cancelClock();
  trial = null;
  playback.step();
  drawPlayback();
};
function resetDemo() {
  seek(0);
}
controls.replay.onclick = () => { resetDemo(); startClock(); };
controls["reset-demo"].onclick = resetDemo;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopJog();
    cancelAnimationFrame(manualFrame);
    manualFrame = 0;
    if (isPlaying()) { cancelClock(); drawPlayback(); }
  } else if (activePage === "prepare") runManual();
});

function mountViewer(target) {
  if (model.parentElement !== target) target.append(model);
  if (viewer) viewer.highlight(activePage === "prepare" ? selectedPart : null);
  if (viewerPending) return;
  viewerPending = import("./viewer.js").then(({ createStationViewer }) =>
    createStationViewer(viewport.querySelector(".scene-canvas"), selectPart, new Set(Object.keys(parts)))
  ).then(instance => {
    viewer = instance;
    if (activePage === "prepare") drawManual();
    else drawPlayback();
    viewport.querySelector("img").hidden = true;
    viewport.querySelector(".viewer-status").hidden = true;
    model.dataset.ready = "true";
    for (const button of model.querySelectorAll("[data-view], #manual-controls button")) button.disabled = false;
  }).catch(error => {
    console.error(error);
    viewport.querySelector(".viewer-status").textContent = "三维加载失败，请在支持 WebGL 的浏览器中打开本地网址";
  });
}

const classURL = (id, scene) => "#class/" + id + (scene ? "/" + scene : "");
const verification = {
  id: "verify", scene: "start", title: "完整工序核验", demo: "完整工序核验",
  question: "从空箱开始，逐步核对动作、转换条件和去向。",
};
const demos = [...stages.filter(stage => stage.demo), verification];
const stageLinks = demos.map(stage => {
  const link = element("a", undefined, { href: classURL(stage.id) });
  link.textContent = stage.demo;
  one("#stage-nav").append(link);
  return link;
});
const flowchartLink = element("a", "Markdown 流程图工具", { href: "#class/flowchart" });
one("#stage-nav").append(flowchartLink);
function toggleProjection(enabled) {
  document.body.classList.toggle("projection", enabled);
  one("#projection").textContent = enabled ? "退出投屏视图" : "进入投屏视图";
  one("#projection").setAttribute("aria-pressed", String(enabled));
}
one("#projection").addEventListener("click", () => toggleProjection(!document.body.classList.contains("projection")));

function renderClass(stage, sceneName, focus) {
  const stageChanged = activeStage !== stage.id;
  activeStage = stage.id;
  one("#stage-title").textContent = stage.title;
  one("#stage-question").textContent = stage.question;
  one("#verify-guide").hidden = stage.id !== "verify";
  mountViewer(one("#class-viewer"));
  seek(scenes[sceneName].index);
  if (focus && stageChanged) one("#stage-title").focus();
}

function route(focus = true) {
  const [key, stageId, sceneId] = location.hash.slice(1).split("/");
  if (key === "main") return;
  const page = ["prepare", "class", "practice"].includes(key) ? key : "home";
  const pageChanged = activePage !== page;
  const flowchartOnly = page === "class" && stageId === "flowchart";
  if (activePage === "prepare" && pageChanged) {
    stopJog();
    cancelAnimationFrame(manualFrame);
    manualFrame = 0;
    manual.job = null;
  }
  cancelClock();
  trial = null;
  activePage = page;
  setManualMode(page === "prepare");
  for (const section of all("[data-page]")) section.hidden = section.dataset.page !== page;
  for (const link of all(".top nav a")) {
    if (link.hash === "#" + page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (page === "class") {
    const requestedDemo = demos.find(item => item.id === stageId);
    const stage = requestedDemo || (stageId === "review" ? demos[1] : demos[0]);
    one("#class-demonstration").hidden = flowchartOnly;
    one("#flowchart-tool").hidden = !flowchartOnly;
    one("#projection").hidden = flowchartOnly;
    if (flowchartOnly) {
      toggleProjection(false);
      activeStage = undefined;
      flowchartLink.setAttribute("aria-current", "page");
      for (const link of stageLinks) link.removeAttribute("aria-current");
      window.scrollTo(0, 0);
    } else {
      flowchartLink.removeAttribute("aria-current");
      for (const [i, link] of stageLinks.entries()) {
        if (demos[i] === stage) link.setAttribute("aria-current", "step");
        else link.removeAttribute("aria-current");
      }
      if (pageChanged || !activeStage) {
        if (new URLSearchParams(location.search).has("project")) toggleProjection(true);
      }
      renderClass(stage, requestedDemo && Object.hasOwn(scenes, sceneId) ? sceneId : stage.scene, focus && !pageChanged);
    }
  } else {
    toggleProjection(false);
    if (page === "prepare") {
      mountViewer(one("#prepare-viewer"));
      drawChoice();
      drawManual();
    }
  }
  if (pageChanged) {
    window.scrollTo(0, 0);
    if (focus) (one(`[data-page="${page}"] h1[tabindex]`) || one("#main")).focus({ preventScroll: true });
  }
  if (flowchartOnly && focus) one("#flowchart-title").focus({ preventScroll: true });
  if (page === "practice" && stageId) {
    const heading = all("[data-practice-section]").find(item => item.dataset.practiceSection === stageId);
    if (heading) {
      heading.scrollIntoView();
      if (focus) heading.focus({ preventScroll: true });
    }
  }
}
one(".skip").addEventListener("click", event => {
  event.preventDefault();
  one("#main").focus();
});
window.addEventListener("hashchange", () => route());

function setupQuiz(form, questions) {
  for (const [index, [topic, question, choices]] of questions.entries()) {
    const group = element("fieldset");
    group.append(element("legend", `${index + 1}. ${topic} · ${question}`));
    for (const [value, label] of choices.entries()) {
      const line = element("label");
      line.append(element("input", undefined, {
        type: "radio", name: "q" + index, value, required: "",
      }), element("span", label));
      group.append(line);
    }
    group.append(element("p", "", { class: "feedback", hidden: "" }));
    form.append(group);
  }
  const submit = element("button", "提交测验", { class: "button primary", type: "submit" });
  const retry = element("button", "重新作答", { class: "button", type: "reset", hidden: "" });
  const score = element("p", "", { class: "score", role: "status", tabindex: "-1" });
  const groups = [...form.querySelectorAll("fieldset")];
  form.append(submit, retry, score);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(form);
    let total = 0;
    questions.forEach(([, , choices, answer, reason], index) => {
      const correct = Number(data.get("q" + index)) === answer;
      total += Number(correct);
      const feedback = groups[index].querySelector(".feedback");
      feedback.textContent = `${correct ? "答对。" : "答错。"}正确选项是“${choices[answer]}”。${reason}`;
      feedback.hidden = false;
      groups[index].disabled = true;
    });
    score.textContent = `得分 ${total} / ${questions.length}`;
    score.focus();
    submit.hidden = true;
    retry.hidden = false;
  });
  form.addEventListener("reset", () => {
    for (const group of groups) {
      group.disabled = false;
      group.querySelector(".feedback").hidden = true;
    }
    score.textContent = "";
    submit.hidden = false;
    retry.hidden = true;
    groups[0].querySelector("input").focus();
  });
}

setupQuiz(one("#pre-quiz"), preQuiz);
setupQuiz(one("#post-quiz"), postQuiz);

const columns = ["实际", "问题", "修订"];
const recordFields = acceptance.map(([label, expected]) => {
  const group = element("fieldset", undefined, { class: "record-row" });
  const grid = element("div", undefined, { class: "record-grid" });
  group.append(element("legend", label), element("p", "预期　" + expected), grid);
  const inputs = columns.map(column => {
    const wrapper = element("label", column);
    const input = element("textarea", undefined, { rows: "2", "aria-label": label + " " + column });
    wrapper.append(input);
    grid.append(wrapper);
    return input;
  });
  one("#acceptance").append(group);
  return inputs;
});
one("#export-record").addEventListener("click", () => {
  const rows = [["验收项", "预期", ...columns], ...acceptance.map(([label, expected], index) =>
    [label, expected, ...recordFields[index].map(input => input.value)])];
  function escapeCell(value) {
    const text = /^\s*[=+@-]/.test(value) ? "'" + value : value;
    return '"' + text.replaceAll('"', '""') + '"';
  }
  const blob = new Blob(["\uFEFF", rows.map(row => row.map(escapeCell).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = element("a", undefined, { href: url, download: "联调仿真记录.csv" });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
route(false);
