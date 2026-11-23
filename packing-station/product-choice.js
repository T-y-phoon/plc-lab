// Shipping damage is a teaching example after the carton has stopped at center.
import { checkpoints, lastStep, positions, snapshot } from "./process.js";

export const productIndex = checkpoints.get("product-3");
const initial = snapshot(productIndex);
const final = snapshot(lastStep);
const returnTime = snapshot(checkpoints.get("center") - 1).duration;
const inspectionTime = 1;
const vibrationTime = 2.4;
export const damageEnd = returnTime + inspectionTime + vibrationTime;
export const protectedEnd = final.time - initial.time;
export const protectedAt = snapshot(checkpoints.get("foam-4")).time - initial.time;

export function protectedState(elapsed) {
  const now = initial.time + elapsed;
  for (let index = productIndex; index < lastStep; index++) {
    const step = snapshot(index);
    if (now < step.start + step.duration) return snapshot(index, now - step.start);
  }
  return final;
}

export function earlyReturnState(elapsed) {
  const moving = elapsed < returnTime;
  const travel = Math.min(elapsed / returnTime, 1);
  const x = positions.Right * (1 - travel);
  const shippingTime = Math.max(0, elapsed - returnTime - inspectionTime);
  const impact = Math.min(shippingTime / vibrationTime, 1);
  let label = "提前回中 · 第三件产品上方没有泡沫";
  if (!moving) label = "回中停车 · 检查箱内顶层";
  if (shippingTime > 0) label = "模拟运输颠簸 · 观察顶层电路板";
  if (impact === 1) label = "模拟运输结果 · 顶层电路板受损";
  return { ...initial, label, station: moving ? "Right" : "Center",
    direction: moving ? "左行" : "", positionX: x,
    sensors: moving ? (positions.Right - x < .045 ? ["Right"] : []) : ["Center"],
    lamps: moving ? ["Auto", "Conveyor"] : ["Stop"],
    duration: moving ? returnTime : 0, elapsed: moving ? elapsed : 0,
    time: initial.time + Math.min(elapsed, returnTime), shippingTime, impact };
}
