// The example films everyone starts with: ten deliberately opposite styles, to show the range.
import { film as loud } from "./loud";
import { film as enso } from "./enso";
import { film as nightDrive } from "./night-drive";
import { film as heartbeat } from "./heartbeat";
import { film as helloShapes } from "./hello-shapes";
import { film as paleDot } from "./pale-dot";
import { film as shipIt } from "./ship-it";
import { film as flowField } from "./flow-field";
import { film as lastReel } from "./last-reel";
import { film as seasons } from "./seasons";

export type ExampleFilm = { id: string; title: string; aspect: "16:9" | "9:16" | "1:1"; duration: number; prompt: string; code: string };

export const SHOWCASE: ExampleFilm[] = [loud, enso, nightDrive, heartbeat, helloShapes, paleDot, shipIt, flowField, lastReel, seasons];
