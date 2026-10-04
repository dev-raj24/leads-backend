(function () {
  var CUR = document.currentScript;
  if (!CUR) return;
  var SITE_KEY = CUR.getAttribute("data-site-key");
  var API = (CUR.getAttribute("data-api") || "").replace(/\/$/, "");
  var PREVIEW = safeJSONParse(CUR.getAttribute("data-preview"));
  if (!PREVIEW && (!SITE_KEY || !API)) {
    console.error("[leadworks] widget.js is missing data-site-key or data-api");
    return;
  }

  var LIME = "#d9f99d";
  var Z = 2147483000;

  var BASE_CSS =
    ":host{display:block}" +
    "*{box-sizing:border-box}" +
    ".lw-root{font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#121a26;" +
    "--lw-accent:#0b5d4b;--lw-on-accent:#fff;--lw-bg:#0b5d4b;--lw-fg:#fff;--lw-btn-bg:#d9f99d;--lw-btn-fg:#121a26;--lw-radius:14px;--lw-btn-radius:999px}" +
    ".lw-root.lw-square{--lw-radius:4px;--lw-btn-radius:4px}" +
    ".lw-root.lw-inherit-font{font-family:inherit}" +
    "button,input,textarea{font:inherit;color:inherit}" +
    /* offer banner */
    ".lw-offer{position:fixed;z-index:" +
    Z +
    ";display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--lw-bg);color:var(--lw-fg);box-shadow:0 2px 12px rgba(0,0,0,.2)}" +
    ".lw-offer.lw-corner{bottom:16px;max-width:360px;border-radius:var(--lw-radius)}" +
    ".lw-offer.lw-left{left:16px}.lw-offer.lw-right{right:16px}" +
    ".lw-offer.lw-soft{border:1px solid var(--lw-border)}" +
    ".lw-offer-text{flex:1;min-width:0}" +
    ".lw-offer-title{font-weight:600}" +
    ".lw-offer-body{opacity:.85;font-size:13px;margin-top:2px}" +
    ".lw-offer-btn{background:var(--lw-btn-bg);color:var(--lw-btn-fg);border:0;border-radius:var(--lw-btn-radius);padding:8px 14px;font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap}" +
    ".lw-offer-close{background:none;border:0;color:inherit;opacity:.7;cursor:pointer;font-size:18px;line-height:1;padding:0 2px}" +
    /* popup + inline card */
    ".lw-overlay{position:fixed;inset:0;z-index:" +
    (Z + 1) +
    ";background:rgba(18,26,38,.55);display:flex;align-items:center;justify-content:center;padding:16px}" +
    ".lw-modal{position:relative;width:100%;max-width:420px;max-height:90vh;overflow:auto;background:#fdfcf9;color:#121a26;border-radius:var(--lw-radius);padding:30px 24px 24px;box-shadow:0 20px 60px rgba(0,0,0,.35)}" +
    ".lw-modal.lw-inline{max-width:480px;box-shadow:none;border:1px solid #e5e0d8;max-height:none;overflow:hidden}" +
    ".lw-modal-accent{position:absolute;top:0;left:0;right:0;height:6px;background:var(--lw-accent)}" +
    ".lw-modal-close{position:absolute;top:10px;right:12px;background:none;border:0;font-size:24px;line-height:1;cursor:pointer;opacity:.55}" +
    ".lw-modal-title{margin:0 0 6px;font-size:20px;font-weight:700;line-height:1.25}" +
    ".lw-modal-body{margin:0 0 16px;color:#384860}" +
    ".lw-form{display:flex;flex-direction:column;gap:10px}" +
    ".lw-input{width:100%;border:1px solid #d8d2c4;border-radius:calc(var(--lw-radius) * .6);padding:10px 12px;background:#fff;outline:none}" +
    ".lw-input:focus{border-color:var(--lw-accent)}" +
    ".lw-submit,.lw-action{background:var(--lw-accent);color:var(--lw-on-accent);border:0;border-radius:var(--lw-btn-radius);padding:11px 16px;font-weight:600;cursor:pointer}" +
    ".lw-submit[disabled]{opacity:.6;cursor:default}" +
    ".lw-error{color:#b91c1c;font-size:13px}" +
    ".lw-success{text-align:center;padding:6px 0}" +
    ".lw-success-title{font-size:18px;font-weight:700;margin-bottom:6px}" +
    ".lw-code{display:inline-block;margin-top:12px;padding:8px 16px;border:2px dashed var(--lw-accent);border-radius:8px;font-weight:700;letter-spacing:.08em;font-size:16px}" +
    /* chat */
    ".lw-chat-launcher{position:fixed;z-index:" +
    Z +
    ";bottom:16px;border:0;cursor:pointer;background:var(--lw-accent);color:var(--lw-on-accent);box-shadow:0 4px 16px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600;font-size:14px;width:56px;height:56px;border-radius:50%}" +
    ".lw-chat-launcher.lw-label{width:auto;height:48px;padding:0 20px;border-radius:var(--lw-btn-radius)}" +
    ".lw-chat-launcher.lw-left,.lw-chat-panel.lw-left{left:16px}.lw-chat-launcher.lw-right,.lw-chat-panel.lw-right{right:16px}" +
    ".lw-dot{display:none;position:absolute;top:-2px;width:14px;height:14px;border-radius:50%;background:#e11d48;border:2px solid #fff}" +
    ".lw-right .lw-dot{right:-2px}.lw-left .lw-dot{left:-2px}" +
    ".lw-chat-panel{position:fixed;z-index:" +
    Z +
    ";bottom:82px;width:340px;max-width:calc(100vw - 32px);max-height:70vh;background:#fdfcf9;border-radius:var(--lw-radius);box-shadow:0 8px 32px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden}" +
    ".lw-chat-header{background:var(--lw-accent);color:var(--lw-on-accent);padding:14px 16px}" +
    ".lw-chat-title{font-weight:600;font-size:15px}" +
    ".lw-chat-sub{opacity:.85;font-size:12px;margin-top:2px}" +
    ".lw-chat-body{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:160px}" +
    ".lw-line{display:flex;flex-direction:column}.lw-line.lw-me{align-items:flex-end}.lw-line.lw-them{align-items:flex-start}" +
    ".lw-msg{max-width:80%;padding:8px 12px;border-radius:var(--lw-radius);white-space:pre-wrap;word-break:break-word}" +
    ".lw-msg-me{background:var(--lw-accent);color:var(--lw-on-accent)}" +
    ".lw-msg-ai{background:#efece3;color:#121a26}" +
    ".lw-msg-team{background:" +
    LIME +
    ";color:#121a26}" +
    ".lw-tag{font-size:11px;color:#6b7280;margin:0 4px 2px}" +
    ".lw-chat-note{text-align:center;font-size:12px;color:#6b7280}" +
    ".lw-chat-row{border-top:1px solid #e5e0d8;padding:10px;display:flex;gap:8px}" +
    ".lw-chat-input{flex:1;min-width:0;border:1px solid #d8d2c4;border-radius:var(--lw-btn-radius);padding:8px 14px;outline:none;background:#fff}" +
    ".lw-chat-send{background:var(--lw-accent);color:var(--lw-on-accent);border:0;border-radius:var(--lw-btn-radius);padding:8px 16px;font-weight:600;font-size:13px;cursor:pointer}" +
    /* blog */
    ".lw-root.lw-blog{color:inherit;font-size:15px;line-height:1.6}" +
    ".lw-blog-card{margin:0 0 28px;padding-bottom:28px;border-bottom:1px solid #e5e0d8}" +
    ".lw-blog-title{margin:0 0 4px;font-size:20px}" +
    ".lw-blog-title a{color:inherit;text-decoration:none}" +
    ".lw-blog-date{color:#6b7280;font-size:13px;margin-bottom:8px}" +
    ".lw-blog-excerpt{margin:0;opacity:.8}" +
    ".lw-blog-back{display:inline-block;margin-bottom:16px;padding:0;background:none;border:0;color:var(--lw-accent);font-size:14px;cursor:pointer}" +
    ".lw-blog-h1{margin:0 0 4px;font-size:28px;line-height:1.25}" +
    ".lw-blog-content{white-space:pre-wrap}" +
    ".lw-blog-empty{opacity:.7}" +
    ".lw-formcard{display:grid;gap:12px;max-width:460px;font-size:15px;line-height:1.4}" +
    ".lw-formcard h3{margin:0;font-size:20px}" +
    ".lw-formcard label{display:grid;gap:4px;font-size:13px;font-weight:600}" +
    ".lw-formcard textarea.lw-input{min-height:84px;resize:vertical;font:inherit}" +
    ".lw-formcard .lw-input{font-weight:400}" +
    ".lw-formcard select.lw-input{font:inherit;font-weight:400}";

  // ------------------------------------------------------------------ helpers
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function safeJSONParse(s) {
    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  // localStorage is unavailable in sandboxed frames and some privacy modes.
  var store = {
    get: function (k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set: function (k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {}
    },
  };

  function api(path, opts) {
    return fetch(API + path, opts).then(function (r) {
      if (!r.ok) {
        return r
          .json()
          .catch(function () {
            return {};
          })
          .then(function (b) {
            throw new Error(b.error || "request_failed");
          });
      }
      return r.json();
    });
  }

  function post(path, body) {
    return api(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // One shadow-root host per widget piece. `into` = an existing element (inline) or document.body.
  function mount(into, design, customCss) {
    var host = document.createElement("div");
    host.setAttribute("data-leadworks", "");
    (into || document.body).appendChild(host);
    var shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var style = document.createElement("style");
    style.textContent = BASE_CSS + "\n" + (customCss || "");
    shadow.appendChild(style);
    var root = el(
      "div",
      "lw-root" +
        (design.fontFamily === "inherit" ? " lw-inherit-font" : "") +
        (design.radius === "square" ? " lw-square" : ""),
    );
    shadow.appendChild(root);
    return { host: host, root: root };
  }

  // ---- brand colour: "auto" reads the colour the owner's own website already uses --------------
  var DEFAULT_BRAND = "#0b5d4b";
  var detectedBrand;

  // Any CSS colour string (hex, rgb, hsl, named, var()) -> {r,g,b,a}, by letting the browser compute it.
  function computeColor(value) {
    if (!value) return null;
    var probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;color:" + value;
    if (!probe.style.color) return null;
    (document.body || document.documentElement).appendChild(probe);
    var rgb = getComputedStyle(probe).color;
    probe.remove();
    var m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/.exec(rgb);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  }

  function hex(c) {
    return "#" + [c.r, c.g, c.b].map(function (n) { return ("0" + n.toString(16)).slice(-2); }).join("");
  }

  function hsl(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    var sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return { s: sat, l: l };
  }

  // A brand colour is visible and clearly coloured: not white, black or grey, and not see-through.
  function looksLikeBrand(c) {
    if (!c || c.a < 0.6) return false;
    var h = hsl(c);
    return h.s > 0.28 && h.l > 0.14 && h.l < 0.86;
  }

  function luminance(c) {
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  // Text colour that stays readable on top of the accent.
  function readableOn(colorHex) {
    var c = computeColor(colorHex);
    return c && luminance(c) > 0.42 ? "#111827" : "#ffffff";
  }

  function isShown(node) {
    var r = node.getBoundingClientRect();
    return r.width > 36 && r.height > 18 && getComputedStyle(node).visibility !== "hidden";
  }

  function detectBrand() {
    if (detectedBrand !== undefined) return detectedBrand;
    var found = null;
    var take = function (value) {
      var c = computeColor(value);
      if (looksLikeBrand(c)) { found = hex(c); return true; }
      return false;
    };
    try {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta && take(meta.getAttribute("content"))) return (detectedBrand = found);

      var rootStyle = getComputedStyle(document.documentElement);
      var vars = ["--primary", "--primary-color", "--brand", "--brand-color", "--color-primary", "--accent", "--accent-color", "--theme-color", "--main-color", "--bs-primary", "--wp--preset--color--primary", "--e-global-color-primary"];
      for (var i = 0; i < vars.length; i++) {
        var v = rootStyle.getPropertyValue(vars[i]).trim();
        if (v && take(v)) return (detectedBrand = found);
      }

      var ctas = document.querySelectorAll('a[class*="btn"], button[class*="btn"], .button, a[class*="button"], button[class*="button"], [class*="cta"], [class*="primary"], button[type="submit"], input[type="submit"]');
      for (var j = 0; j < ctas.length && j < 60; j++) {
        if (isShown(ctas[j]) && take(getComputedStyle(ctas[j]).backgroundColor)) return (detectedBrand = found);
      }

      var bars = document.querySelectorAll("header, nav, [class*='navbar'], [class*='header']");
      for (var k = 0; k < bars.length && k < 8; k++) {
        if (take(getComputedStyle(bars[k]).backgroundColor)) return (detectedBrand = found);
      }

      var links = document.querySelectorAll("main a, article a, p a, a");
      for (var n = 0; n < links.length && n < 40; n++) {
        if (isShown(links[n]) && take(getComputedStyle(links[n]).color)) return (detectedBrand = found);
      }
    } catch (e) {}
    return (detectedBrand = null);
  }

  // "auto" -> the website's own colour, or the default green if none is found. Anything else is used as given.
  function resolveBrand(setting) {
    if (setting === "auto" || !setting) return detectBrand() || DEFAULT_BRAND;
    return setting;
  }

  function offerVars(root, offer) {
    var base = resolveBrand(offer.color);
    var soft = offer.styleVariant === "soft";
    var onBase = readableOn(base);
    root.style.setProperty("--lw-accent", base);
    root.style.setProperty("--lw-on-accent", onBase);
    root.style.setProperty("--lw-bg", soft ? base + "22" : base);
    root.style.setProperty("--lw-border", base + "55");
    root.style.setProperty("--lw-fg", offer.textColor || (soft ? base : onBase));
    root.style.setProperty("--lw-btn-bg", soft ? base : LIME);
    root.style.setProperty("--lw-btn-fg", soft ? onBase : "#121a26");
  }

  function validContact(v) {
    return v.indexOf("@") !== -1 || /\d{6,}/.test(v);
  }

  // ------------------------------------------------------------------ entry
  if (PREVIEW) {
    window.onerror = function (msg) {
      var pre = document.createElement("pre");
      pre.style.cssText = "position:fixed;left:8px;bottom:8px;margin:0;color:#b91c1c;font:11px monospace;white-space:pre-wrap";
      pre.textContent = "Preview error: " + msg;
      document.body.appendChild(pre);
    };
    runPreview(PREVIEW);
    return;
  }

  var activeOffer = null;
  var configReady = false;
  var blogEnabled = false;

  function scan() {
    if (!configReady) return;
    mountInline(activeOffer);
    mountForm();
    if (blogEnabled) mountBlog();
  }

  // Sites built with React, Wix or Webflow add our placeholders after the page has loaded.
  function watchDom() {
    if (!window.MutationObserver) return;
    var timer;
    new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(scan, 150);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  api("/api/public/widget-config?siteKey=" + encodeURIComponent(SITE_KEY))
    .then(function (data) {
      var chatOn = data.chat && data.chat.enabled;
      var chatSide = chatOn
        ? (data.chat.design || {}).position === "left"
          ? "left"
          : "right"
        : null;
      activeOffer = data.offer || null;
      blogEnabled = !!(data.blog && data.blog.enabled);
      formConfig = data.form || { fields: [] };
      if (data.offer) showOffer(data.offer, chatSide);
      if (chatOn) renderChat(data.chat.design || {}, false);
      configReady = true;
      whenReady(scan);
    })
    .catch(function (err) {
      console.error("[leadworks] widget-config failed:", err.message);
    });

  whenReady(watchDom);

  function whenReady(fn) {
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  // ------------------------------------------------------------------ offers
  function showOffer(offer, chatSide, preview) {
    var mode = offer.displayMode || "bottom-left";
    if (mode === "none" || mode === "hidden") return;
    if (mode === "modal") {
      var key = "leadworks_offer_" + offer.id;
      var seen = safeJSONParse(store.get(key)) || {};
      if (
        !preview &&
        (seen.submitted ||
          (seen.dismissedAt && Date.now() - seen.dismissedAt < 86400000))
      )
        return;
      var delay = preview
        ? 0
        : Math.max(0, Number(offer.modalDelay) || 0) * 1000;
      setTimeout(function () {
        openModal(offer, preview);
      }, delay);
      return;
    }
    renderBanner(offer, chatSide, preview);
  }

  function renderBanner(offer, chatSide, preview) {
    var m = mount(null, offer, offer.customCss);
    offerVars(m.root, offer);
    var bar = el(
      "div",
      "lw-offer lw-corner " +
        (chatSide === "left" ? "lw-right" : "lw-left") +
        (offer.styleVariant === "soft" ? " lw-soft" : ""),
    );
    var text = el("div", "lw-offer-text");
    text.appendChild(el("div", "lw-offer-title", offer.title));
    if (offer.body) text.appendChild(el("div", "lw-offer-body", offer.body));
    bar.appendChild(text);

    var btn = el("button", "lw-offer-btn", offer.actionText || "Claim offer");
    btn.onclick = function () {
      if (offer.actionType === "form") openModal(offer, preview);
      else runAction(offer, btn);
    };
    bar.appendChild(btn);

    var close = el("button", "lw-offer-close", "×");
    close.setAttribute("aria-label", "Dismiss");
    close.onclick = function () { m.host.remove(); };
    bar.appendChild(close);
    m.root.appendChild(bar);
  }

  function runAction(offer, btn) {
    if (offer.actionType === "whatsapp" && offer.whatsappNumber) {
      window.open(
        "https://wa.me/" + offer.whatsappNumber.replace(/[^\d]/g, ""),
        "_blank",
      );
    } else if (offer.actionType === "promo" && offer.promoCode) {
      btn.textContent = offer.promoCode;
      if (navigator.clipboard)
        navigator.clipboard.writeText(offer.promoCode).catch(function () {});
    } else if (offer.targetUrl) {
      window.open(offer.targetUrl, "_blank");
    }
  }

  function openModal(offer, preview) {
    if (
      !preview &&
      document.querySelector("[data-leadworks-modal='" + offer.id + "']")
    )
      return;
    var m = mount(null, offer, offer.customCss);
    m.host.setAttribute("data-leadworks-modal", offer.id || "preview");
    offerVars(m.root, offer);
    var overlay = el("div", "lw-overlay");
    var key = "leadworks_offer_" + offer.id;

    function dismiss() {
      if (!preview) {
        var seen = safeJSONParse(store.get(key)) || {};
        seen.dismissedAt = Date.now();
        store.set(key, JSON.stringify(seen));
      }
      m.host.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape") dismiss();
    }
    document.addEventListener("keydown", onKey);
    overlay.onclick = function (e) {
      if (e.target === overlay) dismiss();
    };

    var card = offerCard(offer, {
      close: dismiss,
      preview: preview,
      onSubmitted: function () {
        var seen = safeJSONParse(store.get(key)) || {};
        seen.submitted = true;
        store.set(key, JSON.stringify(seen));
      },
    });
    overlay.appendChild(card);
    m.root.appendChild(overlay);
  }

  // The offer as a card: title, text, then either a lead form or a single action button.
  function offerCard(offer, ctx) {
    var card = el("div", "lw-modal" + (ctx.inline ? " lw-inline" : ""));
    card.appendChild(el("div", "lw-modal-accent"));
    if (ctx.close) {
      var x = el("button", "lw-modal-close", "×");
      x.setAttribute("aria-label", "Close");
      x.onclick = ctx.close;
      card.appendChild(x);
    }
    var content = el("div", "lw-modal-content");
    card.appendChild(content);

    content.appendChild(el("h3", "lw-modal-title", offer.title));
    if (offer.body) content.appendChild(el("p", "lw-modal-body", offer.body));

    if (offer.actionType !== "form") {
      var act = el("button", "lw-action", offer.actionText || "Claim offer");
      act.onclick = function () {
        runAction(offer, act);
      };
      content.appendChild(act);
      return card;
    }

    var form = el("form", "lw-form");
    var name = el("input", "lw-input");
    name.placeholder = "Your name";
    name.autocomplete = "name";
    var contact = el("input", "lw-input");
    contact.placeholder = "Phone number or email";
    contact.autocomplete = "email";
    var trap = el("input");
    trap.name = "website";
    trap.tabIndex = -1;
    trap.setAttribute("autocomplete", "off");
    trap.style.cssText =
      "position:absolute;left:-9999px;opacity:0;height:0;width:0";
    var error = el("div", "lw-error");
    var submit = el(
      "button",
      "lw-submit",
      offer.actionText || "Get this offer",
    );
    submit.type = "submit";
    [name, contact, trap, error, submit].forEach(function (n) {
      form.appendChild(n);
    });
    content.appendChild(form);

    function done(res) {
      content.innerHTML = "";
      var ok = el("div", "lw-success");
      ok.appendChild(el("div", "lw-success-title", "You're in!"));
      ok.appendChild(
        el(
          "div",
          "lw-success-text",
          (res && res.successMessage) || "Thanks! We'll be in touch very soon.",
        ),
      );
      if (res && res.promoCode)
        ok.appendChild(el("div", "lw-code", res.promoCode));
      content.appendChild(ok);
      if (ctx.onSubmitted) ctx.onSubmitted();
    }

    form.onsubmit = function (e) {
      e.preventDefault();
      error.textContent = "";
      var c = contact.value.trim();
      if (!validContact(c)) {
        error.textContent = "Please enter a valid phone number or email.";
        return;
      }
      if (ctx.preview) {
        done({
          successMessage: offer.successMessage || "",
          promoCode: offer.promoCode || "",
        });
        return;
      }
      submit.disabled = true;
      submit.textContent = "Sending…";
      post("/api/public/offers/" + encodeURIComponent(offer.id) + "/lead", {
        siteKey: SITE_KEY,
        name: name.value.trim() || undefined,
        contact: c,
        website: trap.value,
      })
        .then(done)
        .catch(function () {
          error.textContent = "Something went wrong. Please try again.";
          submit.disabled = false;
          submit.textContent = offer.actionText || "Get this offer";
        });
    };
    return card;
  }

  // <div data-leadworks-offer></div> — inline card, shows the live offer (or the pinned one).
  function mountInline(activeOffer) {
    var nodes = document.querySelectorAll("[data-leadworks-offer]");
    Array.prototype.forEach.call(nodes, function (node) {
      if (node.hasAttribute("data-leadworks-mounted")) return;
      node.setAttribute("data-leadworks-mounted", "");
      var pinned = node.getAttribute("data-leadworks-offer");
      var load = pinned
        ? api(
            "/api/public/offers/" +
              encodeURIComponent(pinned) +
              "?siteKey=" +
              encodeURIComponent(SITE_KEY),
          ).then(function (r) {
            return r.offer;
          })
        : Promise.resolve(activeOffer);
      load
        .then(function (offer) {
          if (offer) drawInline(node, offer);
        })
        .catch(function () {});
    });
  }

  function drawInline(node, offer) {
    var m = mount(node, offer, offer.customCss);
    offerVars(m.root, offer);
    m.root.appendChild(offerCard(offer, { inline: true, preview: !!PREVIEW }));
  }

  // ------------------------------------------------------------------ chat
  function renderChat(design, preview) {
    var side = design.position === "left" ? "left" : "right";
    var storeKey = "leadworks_chat_" + SITE_KEY;
    var saved = preview ? {} : safeJSONParse(store.get(storeKey)) || {};
    var panel = null;
    var cursor = null;
    var pollTimer = null;

    var m = mount(null, design, design.customCss);
    var accent = resolveBrand(design.color);
    m.root.style.setProperty("--lw-accent", accent);
    m.root.style.setProperty("--lw-on-accent", readableOn(accent));

    var launcher = el(
      "button",
      "lw-chat-launcher lw-" +
        side +
        (design.launcher === "label" ? " lw-label" : ""),
    );
    launcher.setAttribute("aria-label", design.title || "Chat");
    var icon =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 4h16v12H7l-3 3V4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    launcher.innerHTML =
      icon + (design.launcher === "label" ? "<span></span>" : "");
    if (design.launcher === "label")
      launcher.querySelector("span").textContent =
        design.launcherLabel || "Chat with us";
    var dot = el("span", "lw-dot");
    launcher.appendChild(dot);
    m.root.appendChild(launcher);

    launcher.onclick = function () {
      if (panel) closePanel();
      else openPanel();
    };

    function closePanel() {
      if (panel) {
        panel.root.remove();
        panel = null;
      }
      schedulePoll();
    }

    function openPanel() {
      dot.style.display = "none";
      panel = buildPanel();
      m.root.appendChild(panel.root);
      if (saved.leadId) panel.load();
      schedulePoll();
    }

    function schedulePoll() {
      clearTimeout(pollTimer);
      if (!saved.leadId || preview) return;
      pollTimer = setTimeout(poll, panel ? 4000 : 20000);
    }

    function poll() {
      if (!saved.leadId) return;
      var seeding = !cursor;
      var q =
        "?siteKey=" +
        encodeURIComponent(SITE_KEY) +
        (cursor ? "&after=" + encodeURIComponent(cursor) : "");
      api("/api/public/chat/" + saved.leadId + "/messages" + q)
        .then(function (res) {
          absorb(res.messages || [], false, seeding);
        })
        .catch(function () {})
        .then(schedulePoll);
    }

    // Take messages from the server; render only what the visitor hasn't already seen.
    function absorb(list, everything, silent) {
      var gotNew = false;
      list.forEach(function (msg) {
        if (!cursor || Date.parse(msg.createdAt) > Date.parse(cursor))
          cursor = msg.createdAt;
        if (silent) return;
        if (msg.from === "visitor" && !everything) return;
        if (panel) panel.add(msg.body, msg.from);
        if (msg.from !== "visitor") gotNew = true;
      });
      if (gotNew && !panel && !everything) dot.style.display = "block";
    }

    if (saved.leadId) pollTimer = setTimeout(poll, 1500);

    function buildPanel() {
      var root = el("div", "lw-chat-panel lw-" + side);
      var header = el("div", "lw-chat-header");
      header.appendChild(
        el("div", "lw-chat-title", design.title || "Chat with us"),
      );
      if (design.subtitle)
        header.appendChild(el("div", "lw-chat-sub", design.subtitle));
      root.appendChild(header);

      var body = el("div", "lw-chat-body");
      root.appendChild(body);

      var row = el("div", "lw-chat-row");
      var input = el("input", "lw-chat-input");
      input.placeholder = "Type a message…";
      var send = el("button", "lw-chat-send", "Send");
      row.appendChild(input);
      row.appendChild(send);
      root.appendChild(row);

      // who: "me" / "visitor" (the visitor) | "ai" | "team"
      function add(text, who) {
        var mine = who === "me" || who === "visitor";
        var kind = mine ? "me" : who === "team" ? "team" : "ai";
        var line = el("div", "lw-line " + (mine ? "lw-me" : "lw-them"));
        if (kind === "team") line.appendChild(el("div", "lw-tag", "Team"));
        line.appendChild(el("div", "lw-msg lw-msg-" + kind, text));
        body.appendChild(line);
        body.scrollTop = body.scrollHeight;
      }

      function note(text) {
        body.appendChild(el("div", "lw-chat-note", text));
        body.scrollTop = body.scrollHeight;
      }

      function load() {
        api(
          "/api/public/chat/" +
            saved.leadId +
            "/messages?siteKey=" +
            encodeURIComponent(SITE_KEY),
        )
          .then(function (res) {
            body.innerHTML = "";
            cursor = null;
            absorb(res.messages || [], true);
          })
          .catch(function () {
            add(design.greeting, "ai");
          });
      }

      if (preview) {
        add(design.greeting, "ai");
        add("Hi, what are your timings?", "me");
        add("We're open 10 AM – 7 PM, Mon–Sat.", "team");
        return { root: root, add: add, load: load };
      }

      if (!saved.leadId)
        add(design.greeting || "Hi! How can we help you today?", "ai");

      var sending = false;
      function unlock() {
        input.disabled = false;
        send.disabled = false;
        sending = false;
        input.focus();
      }

      function submit() {
        var text = input.value.trim();
        if (!text || sending) return;
        sending = true;
        input.value = "";
        input.disabled = true;
        send.disabled = true;

        if (!saved.leadId) {
          add(text, "me");
          post("/api/public/chat/start", {
            siteKey: SITE_KEY,
            message: text,
          })
            .then(function (res) {
              saved = { leadId: res.leadId };
              store.set(storeKey, JSON.stringify(saved));
              add(res.reply, "ai");
              cursor = res.cursor || cursor;
              schedulePoll();
            })
            .catch(function () {
              add(
                "Sorry, something went wrong. Please try again in a moment.",
                "ai",
              );
            })
            .then(unlock);
          return;
        }

        add(text, "me");
        post("/api/public/chat/" + saved.leadId + "/message", {
          siteKey: SITE_KEY,
          message: text,
        })
          .then(function (res) {
            if (res.reply) add(res.reply, "ai");
            else note("A team member will reply here shortly.");
            cursor = res.cursor || cursor;
          })
          .catch(function () {
            add(
              "Sorry, something went wrong. Please try again in a moment.",
              "ai",
            );
          })
          .then(unlock);
      }

      send.onclick = submit;
      input.onkeydown = function (e) {
        if (e.key === "Enter") submit();
      };

      return { root: root, add: add, load: load };
    }

    if (preview) openPanel();
  }

  // ------------------------------------------------------------------ form
  // <div data-leadworks-form></div> — the enquiry form, with the fields the owner chose in Settings.
  var formConfig = { fields: [] };

  function mountForm() {
    var nodes = document.querySelectorAll("[data-leadworks-form]");
    Array.prototype.forEach.call(nodes, function (node) {
      if (node.hasAttribute("data-leadworks-mounted")) return;
      node.setAttribute("data-leadworks-mounted", "");
      var m = mount(node, { fontFamily: "inherit" }, "");
      var accent = resolveBrand("auto");
      m.root.style.setProperty("--lw-accent", accent);
      m.root.style.setProperty("--lw-on-accent", readableOn(accent));
      m.root.classList.add("lw-inherit-font");
      drawForm(m.root, node);
    });
  }

  function drawForm(root, node) {
    var form = el("form", "lw-formcard");
    var title = node.getAttribute("data-title");
    if (title) form.appendChild(el("h3", "", title));

    function field(labelText, control) {
      var label = el("label", "", labelText);
      label.appendChild(control);
      form.appendChild(label);
      return control;
    }

    var name = field("Your name", el("input", "lw-input"));
    name.autocomplete = "name";
    var contact = field("Phone number or email", el("input", "lw-input"));
    contact.autocomplete = "email";
    contact.required = true;

    var extras = [];
    (formConfig.fields || []).forEach(function (f) {
      var control;
      if (f.options && f.options.length) {
        control = el("select", "lw-input");
        var blank = el("option", "", "Choose one");
        blank.value = "";
        control.appendChild(blank);
        f.options.forEach(function (o) {
          var opt = el("option", "", o);
          opt.value = o;
          control.appendChild(opt);
        });
      } else {
        control = el("input", "lw-input");
      }
      field(f.name + (f.required ? " *" : ""), control);
      extras.push({ field: f, control: control });
    });

    var message = field("Message", el("textarea", "lw-input"));
    var trap = el("input");
    trap.name = "website";
    trap.tabIndex = -1;
    trap.setAttribute("autocomplete", "off");
    trap.style.cssText = "position:absolute;left:-9999px;opacity:0;height:0;width:0";
    var error = el("div", "lw-error");
    var submit = el("button", "lw-submit", node.getAttribute("data-button") || "Send enquiry");
    submit.type = "submit";
    [trap, error, submit].forEach(function (n) {
      form.appendChild(n);
    });
    root.appendChild(form);

    form.onsubmit = function (e) {
      e.preventDefault();
      error.textContent = "";
      var c = contact.value.trim();
      if (!validContact(c)) {
        error.textContent = "Please enter a valid phone number or email.";
        return;
      }
      var fields = {};
      for (var i = 0; i < extras.length; i++) {
        var v = extras[i].control.value.trim();
        if (!v && extras[i].field.required) {
          error.textContent = "Please fill in " + extras[i].field.name + ".";
          return;
        }
        if (v) fields[extras[i].field.name] = v;
      }
      submit.disabled = true;
      submit.textContent = "Sending\u2026";
      post("/api/ingest/lead", {
        site_key: SITE_KEY,
        name: name.value.trim(),
        contact: c,
        message: message.value.trim(),
        fields: fields,
        website: trap.value,
        source: "form",
        wait: false,
      })
        .then(function () {
          root.innerHTML = "";
          var ok = el("div", "lw-success");
          ok.appendChild(el("div", "lw-success-title", "Thank you!"));
          ok.appendChild(
            el("div", "lw-success-text", node.getAttribute("data-success") || "We got your message and will reply very soon."),
          );
          root.appendChild(ok);
        })
        .catch(function () {
          error.textContent = "Something went wrong. Please try again.";
          submit.disabled = false;
          submit.textContent = node.getAttribute("data-button") || "Send enquiry";
        });
    };
  }

  // ------------------------------------------------------------------ capture an existing form
  // <form data-leadworks-capture> — the site keeps its own form and design; we read it on submit and send it to the inbox.
  var NAME_KEY = /(^|\b)(full\s*)?(first\s*)?name\b/i;
  var NOT_PERSON = /company|business|organi[sz]ation|user\s*name|file|product/i;
  var MESSAGE_KEY = /message|details|comment|note|enquiry|inquiry|requirement|question|about/i;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function fieldLabel(input) {
    var text = "";
    if (input.labels && input.labels[0]) text = input.labels[0].textContent;
    else if (input.id) {
      var forLabel = document.querySelector('label[for="' + input.id.replace(/"/g, "") + '"]');
      if (forLabel) text = forLabel.textContent;
    }
    if (!text) {
      var wrap = input.closest ? input.closest("label") : null;
      if (wrap) text = wrap.textContent;
    }
    if (!text) {
      var prev = input.previousElementSibling;
      if (prev && prev.tagName === "LABEL") text = prev.textContent;
    }
    if (!text && input.parentElement) {
      var near = input.parentElement.querySelector("label");
      if (near) text = near.textContent;
    }
    text = (text || input.getAttribute("aria-label") || input.name || input.placeholder || input.id || "")
      .replace(/[*:]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 40);
  }

  function readForm(form) {
    var items = [];
    Array.prototype.forEach.call(form.elements, function (input) {
      var type = (input.type || "").toLowerCase();
      if (!input.tagName || /^(button|submit|reset|image|file|hidden|password|checkbox|radio)$/.test(type)) {
        if (!((type === "checkbox" || type === "radio") && input.checked)) return;
      }
      if (input.tagName === "FIELDSET" || input.disabled) return;
      var value = (input.value || "").trim();
      if (!value || /^select\b|^choose\b/i.test(value)) return;
      items.push({ input: input, type: type, label: fieldLabel(input) || "Field", value: value });
    });

    var used = {};
    function take(pred) {
      for (var i = 0; i < items.length; i++) {
        if (!used[i] && pred(items[i])) {
          used[i] = true;
          return items[i];
        }
      }
      return null;
    }
    var contact =
      take(function (f) { return f.type === "email" || EMAIL_RE.test(f.value); }) ||
      take(function (f) { return f.type === "tel" || (!/[a-z]{3,}/i.test(f.value) && f.value.replace(/\D/g, "").length >= 7); });
    var person = take(function (f) { return f.type === "text" && NAME_KEY.test(f.label) && !NOT_PERSON.test(f.label); });
    var message =
      take(function (f) { return f.input.tagName === "TEXTAREA"; }) ||
      take(function (f) { return MESSAGE_KEY.test(f.label) && f.value.length > 20; });

    var extras = {};
    items.forEach(function (f, i) {
      if (!used[i]) extras[f.label] = f.value;
    });
    return {
      contact: contact ? contact.value : "",
      name: person ? person.value : "",
      message: message ? message.value : "",
      extras: extras,
    };
  }

  function onFormSubmit(e) {
    var form = e.target;
    if (PREVIEW || !form || !form.hasAttribute || !form.hasAttribute("data-leadworks-capture")) return;
    if (form.querySelector("input[type=password]")) return;
    var data = readForm(form);
    if (!validContact(data.contact)) return;
    fetch(API + "/api/ingest/lead", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        site_key: SITE_KEY,
        name: data.name,
        contact: data.contact,
        message: data.message,
        extras: data.extras,
        source: "form",
        wait: false,
      }),
    }).catch(function () {});
  }

  document.addEventListener("submit", onFormSubmit, true);

  // ------------------------------------------------------------------ blog
  // <div data-leadworks-blog></div> (or id="leadworks-blog") — post list; clicking a post shows it in place (?lw_post=slug).
  var BLOG_PARAM = "lw_post";

  function mountBlog() {
    var nodes = document.querySelectorAll("[data-leadworks-blog], #leadworks-blog");
    Array.prototype.forEach.call(nodes, function (node) {
      if (node.hasAttribute("data-leadworks-mounted")) return;
      node.setAttribute("data-leadworks-mounted", "");
      var m = mount(node, { fontFamily: "inherit" }, "");
      m.root.classList.add("lw-blog");
      drawBlog(m.root);
    });
  }

  function drawBlog(root) {
    var siteKey = encodeURIComponent(SITE_KEY);
    var fmtDate = function (iso) {
      return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
    };
    var say = function (text) {
      root.innerHTML = "";
      root.appendChild(el("div", "lw-blog-empty", text));
    };
    var postHref = function (slug) {
      var url = new URL(window.location.href);
      url.searchParams.set(BLOG_PARAM, slug);
      return url.pathname + "?" + url.searchParams.toString();
    };

    function showList() {
      say("Loading\u2026");
      api("/api/public/blog?siteKey=" + siteKey)
        .then(function (data) { renderList(data.posts || []); })
        .catch(function () { say("Couldn't load posts right now."); });
    }

    function showPost(slug) {
      say("Loading\u2026");
      api("/api/public/blog/" + encodeURIComponent(slug) + "?siteKey=" + siteKey)
        .then(function (data) { renderPost(data.post); })
        .catch(function () { say("Post not found."); });
    }

    function renderList(posts) {
      if (!posts.length) return say("No posts yet.");
      root.innerHTML = "";
      posts.forEach(function (p) {
        var card = el("article", "lw-blog-card");
        var title = el("h3", "lw-blog-title");
        var link = el("a", "", p.title);
        link.href = postHref(p.slug);
        link.onclick = function (e) {
          e.preventDefault();
          history.pushState({}, "", link.href);
          showPost(p.slug);
        };
        title.appendChild(link);
        card.appendChild(title);
        card.appendChild(el("div", "lw-blog-date", fmtDate(p.publishedAt)));
        card.appendChild(el("p", "lw-blog-excerpt", p.excerpt || ""));
        root.appendChild(card);
      });
    }

    function renderPost(post) {
      if (!post) return say("Post not found.");
      root.innerHTML = "";
      var back = el("button", "lw-blog-back", "\u2190 All posts");
      back.type = "button";
      back.onclick = function () {
        var url = new URL(window.location.href);
        url.searchParams.delete(BLOG_PARAM);
        history.pushState({}, "", url.pathname + (url.search || ""));
        showList();
      };
      root.appendChild(back);
      root.appendChild(el("h2", "lw-blog-h1", post.title));
      root.appendChild(el("div", "lw-blog-date", fmtDate(post.publishedAt)));
      root.appendChild(el("div", "lw-blog-content", post.content));
    }

    window.addEventListener("popstate", function () {
      var slug = new URLSearchParams(window.location.search).get(BLOG_PARAM);
      if (slug) showPost(slug);
      else showList();
    });

    var slug = new URLSearchParams(window.location.search).get(BLOG_PARAM);
    if (slug) showPost(slug);
    else showList();
  }

  // ------------------------------------------------------------------ dashboard preview (iframe)
  function runPreview(p) {
    if (p.chat) renderChat(p.chat, true);
    if (p.offer) {
      if (p.offer.displayMode === "inline") drawInline(document.body, p.offer);
      else
        showOffer(
          p.offer,
          p.chat ? (p.chat.position === "left" ? "left" : "right") : null,
          true,
        );
    }
  }
})();
