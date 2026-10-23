// Which split text goes back to the code. The code skips text by its copy (every movable draw of a
// string not kept), so dropping a layer sends its copy back to the code, and with it every other
// layer that shares any of that copy (else the code would paint it as well as the layer).

export function dropper(strs: Set<string>[], keep: Set<string>) {
  const by = new Map<string, number[]>();
  strs.forEach((set, k) => {
    for (const s of set) {
      const list = by.get(s);
      if (list) list.push(k);
      else by.set(s, [k]);
    }
  });
  const dropped = new Set<number>();
  // Drop layer k and everything that has to go with it; returns the layers newly dropped.
  const drop = (k: number): number[] => {
    const gone: number[] = [];
    const stack = [k];
    while (stack.length) {
      const j = stack.pop()!;
      if (dropped.has(j)) continue;
      dropped.add(j);
      gone.push(j);
      for (const s of strs[j]) {
        if (keep.has(s)) continue; // every layer with it is already dropped or on the stack
        keep.add(s);
        for (const x of by.get(s) ?? []) if (!dropped.has(x)) stack.push(x);
      }
    }
    return gone;
  };
  return { dropped, drop };
}

// Layers in the order the code paints their text: a topological order of "painted before" (consecutive
// draws within a frame), ties and any cycles broken by first appearance (the lower id).
export function paintOrder(ids: number[], frames: number[][]): number[] {
  const live = new Set(ids);
  const next = new Map<number, Set<number>>();
  const indeg = new Map<number, number>(ids.map((k) => [k, 0]));
  for (const seq of frames) {
    let prev = -1;
    for (const k of seq) {
      if (!live.has(k) || k === prev) continue;
      if (prev >= 0) {
        const set = next.get(prev) ?? next.set(prev, new Set()).get(prev)!;
        if (!set.has(k)) {
          set.add(k);
          indeg.set(k, indeg.get(k)! + 1);
        }
      }
      prev = k;
    }
  }
  const left = [...ids].sort((a, b) => a - b);
  const out: number[] = [];
  while (left.length) {
    let at = left.findIndex((k) => indeg.get(k) === 0);
    if (at < 0) at = 0; // a cycle: the earliest to appear goes first
    const [k] = left.splice(at, 1);
    out.push(k);
    for (const j of next.get(k) ?? []) indeg.set(j, indeg.get(j)! - 1);
  }
  return out;
}
