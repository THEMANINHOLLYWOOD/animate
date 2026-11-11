// The example films everyone starts with: deliberately opposite styles, to show the range.
import { film as launch } from "./launch";
import { film as noiseLab } from "./noise-lab";
import { film as waterCycle } from "./water-cycle";
import { film as thermopylae } from "./thermopylae";
import { film as wordMosaic } from "./word-mosaic";
import { film as inca } from "./inca";
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

export const SHOWCASE: ExampleFilm[] = [launch, noiseLab, inca, waterCycle, thermopylae, wordMosaic, loud, enso, nightDrive, heartbeat, helloShapes, paleDot, shipIt, flowField, lastReel, seasons];
