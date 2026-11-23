// Both choices start at the same left limit. The normal trial samples the production timeline.
import { checkpoints, snapshot } from "./process.js";

export const leftIndex = checkpoints.get("left");
export const firstLoad = checkpoints.get("foam-1");
export const waitEnd = firstLoad + 1;
const arrival = snapshot(leftIndex);
const feed = snapshot(leftIndex + 1);
const loaded = snapshot(firstLoad);
export const loadedAt = arrival.duration + feed.duration;
export const correctEnd = loadedAt + loaded.duration;
export const missEnd = feed.duration;

export function choiceState(choice, elapsed) {
  if (choice === "stop-first") {
    if (elapsed < arrival.duration) return snapshot(leftIndex, elapsed);
    if (elapsed < loadedAt) return snapshot(leftIndex + 1, elapsed - arrival.duration);
    if (elapsed < correctEnd) return snapshot(firstLoad, elapsed - loadedAt);
    return snapshot(waitEnd);
  }
  // Counterexample: the left drive stays on during release. The moving carton
  // clears the drop axis; the foam catches its rim, slides off and rests on the rollers.
  const progress = Math.min(elapsed / missEnd, 1);
  const travel = Math.min(elapsed / 1.2, 1);
  const moving = travel < 1;
  const offset = .38 * travel;
  return { ...arrival, label: moving ? "泡沫已释放，箱体仍在左行" :
      progress < 1 ? "箱体停晚了，泡沫滑过箱沿" : "泡沫落在箱外，装箱计数为 0",
    elapsed, duration: missEnd, time: arrival.time + elapsed, progress, missedDrop: progress,
    positionX: arrival.positionX - offset, direction: moving ? "左行" : "",
    sensors: offset < .045 ? ["Left"] : [],
    lamps: [...(progress < 1 ? ["Auto", "Foam"] : ["Stop"]), ...(moving ? ["Conveyor"] : [])] };
}

// Unlock audio on the student's click, then play one short cue at the landing.
let context;
export function enableChoiceSound() {
  try {
    context ??= new AudioContext();
    if (context.state !== "running") context.resume().catch(() => {});
  } catch { /* The visual feedback also works on devices without audio. */ }
}
export function playChoiceSound(correct) {
  if (context?.state !== "running") return;
  const now = context.currentTime;
  const notes = correct ? [523.25, 659.25, 783.99] : [293.66, 196];
  notes.forEach((hz, i) => {
    const tone = context.createOscillator();
    const gain = context.createGain();
    const start = now + i * .13;
    tone.type = correct ? "sine" : "triangle";
    tone.frequency.value = hz;
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(.13, start + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, start + .19);
    tone.connect(gain).connect(context.destination);
    tone.start(start);
    tone.stop(start + .20);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
  });
}
