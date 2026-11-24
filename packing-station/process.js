// Teaching timeline. All durations below are process seconds. Travel time is illustrative.
export const positions = { Left: -1.45, Center: 0, Right: 1.45 };
const phases = [];
export const checkpoints = new Map();
let clock = 0, station = "Center", foam = 0, product = 0;
function add(kind, label, duration, extra = {}) {
  const phase = { kind, label, duration, start: clock, station, foam, product, ...extra };
  if (phase.key) checkpoints.set(phase.key, phases.length);
  phases.push(phase);
  clock += duration;
}
function travel(to, label) {
  const distance = Math.abs(positions[to] - positions[station]);
  add("move", label, distance / .725, { to });
  station = to;
}
add("idle", "中间空箱就位，等待启动", 0, { key: "start" });
for (let event = 1; event <= 7; event++) {
  const isFoam = event % 2 === 1;
  const side = isFoam ? "左" : "右";
  const material = isFoam ? "Foam" : "Product";
  const item = isFoam ? `第 ${foam + 1} 份泡沫` : `第 ${product + 1} 件产品`;
  travel(isFoam ? "Left" : "Right", side + "行至" + side + "限位");
  add("before", side + "限位触发，停车并到站等待", 2, { key: event === 1 ? "left" : event === 2 ? "right" : undefined });
  add("feed", "投放" + item, isFoam ? 3 : 5, { material });
  if (isFoam) foam++;
  else product++;
  add("after", item + "投完，投后等待", 2, { key: (isFoam ? "foam-" + foam : "product-" + product) });
  add("branch", "投后等待已满，检查下一步", 0);
}
travel("Center", "末次等待完成，右行回中");
for (let cycle = 1; cycle <= 10; cycle++) {
  add("blink", `回中停车 · 完成提示 ${cycle}/10（亮）`, 1,
    { lit: true, cycle, key: cycle === 1 ? "center" : undefined });
  add("blink", `回中停车 · 完成提示 ${cycle}/10（灭）`, 1, { lit: false, cycle });
}
add("done", "本箱作业结束", 0, { key: "done" });

export const lastStep = phases.length - 1;
export const scenes = Object.fromEntries([
  ["start", "空箱就位"], ["left", "左限位刚触发"], ["right", "右限位刚触发"], ["foam-3", "第 3 份泡沫投完"],
  ["product-3", "第 3 件产品投完"], ["foam-4", "第 4 份泡沫投完"], ["center", "回中停车"], ["done", "本箱作业结束"],
].map(([key, title]) => [key, { title, index: checkpoints.get(key) }]));

export function snapshot(index, elapsed = 0) {
  const phase = phases[index];
  const progress = phase.duration ? Math.min(elapsed / phase.duration, 1) : 0;
  const moving = phase.kind === "move";
  let x = positions[phase.station];
  let direction = "";
  if (moving) {
    const delta = positions[phase.to] - x;
    x += delta * progress;
    direction = delta > 0 ? "右行" : "左行";
  }
  // The target switch changes on the arrival boundary that also cuts the drive.
  // A departing switch or the center switch passed in transit has a sensing width.
  const sensors = Object.keys(positions).filter(name =>
    !(moving && name === phase.to) && Math.abs(positions[name] - x) < .045);
  const stopped = phase.kind === "idle" || phase.kind === "done";
  const lamps = [];
  if (stopped) lamps.push("Stop");
  else if (phase.kind !== "blink" || phase.lit) lamps.push("Auto");
  if (moving) lamps.push("Conveyor");
  if (phase.material) lamps.push(phase.material);
  return { ...phase, index, elapsed, time: phase.start + elapsed, positionX: x, progress,
    direction, sensors, lamps };
}

export class Playback {
  index = 0;
  elapsed = 0;
  playing = false;
  get state() { return snapshot(this.index, this.elapsed); }
  seek(index) {
    this.index = index;
    this.elapsed = 0;
    this.playing = false;
  }
  step() { this.seek(Math.min(this.index + 1, lastStep)); }
  play() {
    if (this.index === 0) this.step();
    this.playing = this.index < lastStep;
  }
  advance(seconds, breakAt) {
    while (this.playing) {
      const left = phases[this.index].duration - this.elapsed;
      if (seconds < left) {
        this.elapsed += seconds;
        return;
      }
      seconds -= left;
      this.index++;
      this.elapsed = 0;
      if (this.index === lastStep || this.index === breakAt) this.playing = false;
    }
  }
}
