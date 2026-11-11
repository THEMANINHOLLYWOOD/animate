// LOUD. Hand-built example film in the scene format Claude generates.
// Brief: A brutalist kinetic-typography manifesto for a fictional music festival: black, white and signal red, giant frame-filling words slamming in on hard cuts at 150 BPM, strobing inversions, scrolling marquee bands, a decibel counter, ending on a bold LOUD / 3 DAYS / 0 SILENCE lockup.
export const film = {
  id: "ex-loud",
  title: "LOUD",
  aspect: "16:9" as const,
  duration: 12,
  prompt: "A brutalist kinetic-typography manifesto for a fictional music festival: black, white and signal red, giant frame-filling words slamming in on hard cuts at 150 BPM, strobing inversions, scrolling marquee bands, a decibel counter, ending on a bold LOUD / 3 DAYS / 0 SILENCE lockup.",
  code: String.raw`
// LOUD — a brutalist kinetic-type manifesto. 30 beats at ~150 BPM (12 s), cuts on beats.
const u = lib.u, E = lib.ease;
const K = '#000000', WH = '#FFFFFF', R = '#FF2A1F';
const wide = W / H >= 1.2, tall = W / H < 0.8;
const S = Math.min(W, H), mg = S * 0.07;
const BW = W - mg * 2, BH = H - mg * 2;
const B = p * 30;                       // beat clock (schedule)
const bf = B - Math.floor(B);           // position inside the beat
const kick = Math.exp(-bf * 7);         // decays after every beat
const since = (b0) => Math.max(0, B - b0);
const punch = (b0, amt) => 1 + (amt || 0.22) * Math.exp(-since(b0) * 9);
const inS = (a, b) => B >= a && B < b;

// Heavy type fitted to a box: width-led, height stretched within [smin, smax] of width scale.
function fit(str, cx, cy, bw, bh, col, o) {
  o = o || {};
  const tr = o.tr == null ? -0.045 : o.tr, fam = o.fam || 'sans', wt = o.wt || 900;
  const m = lib.text(ctx, str, 0, -9999, { size: 200, family: fam, weight: wt, tracking: tr, alpha: 0 });
  const wN = m.width - tr * 200, cap = 144;
  let sx = bw / wN, sy = Math.min(bh / cap, sx * (o.smax || 1.6));
  if (sy < sx * (o.smin || 0.55)) sx = sy / (o.smin || 0.55);
  const k = o.k || 1;
  if (o.dry) return { w: wN * sx * k, h: cap * sy * k };
  ctx.save();
  ctx.translate(cx, cy);
  if (o.rot) ctx.rotate(o.rot);
  ctx.scale(sx * k * (o.kx || 1), sy * k * (o.ky || 1));
  lib.text(ctx, str, tr * 100, 72, { size: 200, family: fam, weight: wt, tracking: tr, color: col, align: 'center', alpha: o.a == null ? 1 : o.a });
  ctx.restore();
  return { w: wN * sx * k, h: cap * sy * k };
}
function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
function shake(amp, rate) {
  const q = B * (rate || 1), i = Math.floor(q), env = Math.exp(-(q - i) * 6);
  ctx.translate((lib.rand(i * 7 + 1) - 0.5) * 2 * amp * u * env, (lib.rand(i * 13 + 5) - 0.5) * 2 * amp * u * env);
}
// Repeating word band, scrolling at speed.
function band(y, h, str, fg, bgc, speed, x0, x1) {
  x0 = x0 == null ? 0 : x0; x1 = x1 == null ? W : x1;
  rect(x0, y, x1 - x0, h, bgc);
  const size = (h * 0.78) / 0.72;
  const to = { size: size, family: 'sans', weight: 900, tracking: 0, alpha: 0 };
  const rw = lib.text(ctx, str + str, 0, -9999, to).width - lib.text(ctx, str, 0, -9999, to).width;
  let off = ((t * speed * u) % rw + rw) % rw;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y, x1 - x0, h); ctx.clip();
  for (let x = x0 - off; x < x1; x += rw) {
    lib.text(ctx, str, x, y + h / 2 + h * 0.39, { size: size, family: 'sans', weight: 900, tracking: 0, color: fg });
  }
  ctx.restore();
}

// ---------- S1: NO. ----------
if (inS(0, 1.5)) {
  lib.bg(ctx, W, H, K);
  const a = lib.seg(B, 0, 0.35, E.outExpo);
  lib.layer(ctx, 'NO.', () => { shake(14); fit('NO.', W / 2, H / 2, BW, BH, WH, { k: lib.lerp(1.5, 1, a) * punch(1, 0.08), smax: 1.9 }); });
  lib.layer(ctx, 'Underline', () => { shake(14); rect(0, H - mg * 0.55, W * lib.seg(B, 0.5, 1.4, E.outExpo), mg * 0.18, R); });
}
// ---------- S2: QUIET. (struck out) ----------
else if (inS(1.5, 3)) {
  lib.bg(ctx, W, H, WH);
  const a = lib.seg(B, 1.5, 1.85, E.outExpo);
  lib.layer(ctx, 'QUIET.', () => { shake(10); fit('QUIET.', W / 2, H / 2, BW, BH, K, { k: lib.lerp(0.7, 1, a), kx: lib.lerp(1.6, 1, a), smax: 2.2 }); });
  const s = lib.seg(B, 2.2, 2.45, E.outExpo);
  if (s > 0) lib.layer(ctx, 'Strike-through', () => {
    shake(10);
    const r = fit('QUIET.', W / 2, H / 2, BW, BH, K, { k: lib.lerp(0.7, 1, a), kx: lib.lerp(1.6, 1, a), smax: 2.2, dry: 1 });
    rect(W / 2 - (W * 0.55) * s, H / 2 - r.h * 0.09, W * 1.1 * s, r.h * 0.18, R);
  });
}
// ---------- S3: ALLOWED. ----------
else if (inS(3, 4.5)) {
  lib.bg(ctx, W, H, R);
  const a = lib.seg(B, 3, 3.4, E.outExpo);
  lib.layer(ctx, 'ALLOWED.', () => { shake(12); fit('ALLOWED.', W / 2, H / 2, BW, BH * lib.lerp(0.15, 1, a), K, { smax: tall ? 3.2 : 2.2, k: punch(4, 0.06) }); });
}
// ---------- S4: stacked manifesto, strobing ----------
else if (inS(4.5, 7)) {
  const inv = Math.floor(B * 2) % 2 === 1 && B > 5.5;
  lib.bg(ctx, W, H, inv ? WH : K);
  const fg = inv ? K : WH;
  const L = ['NO', 'QUIET', 'ALLOWED'];
  const lh = BH / 3;
  L.forEach((w, i) => {
    const k = lib.seg(B, 4.5 + i * 0.35, 4.85 + i * 0.35, E.outExpo);
    if (k <= 0) return;
    const dir = i % 2 ? 1 : -1;
    const x = W / 2 + dir * (1 - k) * W;
    lib.layer(ctx, 'Stacked ' + w, () => { shake(10, 2); fit(w, x, mg + lh * (i + 0.5), BW, lh * 0.9, i === 1 ? R : fg, { smax: 3, smin: 0.3 }); });
  });
}
// ---------- S5: marquee bands -> rotated grid ----------
else if (inS(7, 12)) {
  lib.bg(ctx, W, H, K);
  const rk = lib.spring(lib.seg(B, 9.5, 10.6), { damping: 0.5, freq: 3 });
  const n = tall ? 9 : 6;
  lib.camera(ctx, { rot: -13 * rk, zoom: (1 + 0.42 * rk) * punch(Math.floor(B), 0.05) }, () => {
    const ext = rk > 0 ? 0.35 : 0;
    const y0 = -H * ext, hh = (H * (1 + 2 * ext)) / (n + Math.round(n * 2 * ext));
    const rows = Math.ceil((H * (1 + 2 * ext)) / hh);
    lib.layer(ctx, 'Marquee bands', () => {
    for (let i = 0; i < rows; i++) {
      const k = lib.seg(B, 7 + i * 0.12, 7.5 + i * 0.12, E.outExpo);
      if (k <= 0) continue;
      const pal = [[WH, K], [K, WH], [K, R], [WH, K], [R, K], [K, WH]][i % 6];
      const sp = (i % 2 ? 1 : -1) * (900 + (i % 3) * 500);
      const xs = (i % 2 ? -1 : 1) * W * 1.4 * (1 - k);
      band(y0 + i * hh, hh * 0.96, (i % 4 === 2 ? 'NO QUIET — ' : 'LOUDER — '), pal[0], pal[1], sp, -W * 0.4 + xs, W * 1.4 + xs);
    }
    });
  });
  // centre call-out on the grid
  if (B >= 10.6) {
    const k = lib.seg(B, 10.6, 10.9, E.outExpo);
    const bw = wide ? W * 0.5 : W * 0.8, bh = wide ? H * 0.34 : H * 0.18;
    lib.layer(ctx, 'LOUDER call-out', () => {
    ctx.translate(W / 2, H / 2); ctx.scale(punch(10.6, 0.3) * k, punch(10.6, 0.3) * k);
    rect(-bw / 2, -bh / 2, bw, bh, R);
    fit('LOUDER', 0, 0, bw * 0.86, bh * 0.66, K, { smax: 2 });
    });
  }
}
// ---------- S6: 3 DAYS / 0 SILENCE ----------
else if (inS(12, 16)) {
  const second = B >= 14;
  lib.bg(ctx, W, H, second ? WH : K);
  const num = second ? '0' : '3', word = second ? 'SILENCE' : 'DAYS';
  const b0 = second ? 14 : 12;
  const nk = lib.seg(B, b0, b0 + 0.3, E.outExpo), wk = lib.seg(B, b0 + 0.5, b0 + 0.8, E.outExpo);
  const numC = second ? K : R, wordC = second ? R : WH;
  if (wide) {
    const nw = BW * 0.3;
    lib.layer(ctx, 'Big ' + num, () => { shake(12); fit(num, mg + nw / 2, H / 2, nw, BH, numC, { smax: 3.4, k: lib.lerp(1.6, 1, nk) }); });
    if (wk > 0) {
      const ww = BW - nw - mg * 0.6;
      lib.layer(ctx, word, () => { shake(12); fit(word, W - mg - ww / 2 + (1 - wk) * W * 0.6, H / 2, ww, BH * 0.62, wordC, { smax: 3 }); });
      if (second && B > 15) lib.layer(ctx, 'SILENCE strike', () => {
        shake(12);
        const r = fit(word, W - mg - ww / 2 + (1 - wk) * W * 0.6, H / 2, ww, BH * 0.62, wordC, { smax: 3, dry: 1 });
        rect(W - mg - ww - mg * 0.3, H / 2 - r.h * 0.07, (ww + mg * 0.6) * lib.seg(B, 15, 15.3, E.outExpo), r.h * 0.14, K);
      });
    }
  } else {
    const nh = BH * 0.6;
    lib.layer(ctx, 'Big ' + num, () => { shake(12); fit(num, W / 2, mg + nh / 2, BW, nh, numC, { smax: 6, k: lib.lerp(1.6, 1, nk) }); });
    if (wk > 0) {
      lib.layer(ctx, word, () => { shake(12); fit(word, W / 2 + (1 - wk) * W, mg + nh + (BH - nh) / 2, BW, (BH - nh) * 0.8, wordC, { smax: 2.6 }); });
      if (second && B > 15) lib.layer(ctx, 'SILENCE strike', () => {
        shake(12);
        const r = fit(word, W / 2 + (1 - wk) * W, mg + nh + (BH - nh) / 2, BW, (BH - nh) * 0.8, wordC, { smax: 2.6, dry: 1 });
        rect(mg * 0.6, mg + nh + (BH - nh) / 2 - r.h * 0.07, (W - mg * 1.2) * lib.seg(B, 15, 15.3, E.outExpo), r.h * 0.14, K);
      });
    }
  }
  // tiny shouted caption
  lib.layer(ctx, second ? 'Caption: SILENCE CANCELLED' : 'Caption: 72 HOURS', () => { shake(12); lib.text(ctx, second ? 'SILENCE: CANCELLED' : 'NON-STOP / 72 HOURS', mg, mg * 0.75, { size: 22 * u, family: 'mono', weight: 700, color: second ? K : WH, tracking: 0.12 }); });
}
// ---------- S7: decibel counter ----------
else if (inS(16, 20)) {
  const k = lib.seg(B, 16, 19.2, E.inOut);
  const hit = B >= 19.2;
  const strobe = hit && Math.floor(B * 4) % 2 === 0;
  lib.bg(ctx, W, H, hit ? (strobe ? R : K) : K);
  const n = Math.round(lib.lerp(0, 140, k));
  const str = ('00' + n).slice(-3);
  const fg = hit ? (strobe ? K : R) : WH;
  const nh = wide ? BH * 0.68 : BH * 0.42;
  lib.layer(ctx, 'Decibel counter', () => { shake(6 + 24 * k, 2); fit(str, W / 2, mg + nh / 2, BW * (wide ? 0.82 : 1), nh, fg, { smax: 3, k: punch(Math.floor(B), 0.04), tr: -0.02 }); });
  // VU meter blocks
  const cells = wide ? 28 : 14, gy = mg + nh + mg * 0.5, gh = Math.min(BH - nh - mg * 1.6, 120 * u);
  const cw = BW / cells;
  lib.layer(ctx, 'VU meter', () => {
  shake(6 + 24 * k, 2);
  ctx.beginPath();
  for (let i = 0; i < cells; i++) {
    const lvl = k * cells + (lib.noise(i * 0.4, t * 6) * 2 - 0.5) * kick;
    if (i < lvl) ctx.rect(mg + i * cw, gy, cw * 0.82, gh);
  }
  ctx.fillStyle = hit ? fg : (k > 0.8 ? R : WH); ctx.fill();
  });
  lib.layer(ctx, 'dB label', () => { shake(6 + 24 * k, 2); lib.text(ctx, 'dB  /  MINIMUM VOLUME', mg, H - mg * 0.6, { size: 24 * u, family: 'mono', weight: 700, color: fg, tracking: 0.1 }); });
  lib.layer(ctx, 'DO NOT ADJUST', () => { shake(6 + 24 * k, 2); lib.text(ctx, 'DO NOT ADJUST', W - mg, H - mg * 0.6, { size: 24 * u, family: 'mono', weight: 700, color: fg, tracking: 0.1, align: 'right' }); });
}
// ---------- S8: L O U D strobe, then letter equaliser ----------
else if (inS(20, 24.5)) {
  const letters = ['L', 'O', 'U', 'D'];
  if (B < 22) {
    const i = Math.floor((B - 20) * 2) % 4;
    const inv = i % 2 === 1;
    lib.bg(ctx, W, H, i === 2 ? R : inv ? WH : K);
    lib.layer(ctx, 'Strobe letters', () => { shake(16, 2); fit(letters[i], W / 2, H / 2, BW, BH, i === 2 ? K : inv ? K : WH, { smax: 4, k: punch(20 + i * 0.5, 0.25) }); });
  } else {
    lib.bg(ctx, W, H, K);
    const cw = BW / 4, base = H - mg;
    letters.forEach((ch, i) => {
      const ein = lib.seg(B, 22 + i * 0.1, 22.4 + i * 0.1, E.outExpo);
      const beatHit = Math.floor(B) % 4 === i ? kick : 0;
      const lvl = Math.max(0.55 + 0.42 * Math.abs(lib.noise(i * 2.3, t * 3.2)), beatHit);
      const h = BH * lvl * ein;
      if (h < 2) return;
      lib.layer(ctx, 'Equaliser ' + ch, () => fit(ch, mg + cw * (i + 0.5), base - h / 2, cw * 0.9, h, beatHit > 0.6 ? R : WH, { smax: 8, smin: 0.2 }));
    });
    // peak line
    lib.layer(ctx, 'Peak line', () => rect(mg, mg * 0.6, BW, 6 * u, R));
  }
}
// ---------- S9: final lockup (held) ----------
else {
  lib.bg(ctx, W, H, K);
  const a = lib.seg(B, 24.5, 24.85, E.outExpo);
  const throb = 1 + 0.012 * kick * (B < 29 ? 1 : 0);
  const topH = wide ? BH * 0.56 : tall ? BH * 0.5 : BH * 0.42;
  lib.layer(ctx, 'LOUD', () => { shake(18 * Math.exp(-since(24.5) * 2.5), 1);
  fit('LOUD', W / 2, mg + topH / 2, BW, topH, WH, { tr: -0.07, smax: tall ? 3.6 : 2.4, k: lib.lerp(1.4, 1, a) * throb });
  });
  // red slab
  const s = lib.seg(B, 25.2, 25.6, E.outExpo);
  const sy = mg + topH + mg * 0.35, sh = wide ? BH * 0.24 : tall ? BH * 0.24 : BH * 0.2;
  lib.layer(ctx, 'Red slab', () => rect(0, sy, W * s, sh, R));
  if (B > 25.5) {
    const k = lib.seg(B, 25.5, 25.85, E.outExpo);
    lib.layer(ctx, '3 DAYS / 0 SILENCE', () => lib.mask(ctx, (c) => c.rect(0, sy, W * s, sh), () => {
      if (wide) {
        fit('3 DAYS', mg + BW * 0.24, sy + sh / 2 + (1 - k) * sh, BW * 0.44, sh * 0.62, K, { smax: 1.8 });
        rect(W / 2 - 4 * u, sy + sh * 0.18, 8 * u, sh * 0.64, K);
        fit('0 SILENCE', W - mg - BW * 0.24, sy + sh / 2 - (1 - k) * sh, BW * 0.44, sh * 0.62, K, { smax: 1.8 });
      } else {
        if (tall) {
          fit('3 DAYS', W / 2, sy + sh * 0.27 + (1 - k) * sh, BW, sh * 0.4, K, { smax: 2.4 });
          fit('0 SILENCE', W / 2, sy + sh * 0.73 - (1 - k) * sh, BW, sh * 0.4, K, { smax: 2.4 });
        } else fit('3 DAYS / 0 SILENCE', W / 2, sy + sh / 2 + (1 - k) * sh, BW, sh * 0.5, K, { smax: 2.4 });
      }
    }));
  }
  // info line + marquee
  const ik = lib.seg(B, 26, 26.4, E.outExpo);
  const iy = sy + sh + mg * 0.55;
  const fs = (wide ? 26 : 30) * u;
  lib.layer(ctx, 'Festival line', () => { ctx.globalAlpha = ik; lib.text(ctx, 'LOUD FEST — VOL. 01', mg, iy + fs * 0.4, { size: fs, family: 'mono', weight: 700, color: WH, tracking: 0.12 }); });
  lib.layer(ctx, 'Dates line', () => { ctx.globalAlpha = ik; lib.text(ctx, '24–26 JULY — NO QUIET ALLOWED', W - mg, iy + fs * 0.4 + (wide ? 0 : fs * 1.6), { size: fs, family: 'mono', weight: 700, color: R, tracking: 0.12, align: 'right' }); });
  const mh = H - (iy + fs * (wide ? 1.4 : 3)) - mg * 0.4;
  if (mh > 20 * u && ik > 0) lib.layer(ctx, 'Bottom marquee', () => band(H - mg * 0.4 - Math.min(mh, 70 * u), Math.min(mh, 70 * u) * ik, 'LOUDER — LOUDER — ', K, WH, -260, 0, W));
}
`,
};
