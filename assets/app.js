(function () {
  var SAMPLE = "https://direkjames.github.io/";

  function $(id) { return document.getElementById(id); }

  var form = $("controls");
  var codeBox = $("code");
  var notes = $("notes");
  var message = $("message");
  var statusBox = $("status");
  var payloadBox = $("payload");
  var btnPng = $("download-png");
  var btnSvg = $("download-svg");
  var pngSize = $("png-size");

  var logo = null;      // { href, ratio } once an image is chosen
  var current = null;   // the last code that is ready to download

  function val(name) {
    var el = form.elements[name];
    return el ? el.value : "";
  }

  function isChecked(name) {
    return !!form.elements[name].checked;
  }

  /* ---------- what goes inside the code ---------- */

  function withScheme(url) {
    url = url.trim();
    if (!url) return "";
    return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : "https://" + url;
  }

  function wifiEscape(s) {
    return s.replace(/([\\;,:"])/g, "\\$1");
  }

  function vcardEscape(s) {
    return s.trim().replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
  }

  /* Returns { text } when there is something to encode, or { empty } with a prompt. */
  function buildPayload() {
    var type = val("type");

    if (type === "link") {
      var link = withScheme(val("link"));
      return link ? { text: link } : { empty: "Type a link to make your code. The one shown is a sample." };
    }

    if (type === "text") {
      var text = val("text");
      return text.trim() ? { text: text } : { empty: "Type some text to make your code. The one shown is a sample." };
    }

    if (type === "wifi") {
      var name = val("wifiName");
      if (!name.trim()) return { empty: "Type the network name to make your code. The one shown is a sample." };
      var security = val("wifiSecurity");
      var out = "WIFI:T:" + security + ";S:" + wifiEscape(name) + ";";
      if (security !== "nopass") out += "P:" + wifiEscape(val("wifiPassword")) + ";";
      if (isChecked("wifiHidden")) out += "H:true;";
      return { text: out + ";" };
    }

    var first = vcardEscape(val("cFirst"));
    var last = vcardEscape(val("cLast"));
    var phone = val("cPhone").trim();
    var email = val("cEmail").trim();
    var org = vcardEscape(val("cOrg"));
    var title = vcardEscape(val("cTitle"));
    var url = withScheme(val("cUrl"));

    if (!first && !last && !phone && !email && !org) {
      return { empty: "Fill in a name, phone or email to make your code. The one shown is a sample." };
    }

    var full = (first + " " + last).trim() || org || email || phone;
    var lines = ["BEGIN:VCARD", "VERSION:3.0", "N:" + last + ";" + first + ";;;", "FN:" + full];
    if (org) lines.push("ORG:" + org);
    if (title) lines.push("TITLE:" + title);
    if (phone) lines.push("TEL;TYPE=CELL:" + phone);
    if (email) lines.push("EMAIL:" + email);
    if (url) lines.push("URL:" + url);
    lines.push("END:VCARD");
    return { text: lines.join("\n") };
  }

  /* ---------- style options ---------- */

  /* Styles that hide more of the code get stronger error correction. */
  function wantedLevel() {
    if (logo) return "H";
    if (val("dots") === "dots" || val("markerFrame") === "round") return "Q";
    return "M";
  }

  function readOptions(text) {
    var dots = val("colorDots");
    return {
      text: text,
      level: wantedLevel(),
      dots: val("dots"),
      markerFrame: val("markerFrame"),
      markerDot: val("markerDot"),
      colorDots: dots,
      colorMarkers: isChecked("markersMatch") ? dots : val("colorMarkers"),
      colorBg: val("colorBg"),
      transparent: isChecked("transparent"),
      logo: logo,
      logoSize: parseInt(val("logoSize"), 10) / 100,
      frame: val("frame"),
      label: val("label")
    };
  }

  /* ---------- advice shown under the code ---------- */

  function buildNotes(o, result) {
    var list = [];
    var R = QraftyRender;

    if (!o.transparent) {
      var worst = Math.min(R.contrast(o.colorDots, o.colorBg), R.contrast(o.colorMarkers, o.colorBg));
      if (worst < 3) {
        list.push("These colors are too close together for phones to read. Pick darker dots or a lighter background.");
      } else if (R.luminance(o.colorDots) > R.luminance(o.colorBg) || R.luminance(o.colorMarkers) > R.luminance(o.colorBg)) {
        list.push("Light dots on a dark background don't scan on some phones. Dark on light is the safe choice.");
      }
    } else {
      list.push("With a transparent background, place the code on something light and plain.");
    }

    if (o.logo && result.lowered) {
      list.push("This much content leaves little room for a logo. Shorten the content or shrink the logo, then test the code.");
    }

    if (result.modules >= 77) {
      list.push("This code holds a lot, so its dots are small. Print it large, or shorten the content.");
    }

    return list;
  }

  function showNotes(list) {
    notes.textContent = "";
    list.forEach(function (text) {
      var li = document.createElement("li");
      li.textContent = text;
      notes.appendChild(li);
    });
    syncStatus();
  }

  function showMessage(text, isError) {
    message.hidden = !text;
    message.textContent = text || "";
    message.classList.toggle("is-error", !!isError);
    syncStatus();
  }

  /* The status box only shows when it has something to say. */
  function syncStatus() {
    statusBox.hidden = message.hidden && !notes.children.length;
  }

  function setDownloads(on) {
    btnPng.disabled = !on;
    btnSvg.disabled = !on;
  }

  /* ---------- drawing ---------- */

  function draw() {
    syncControls();

    var payload = buildPayload();
    var options = readOptions(payload.text || SAMPLE);
    var result;

    try {
      result = QraftyRender.render(options);
    } catch (err) {
      current = null;
      setDownloads(false);
      codeBox.classList.add("is-sample");
      showNotes([]);
      if (err && err.code === "TOO_LONG") {
        showMessage("That's too much content for one QR code. Shorten it and the code comes back.", true);
      } else {
        showMessage("Qrafty couldn't draw this code. Reload the page and try again.", true);
        if (window.console) console.error(err);
      }
      return;
    }

    codeBox.innerHTML = result.svg;
    codeBox.classList.toggle("is-transparent", options.transparent);
    codeBox.classList.toggle("is-sample", !payload.text);

    if (payload.text) {
      current = { result: result, type: val("type") };
      setDownloads(true);
      showMessage("");
      showNotes(buildNotes(options, result));
      payloadBox.textContent = payload.text;
    } else {
      current = null;
      setDownloads(false);
      showMessage(payload.empty);
      showNotes([]);
      payloadBox.textContent = "Nothing yet. Add your content first.";
    }
  }

  /* Show the fields that match the chosen options. */
  function syncControls() {
    var type = val("type");
    Array.prototype.forEach.call(document.querySelectorAll("[data-fields]"), function (box) {
      box.hidden = box.getAttribute("data-fields") !== type;
    });

    document.querySelector("[data-wifi-password]").hidden = val("wifiSecurity") === "nopass";

    var match = isChecked("markersMatch");
    var markers = form.elements.colorMarkers;
    if (match) markers.value = val("colorDots");
    markers.disabled = match;
    markers.closest(".color").classList.toggle("is-off", match);

    Array.prototype.forEach.call(document.querySelectorAll("[data-hex]"), function (out) {
      out.textContent = val(out.getAttribute("data-hex")).toLowerCase();
    });

    $("label-field").hidden = val("frame") === "none";
    $("logo-size-out").textContent = val("logoSize") + "%";
  }

  /* ---------- logo ---------- */

  function logoError(text) {
    var box = $("logo-error");
    box.hidden = !text;
    box.textContent = text || "";
    box.classList.toggle("is-error", !!text);
  }

  function setLogo(next, name) {
    logo = next;
    $("logo-remove").hidden = !logo;
    $("logo-size-field").hidden = !logo;
    $("logo-name").textContent = logo ? name : "";
    $("logo-choose").textContent = logo ? "Choose another image" : "Choose an image";
    draw();
  }

  /* Redraw the chosen image as a PNG so the finished code is one self-contained file. */
  function loadLogo(file) {
    if (!file) return;
    logoError("");
    var unreadable = "Qrafty can't read that file as an image. Try a PNG, JPG or SVG.";
    var reader = new FileReader();
    reader.onerror = function () { logoError(unreadable); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { logoError(unreadable); };
      img.onload = function () {
        var w = img.naturalWidth || 512;
        var h = img.naturalHeight || 512;
        var longest = Math.max(w, h);
        var scale = file.type === "image/svg+xml" ? 512 / longest : Math.min(1, 512 / longest);
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          setLogo({ href: canvas.toDataURL("image/png"), ratio: w / h }, file.name);
        } catch (e) {
          logoError(unreadable);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  $("logo-file").addEventListener("change", function () {
    loadLogo(this.files && this.files[0]);
    this.value = "";
  });

  $("logo-remove").addEventListener("click", function () {
    logoError("");
    setLogo(null, "");
  });

  /* ---------- downloads ---------- */

  function save(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function svgToPng(result, width, done) {
    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round((width * result.height) / result.width);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (blob) { done(blob); }, "image/png");
    };
    img.onerror = function () { done(null); };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(result.svg);
  }

  btnSvg.addEventListener("click", function () {
    if (!current) return;
    save(new Blob([current.result.svg], { type: "image/svg+xml" }), "qrafty-" + current.type + ".svg");
  });

  btnPng.addEventListener("click", function () {
    if (!current) return;
    var picked = current;
    svgToPng(picked.result, parseInt(pngSize.value, 10), function (blob) {
      if (!blob) {
        showMessage("The PNG couldn't be made in this browser. Download the SVG instead.", true);
        return;
      }
      save(blob, "qrafty-" + picked.type + ".png");
    });
  });

  /* ---------- the little pictures on the shape tiles ---------- */

  function drawTileArt() {
    var R = QraftyRender;
    var pattern = ["1101", "0110", "1011", "1100"];
    function sample(r, c) {
      return r >= 0 && c >= 0 && r < 4 && c < 4 && pattern[r].charAt(c) === "1";
    }
    var faint = ' fill="currentColor" fill-opacity="0.3" fill-rule="evenodd"';
    var solid = ' fill="currentColor" fill-rule="evenodd"';

    Array.prototype.forEach.call(document.querySelectorAll("[data-art]"), function (box) {
      var parts = box.getAttribute("data-art").split(":");
      var kind = parts[0], style = parts[1], inner, view;

      if (kind === "dots") {
        view = "0 0 40 40";
        inner = "<path" + solid + ' d="' + R.dotsPath(sample, 4, style, 0, 0) + '"/>';
      } else if (kind === "frame") {
        view = "0 0 70 70";
        inner = "<path" + solid + ' d="' + R.markerFramePath(style, 0, 0) + '"/>' +
                "<path" + faint + ' d="' + R.markerDotPath("square", 0, 0) + '"/>';
      } else {
        view = "0 0 70 70";
        inner = "<path" + faint + ' d="' + R.markerFramePath("square", 0, 0) + '"/>' +
                "<path" + solid + ' d="' + R.markerDotPath(style, 0, 0) + '"/>';
      }
      box.innerHTML = '<svg viewBox="' + view + '" aria-hidden="true">' + inner + "</svg>";
    });
  }

  /* ---------- start ---------- */

  form.addEventListener("submit", function (e) { e.preventDefault(); });
  form.addEventListener("input", draw);
  form.addEventListener("change", draw);

  drawTileArt();
  draw();
})();
