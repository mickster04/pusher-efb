// Drawing helpers for the plot canvases (the Plan tab and the Push tab share them). Nothing here runs at load time.

PS.plotDraw = (function () {
  // The canvas is sized so its pixels and its on-screen size are the same. The sim draws a canvas at its full backing size and does not scale
  // it down to a smaller CSS box, which showed only the top-left part of the drawing and skewed every tap, so CSS never scales it: the backing
  // size is set from the room available and the CSS size is set to exactly the same number of pixels.
  var FIT_ASPECT = 0.6, FIT_MIN_W = 420, FIT_MAX_W = 900;
  function fitCanvas(canvas, reserveH) {
    var parent = canvas.parentNode, body = document.querySelector ? document.querySelector('.ps-body') : null;
    var availW = parent ? parent.clientWidth - 34 : FIT_MAX_W;
    if (!(availW > 0)) return false;                              // not laid out yet (page hidden)
    var availH = body ? body.clientHeight - (reserveH || 150) : 640;
    var w = Math.floor(Math.min(FIT_MAX_W, availW, availH / FIT_ASPECT));
    if (w < FIT_MIN_W) w = Math.min(FIT_MIN_W, Math.floor(availW));
    var h = Math.round(w * FIT_ASPECT);
    if (canvas.width === w && canvas.height === h && canvas.style.width === w + 'px') return false;
    canvas.width = w; canvas.height = h;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    return true;
  }

  // The sim's browser does not repaint a canvas by itself: a drawn canvas only showed after the page was scrolled away and back. Alternating the
  // canvas opacity by 0.1% after each draw marks it as changed for the compositor (this is the nudge that was found to work in the sim).
  var flip = false;
  function nudge(canvas) {
    try { flip = !flip; canvas.style.opacity = flip ? '0.999' : '1'; } catch (e) { /* a nudge must never break a draw */ }
  }

  // An aircraft marker (nose up, then rotated): a pin's direction is the way the nose points there.
  function aircraftMarker(g, x, y, headingDeg, fill, stroke, scale) {
    g.save(); g.translate(x, y); g.rotate(PS.geo.rad(headingDeg)); g.scale(scale, scale);
    g.beginPath(); g.moveTo(0, -17); g.lineTo(5, -6); g.lineTo(17, 4); g.lineTo(17, 8); g.lineTo(5, 4); g.lineTo(4, 11); g.lineTo(9, 15); g.lineTo(9, 18); g.lineTo(0, 16); g.lineTo(-9, 18); g.lineTo(-9, 15); g.lineTo(-4, 11);
    g.lineTo(-5, 4); g.lineTo(-17, 8); g.lineTo(-17, 4); g.lineTo(-5, -6); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    g.lineWidth = 2; g.strokeStyle = stroke; g.stroke();
    g.restore();
  }
  function labelAt(g, text, x, y) {
    g.font = 'bold 13px Arial'; g.lineWidth = 3; g.strokeStyle = PS.theme.c('outline'); g.strokeText(text, x, y); g.fillStyle = PS.theme.c('pin'); g.fillText(text, x, y);
  }
  // Direction chevrons along a drawn path every ~46 px, pointing the way the tug travels.
  function chevrons(g, px, color) {
    var acc = 0, next = 30;
    g.fillStyle = color;
    for (var i = 1; i < px.length; i++) {
      var dx = px[i][0] - px[i - 1][0], dy = px[i][1] - px[i - 1][1], len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.01) continue;
      while (acc + len >= next) {
        var f = (next - acc) / len, x = px[i - 1][0] + dx * f, y = px[i - 1][1] + dy * f, a = Math.atan2(dy, dx);
        g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.moveTo(5, 0); g.lineTo(-4, -5); g.lineTo(-4, 5); g.closePath(); g.fill(); g.restore();
        next += 46;
      }
      acc += len;
    }
  }
  function strokePath(g, pts, view, color, width) {
    g.strokeStyle = color; g.lineWidth = width; g.beginPath();
    var px = pts.map(function (p) { return view.toPx(p[0], p[1]); });
    px.forEach(function (q, i) { if (i === 0) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]); });
    g.stroke(); g.lineWidth = 1;
    return px;
  }

  // Background, range rings (centred on `ringCentre`, a canvas point), taxiways with names, runways and stands. Returns the number of taxi items drawn.
  // Line weights in pixels: an unnamed path (apron lane, connector) is the base; a named taxiway is at least twice that, a runway several times.
  // They come from the theme (PS.theme.mapStyle()).
  function lineWeight(it, ms) {
    if (it.category === 'Runway') return ms.runway;
    if (it.category === 'Taxiway' && it.rawName) return ms.named;
    return ms.unnamed;
  }
  // A scale bar in the bottom left: a round length (1, 2 or 5 x a power of ten metres) of about a quarter of the range.
  function scaleBar(g, view, h, range) {
    var target = range / 4, pow = Math.pow(10, Math.floor(Math.log(target) / Math.LN10)), n = target / pow, nice = (n >= 5 ? 5 : (n >= 2 ? 2 : 1)) * pow, px = nice * view.scale;
    var x = 12, y = h - 14;
    g.strokeStyle = PS.theme.c('mapText'); g.fillStyle = PS.theme.c('mapText'); g.lineWidth = 2; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x, y); g.lineTo(x + px, y); g.lineTo(x + px, y - 4); g.stroke();
    g.font = '11px Arial'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(PS.fmt.dist(nice), x + 2, y - 7);
  }
  // A label centred on its line, with a gap in the background colour all round it so the line stops short of the text.
  function haloLabel(g, text, x, y, color, size, gap) {
    g.font = 'bold ' + size + 'px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = gap; g.strokeStyle = PS.theme.c('mapBg'); g.strokeText(text, x, y);
    g.fillStyle = color; g.fillText(text, x, y);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  }
  function backdrop(g, view, w, h, range, ringCentre, taxi) {
    g.fillStyle = PS.theme.c('mapBg'); g.fillRect(0, 0, w, h);
    g.lineWidth = 1; g.strokeStyle = PS.theme.c('mapGrid'); g.fillStyle = PS.theme.c('mapText'); g.font = '11px Arial';
    // Range rings are optional (Settings), off by default; the scale bar is always there.
    if (PS.settings && PS.settings.get('rings')) {
      [0.25, 0.5, 0.75, 1].forEach(function (f) {
        g.beginPath(); g.arc(ringCentre[0], ringCentre[1], range * f * view.scale, 0, Math.PI * 2); g.stroke();
        g.fillText(PS.fmt.dist(range * f), ringCentre[0] + 4, ringCentre[1] - range * f * view.scale + 12);
      });
    }
    scaleBar(g, view, h, range);
    g.fillStyle = PS.theme.c('textDim'); g.font = 'bold 12px Arial'; g.fillText('N', 8, 16);
    var ms = PS.theme.mapStyle(), drawn = 0, labels = {}, runwayLabels = [];
    if (!taxi) return drawn;
    // Runways first (the thickest, underneath), then unnamed paths, then named taxiways on top.
    var pass = [function (it) { return it.category === 'Runway'; }, function (it) { return it.category !== 'Runway' && !(it.category === 'Taxiway' && it.rawName); }, function (it) { return it.category === 'Taxiway' && !!it.rawName; }];
    g.lineCap = 'round'; g.lineJoin = 'round';
    pass.forEach(function (want) {
      taxi.items.forEach(function (it) {
        if (!it.points.length || !want(it)) return;
        g.strokeStyle = it.category === 'Runway' ? PS.theme.c('runway') : (it.category === 'Taxiway' ? PS.theme.c('taxiway') : PS.theme.c('pathOther'));
        g.lineWidth = lineWeight(it, ms);
        g.beginPath();
        var first = null, last = null;
        it.points.forEach(function (p, i) { var q = view.toPx(p[0], p[1]); if (i === 0) { g.moveTo(q[0], q[1]); first = q; } else g.lineTo(q[0], q[1]); last = q; });
        g.stroke(); drawn++;
        if (range > 1000 || !first || !last) return;
        var mx = (first[0] + last[0]) / 2, my = (first[1] + last[1]) / 2;
        if (mx < 0 || mx > w || my < 0 || my > h) return;
        if (it.category === 'Taxiway' && it.rawName && !labels[it.rawName]) labels[it.rawName] = [mx, my];
        else if (it.category === 'Runway' && it.name && it.name !== '(unnamed)') runwayLabels.push([it.name, mx, my]);
      });
    });
    g.lineCap = 'butt'; g.lineWidth = 1;
    Object.keys(labels).forEach(function (nm) { haloLabel(g, nm, labels[nm][0], labels[nm][1], PS.theme.c('warn'), ms.label, ms.gap); });
    runwayLabels.forEach(function (r) { haloLabel(g, r[0], r[1], r[2], PS.theme.c('text'), ms.label, ms.gap); });
    if (range <= 300) {
      g.fillStyle = PS.theme.c('runway'); g.font = '10px Arial';
      (taxi.parking || []).forEach(function (p) {
        if (p.lat === null) return;
        var q = view.toPx(p.lat, p.lon);
        if (q[0] < 0 || q[0] > w || q[1] < 0 || q[1] > h) return;
        g.fillRect(q[0] - 2, q[1] - 2, 4, 4); g.fillText(p.name, q[0] + 4, q[1] + 3);
      });
    }
    return drawn;
  }

  // The planned route by leg (push back = white, forward = blue, a leg the tug may not manage = red) and the directional pins.
  // opts: { selected: user pin index to ring (or -1), pinCount, doneLegs: legs already driven are drawn dimmed (Push tab) }
  function planRoute(g, view, plan, opts) {
    opts = opts || {};
    plan.segments.forEach(function (sg, n) {
      var color = plan.legs[n].warning ? PS.theme.c('routeBad') : (sg.sign < 0 ? PS.theme.c('routeBack') : PS.theme.c('routeFwd'));
      if (opts.doneLegs && n < opts.doneLegs) color = PS.theme.c('routeDone');
      chevrons(g, strokePath(g, sg.points, view, color, 3), color);
    });
    g.font = 'bold 13px Arial';
    plan.items.forEach(function (it) {
      var q = view.toPx(it.wp.lat, it.wp.lon), isEnd = it.userIndex === (opts.pinCount || 0) - 1;
      var hd = it.headingDeg === null ? 0 : it.headingDeg;
      if (it.turnaround) { aircraftMarker(g, q[0], q[1], hd, null, PS.theme.c('textDim'), 0.8); labelAt(g, 'turn', q[0] + 14, q[1] - 12); return; }
      aircraftMarker(g, q[0], q[1], hd, isEnd ? PS.theme.c('pinEnd') : PS.theme.c('pin'), PS.theme.c('outline'), isEnd ? 1.15 : 1);
      // The pin number sits in the centre of the aircraft, upright, in the outline colour on the pin colour (the End pin keeps its word beside it too).
      var num = String(it.userIndex + 1);
      g.save(); g.font = 'bold 13px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = PS.theme.c('outline'); g.fillText(num, q[0], q[1] + 1); g.restore();
      if (isEnd) labelAt(g, 'End', q[0] + 16, q[1] - 14);
    });
  }

  // AI aircraft with a short track line and a name. Returns how many are inside the canvas.
  function contacts(g, view, list, w, h, selectedId) {
    var inView = 0;
    g.font = '11px Arial';
    list.forEach(function (ct) {
      var q = view.toPx(ct.lat, ct.lon);
      if (q[0] < -10 || q[0] > w + 10 || q[1] < -10 || q[1] > h + 10) return;
      inView++;
      g.fillStyle = PS.theme.c('traffic');
      g.beginPath(); g.arc(q[0], q[1], ct.id === selectedId ? 7 : 5, 0, Math.PI * 2); g.fill();
      var trk = typeof ct.trackDeg === 'number' && ct.gsKt > 1 ? ct.trackDeg : (ct.hdgDeg || 0);
      g.strokeStyle = PS.theme.c('traffic'); g.lineWidth = 2; g.beginPath(); g.moveTo(q[0], q[1]);
      g.lineTo(q[0] + Math.sin(PS.geo.rad(trk)) * 16, q[1] - Math.cos(PS.geo.rad(trk)) * 16); g.stroke(); g.lineWidth = 1;
      g.fillStyle = PS.theme.mix(PS.theme.c('traffic'), PS.theme.c('text'), 0.55); g.fillText(ct.title || '', q[0] + 8, q[1] + 4);
    });
    return inView;
  }

  return { fitCanvas: fitCanvas, nudge: nudge, aircraftMarker: aircraftMarker, labelAt: labelAt, chevrons: chevrons, strokePath: strokePath,
    backdrop: backdrop, planRoute: planRoute, contacts: contacts };
})();
