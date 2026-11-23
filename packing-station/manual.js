import { positions } from "./process.js";

const materials = {
  Foam: { name: "泡沫", station: "Left", stationName: "左侧泡沫工位", duration: 3, capacity: 4 },
  Product: { name: "产品", station: "Right", stationName: "右侧产品工位", duration: 5, capacity: 3 },
};
const speed = .725;

export class ManualStation {
  constructor() { this.reset(); }

  reset() {
    this.position = positions.Center;
    this.direction = 0;
    this.stack = [];
    this.counts = { Foam: 0, Product: 0 };
    this.job = null;
    this.notice = "";
  }

  get station() {
    return Object.keys(positions).find(name => {
      const x = positions[name];
      const approachingEnd = x !== 0 && Math.sign(x) === this.direction;
      // The center beam stays covered for part of the carton width.
      const sensingRange = name === "Center" ? .15 : .045;
      return !approachingEnd && Math.abs(x - this.position) < sensingRange;
    });
  }

  get state() {
    const moving = !!this.direction;
    const job = this.job;
    const place = { Left: "左限位", Center: "中间检测", Right: "右限位" }[this.station] || "工位之间";
    return {
      station: "Center", positionX: this.position, sensors: this.station ? [this.station] : [],
      direction: moving ? this.direction < 0 ? "左行" : "右行" : "",
      foam: this.counts.Foam, product: this.counts.Product, stack: this.stack,
      material: job?.kind, progress: job ? job.elapsed / job.duration : 0,
      duration: job?.duration || 0, elapsed: job?.elapsed || 0,
      lamps: moving ? ["Conveyor", "Manual"] : job ? [job.kind, "Manual"] : ["Stop"],
      label: moving ? (this.direction < 0 ? "手动左行" : "手动右行") :
        job ? "手动投放" + materials[job.kind].name : place + " · 已停车",
    };
  }

  jog(direction) {
    if (this.job) {
      this.notice = "投料正在进行，等物料落稳后再移动箱子。";
      return;
    }
    if (this.direction) return;
    if (this.position === (direction < 0 ? positions.Left : positions.Right)) {
      this.notice = "已到端部限位。可向相反方向离开。";
      return;
    }
    this.notice = "";
    this.direction = direction;
  }

  feed(kind) {
    const material = materials[kind];
    if (this.direction || this.job) {
      this.notice = "箱体和投料机构都停稳后，才能发出下一次投料指令。";
    } else if (this.station !== material.station) {
      this.notice = "投放" + material.name + "前，请把箱子停在" + material.stationName + "。";
    } else if (this.counts[kind] === material.capacity) {
      this.notice = material.name + "已用完。可回中验箱，或换空箱重试。";
    } else {
      this.position = positions[material.station];
      this.notice = "";
      this.job = { kind, duration: material.duration, elapsed: 0 };
    }
  }

  advance(seconds) {
    if (this.direction) {
      this.position += this.direction * speed * seconds;
      const limit = this.direction < 0 ? positions.Left : positions.Right;
      if (this.direction * (this.position - limit) >= 0) {
        this.position = limit;
        this.direction = 0;
        this.notice = "端部限位有效，输送线已停止。";
      }
    } else if (this.job) {
      const { kind, duration } = this.job;
      const delta = Math.min(seconds, duration - this.job.elapsed);
      this.job.elapsed += delta;
      if (this.job.elapsed >= duration) {
        this.stack.push(kind);
        this.counts[kind]++;
        this.job = null;
        this.notice = materials[kind].name + "已入箱，本次计数加一。";
      }
    }
  }

  inspect() {
    if (this.direction || this.job || this.station !== "Center") {
      this.notice = "请结束投料，点动箱子到中间检测亮起，松开按钮后再验箱。";
      return;
    }
    if (!this.stack.length) {
      this.notice = "箱内还是空的。";
      return;
    }
    const issues = [];
    if (this.counts.Foam !== 4 || this.counts.Product !== 3) issues.push("数量未达到 4 份泡沫、3 件产品");
    if (this.stack[0] === "Product") issues.push("底层产品缺少泡沫缓冲");
    if (this.stack.at(-1) === "Product") issues.push("顶层产品裸露，运输碰撞时容易受损");
    if (this.stack.some((kind, i) => i > 0 && kind === "Product" && this.stack[i - 1] === "Product")) {
      issues.push("相邻产品之间缺少泡沫隔层");
    }
    if (this.stack.some((kind, i) => i > 0 && kind === "Foam" && this.stack[i - 1] === "Foam")) {
      issues.push("两份泡沫叠在同一处，装填顺序未交替");
    }
    this.notice = issues.length ? "验箱发现：" + issues.join("。") + "。" :
      "验箱通过。首尾有泡沫，三件产品之间也有泡沫隔层。";
  }
}
