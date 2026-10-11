/*
  Qrafty renderer: turns text and style options into an SVG string.

  QraftyRender.render(options) returns
    { svg, width, height, modules, level, lowered }
  or throws an Error with code "TOO_LONG" when the text can't fit in a QR code.

  Everything is drawn in "units": one QR module is 10 units wide.
*/
var QraftyRender = (function () {
  var U = 10;        // units per module
  var QUIET = 4;     // quiet zone, in modules (the QR spec asks for 4)
  var LEVELS = ["L", "M", "Q", "H"];
  var LABEL_FONT = "Arial, Helvetica, sans-serif";

  function num(v) {
    return Math.round(v * 100) / 100;
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* The encoder reads one byte per character, so turn the text into UTF-8 bytes first. */
  function toByteString(text) {
    var bytes = new TextEncoder().encode(text);
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  /* ---------- path helpers ---------- */

  function rectPath(x, y, w, h) {
    return "M" + num(x) + " " + num(y) + "h" + num(w) + "v" + num(h) + "h" + num(-w) + "z";
  }

  function roundRectPath(x, y, w, h, r) {
    if (r <= 0) return rectPath(x, y, w, h);
    r = Math.min(r, w / 2, h / 2);
    return (
      "M" + num(x + r) + " " + num(y) +
      "h" + num(w - 2 * r) +
      "a" + num(r) + " " + num(r) + " 0 0 1 " + num(r) + " " + num(r) +
      "v" + num(h - 2 * r) +
      "a" + num(r) + " " + num(r) + " 0 0 1 " + num(-r) + " " + num(r) +
      "h" + num(-(w - 2 * r)) +
      "a" + num(r) + " " + num(r) + " 0 0 1 " + num(-r) + " " + num(-r) +
      "v" + num(-(h - 2 * r)) +
      "a" + num(r) + " " + num(r) + " 0 0 1 " + num(r) + " " + num(-r) +
      "z"
    );
  }

  function circlePath(cx, cy, r) {
    return (
      "M" + num(cx - r) + " " + num(cy) +
      "a" + num(r) + " " + num(r) + " 0 1 0 " + num(2 * r) + " 0" +
      "a" + num(r) + " " + num(r) + " 0 1 0 " + num(-2 * r) + " 0z"
    );
  }

  /* A module whose corners are rounded one by one (used by the "smooth" style). */
  function cornerPath(x, y, s, r, tl, tr, br, bl) {
    var d = "M" + num(x + (tl ? r : 0)) + " " + num(y);
    d += "H" + num(x + s - (tr ? r : 0));
    if (tr) d += "A" + r + " " + r + " 0 0 1 " + num(x + s) + " " + num(y + r);
    d += "V" + num(y + s - (br ? r : 0));
    if (br) d += "A" + r + " " + r + " 0 0 1 " + num(x + s - r) + " " + num(y + s);
    d += "H" + num(x + (bl ? r : 0));
    if (bl) d += "A" + r + " " + r + " 0 0 1 " + num(x) + " " + num(y + s - r);
    d += "V" + num(y + (tl ? r : 0));
    if (tl) d += "A" + r + " " + r + " 0 0 1 " + num(x + r) + " " + num(y);
    return d + "z";
  }

  /* ---------- dots ---------- */

  /*
    dark(row, col) says whether a module should be drawn.
    Returns one path string covering every drawn module.
  */
  function dotsPath(dark, count, style, ox, oy) {
    var d = "";
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (!dark(r, c)) continue;
        var x = ox + c * U;
        var y = oy + r * U;

        if (style === "dots") {
          d += circlePath(x + U / 2, y + U / 2, U * 0.45);
        } else if (style === "rounded") {
          d += roundRectPath(x + 0.25, y + 0.25, U - 0.5, U - 0.5, U * 0.3);
        } else if (style === "smooth") {
          var up = dark(r - 1, c), down = dark(r + 1, c);
          var left = dark(r, c - 1), right = dark(r, c + 1);
          d += cornerPath(x, y, U, U / 2, !up && !left, !up && !right, !down && !right, !down && !left);
        } else {
          d += rectPath(x, y, U, U);
        }
      }
    }
    return d;
  }

  /* ---------- corner markers (the three big squares) ---------- */

  /*
    How round each frame style is, in modules. Rounder than about 2.6 and
    scanners start to miss the marker, so a full circle is deliberately left out.
  */
  var FRAME_RADIUS = { square: 0, rounded: 1.5, round: 2.6 };

  function markerFramePath(style, x, y) {
    var s = 7 * U;
    var r = FRAME_RADIUS[style] || 0;
    return (
      roundRectPath(x, y, s, s, U * r) +
      roundRectPath(x + U, y + U, s - 2 * U, s - 2 * U, U * Math.max(r - 1, 0))
    );
  }

  function markerDotPath(style, x, y) {
    var s = 3 * U;
    var ix = x + 2 * U;
    var iy = y + 2 * U;
    if (style === "dot") return circlePath(ix + s / 2, iy + s / 2, s / 2);
    if (style === "rounded") return roundRectPath(ix, iy, s, s, U * 0.9);
    return rectPath(ix, iy, s, s);
  }

  /* ---------- label text ---------- */

  var measureCanvas = null;

  function textWidth(text, size) {
    if (typeof document !== "undefined") {
      if (!measureCanvas) measureCanvas = document.createElement("canvas");
      var ctx = measureCanvas.getContext("2d");
      if (ctx) {
        ctx.font = "700 " + size + "px " + LABEL_FONT;
        return ctx.measureText(text).width;
      }
    }
    return text.length * size * 0.6;
  }

  /* ---------- encoding ---------- */

  function encode(text, level) {
    var qr = new QRCodeLib.QRCode(-1, QRCodeLib.ErrorCorrectLevel[level]);
    qr.addData(toByteString(text));
    qr.make();
    return qr;
  }

  /* Try the wanted error correction level first, then step down until the text fits. */
  function encodeBest(text, wanted) {
    var start = LEVELS.indexOf(wanted);
    if (start < 0) start = 1;
    for (var i = start; i >= 0; i--) {
      try {
        return { qr: encode(text, LEVELS[i]), level: LEVELS[i], lowered: i < start };
      } catch (e) {
        /* too long for this level, try the next one down */
      }
    }
    var err = new Error("Too much content for one QR code");
    err.code = "TOO_LONG";
    throw err;
  }

  /* ---------- main ---------- */

  function render(o) {
    var enc = encodeBest(o.text, o.level || "M");
    var qr = enc.qr;
    var count = qr.getModuleCount();

    var colorDots = o.colorDots || "#000000";
    var colorMarkers = o.colorMarkers || colorDots;
    var colorBg = o.colorBg || "#ffffff";
    var transparent = !!o.transparent;

    /* Space in the middle that the logo needs kept clear, in modules. */
    var hole = null;
    if (o.logo && o.logo.href) {
      var k = Math.round(count * (o.logoSize || 0.22));
      if ((count - k) % 2) k += 1;
      hole = { start: (count - k) / 2, size: k };
    }

    function inMarker(r, c) {
      return (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7);
    }

    function dark(r, c) {
      if (r < 0 || c < 0 || r >= count || c >= count) return false;
      if (inMarker(r, c)) return false;
      if (hole && r >= hole.start && r < hole.start + hole.size && c >= hole.start && c < hole.start + hole.size) return false;
      return qr.isDark(r, c);
    }

    var side = (count + 2 * QUIET) * U;   // the code plus its quiet zone
    var label = (o.label || "").trim();
    var frame = o.frame === "top" || o.frame === "bottom" ? o.frame : "none";

    var border = 0, band = 0;
    if (frame !== "none") {
      border = side * 0.045;
      band = label ? side * 0.17 : 0;
    }

    var width = side + 2 * border;
    var height = side + 2 * border + band;
    var panelX = border;
    var panelY = border + (frame === "top" ? band : 0);
    var ox = panelX + QUIET * U;
    var oy = panelY + QUIET * U;

    var parts = [];

    if (frame !== "none") {
      var outerR = side * 0.07;
      var innerR = Math.max(outerR - border * 0.6, 0);
      parts.push(
        '<path fill="' + colorDots + '" fill-rule="evenodd" d="' +
        roundRectPath(0, 0, width, height, outerR) +
        roundRectPath(panelX, panelY, side, side, innerR) + '"/>'
      );
      if (!transparent) {
        parts.push('<path fill="' + colorBg + '" d="' + roundRectPath(panelX, panelY, side, side, innerR) + '"/>');
      }
      if (label) {
        var bandTop = frame === "top" ? 0 : panelY + side;
        var bandHeight = band + border;
        var size = band * 0.56;
        var maxWidth = side * 0.9;
        var measured = textWidth(label, size);
        if (measured > maxWidth) size = size * (maxWidth / measured);
        var labelColor = transparent ? pickReadable(colorDots) : colorBg;
        parts.push(
          '<text x="' + num(width / 2) + '" y="' + num(bandTop + bandHeight / 2 + size * 0.35) +
          '" text-anchor="middle" font-family="' + LABEL_FONT + '" font-weight="700" font-size="' + num(size) +
          '" fill="' + labelColor + '">' + escapeXml(label) + "</text>"
        );
      }
    } else if (!transparent) {
      parts.push('<path fill="' + colorBg + '" d="' + rectPath(0, 0, width, height) + '"/>');
    }

    parts.push('<path fill="' + colorDots + '" d="' + dotsPath(dark, count, o.dots, ox, oy) + '"/>');

    var corners = [[0, 0], [0, count - 7], [count - 7, 0]];
    var markers = "";
    for (var i = 0; i < corners.length; i++) {
      var mx = ox + corners[i][1] * U;
      var my = oy + corners[i][0] * U;
      markers += markerFramePath(o.markerFrame, mx, my) + markerDotPath(o.markerDot, mx, my);
    }
    parts.push('<path fill="' + colorMarkers + '" fill-rule="evenodd" d="' + markers + '"/>');

    if (hole) {
      var boxSide = hole.size * U - 1.2 * U;
      var ratio = o.logo.ratio > 0 ? o.logo.ratio : 1;
      var lw = ratio >= 1 ? boxSide : boxSide * ratio;
      var lh = ratio >= 1 ? boxSide / ratio : boxSide;
      var center = oy + (count * U) / 2;
      var centerX = ox + (count * U) / 2;
      parts.push(
        '<image href="' + o.logo.href + '" x="' + num(centerX - lw / 2) + '" y="' + num(center - lh / 2) +
        '" width="' + num(lw) + '" height="' + num(lh) + '" preserveAspectRatio="xMidYMid meet"/>'
      );
    }

    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + num(width) + " " + num(height) +
      '" width="' + num(width) + '" height="' + num(height) + '" role="img" aria-label="QR code">' +
      parts.join("") + "</svg>";

    return {
      svg: svg,
      width: width,
      height: height,
      modules: count,
      level: enc.level,
      lowered: enc.lowered
    };
  }

  /* ---------- colour helpers, shared with the page ---------- */

  function luminance(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return 0;
    var v = parseInt(m[1], 16);
    var ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(function (c) {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function contrast(a, b) {
    var la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function pickReadable(onColor) {
    return luminance(onColor) > 0.4 ? "#000000" : "#ffffff";
  }

  return {
    render: render,
    dotsPath: dotsPath,
    markerFramePath: markerFramePath,
    markerDotPath: markerDotPath,
    luminance: luminance,
    contrast: contrast,
    UNIT: U
  };
})();
