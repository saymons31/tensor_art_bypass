// ==UserScript==
// @name        TensorArt Downloader Neo
// @namespace   https://gist.github.com/angrytoenail/bef6d23f43430f857e5c94cfc241954e
// @author      Angry Toenail (base) MarcelosTeclados (refined)
// @description Download images/videos flagged as inappropriate on Tensor.Art.
// @match       https://tensor.art/*
// @version     0.3.7
// @run-at      document-start
// @icon        https://www.google.com/s2/favicons?sz=64&domain=tensor.art
// @grant       GM_xmlhttpRequest
// @grant       GM.xmlHttpRequest
// @connect     api.tensor.art
// @connect     *
// ==/UserScript==

/**
 * =============================================================================
 * TensorArt Downloader — GUIA COMPLETO (mantenha este bloco atualizado)
 * =============================================================================
 *
 * VERSÃO ATUAL: 0.3.7
 * Origem: gist angrytoenail (0.2) + refinamentos (CORS, multi-URL, diagnóstico)
 *
 * -----------------------------------------------------------------------------
 * O QUE ESTE SCRIPT FAZ
 * -----------------------------------------------------------------------------
 * - Roda em https://tensor.art/* (Tampermonkey / Violentmonkey).
 * - Intercepta respostas de API com "/query" e acha tasks com mídia bloqueada
 *   (UI: .group.cursor-not-allowed).
 * - Injeta botão "Download" no lugar do botão bloqueado.
 * - Resolve a URL da mídia por várias fontes (em ordem de utilidade):
 *     1) índice de URLs vistas em qualquer JSON da API (mediaIndex)
 *     2) campos do item da task (JSON)
 *     3) <img>/<video> no DOM do card
 *     4) performance resource entries / URLs que contêm o imageId
 *     5) POST /works/v1/generation/image/download (fallback; pode falhar)
 * - Baixa o arquivo de verdade (blob via GM_xmlhttpRequest), não só abre aba.
 *
 * -----------------------------------------------------------------------------
 * INSTALAÇÃO / ATUALIZAÇÃO
 * -----------------------------------------------------------------------------
 * 1. Abra Tampermonkey ou Violentmonkey.
 * 2. Desative/remova cópias antigas (dois scripts no mesmo site brigam).
 * 3. Cole este arquivo inteiro num userscript e salve.
 * 4. Confirme no cabeçalho:
 *      @grant   GM_xmlhttpRequest
 *      @connect api.tensor.art
 *      @connect *
 * 5. Recarregue tensor.art com Ctrl+F5, logado.
 * 6. Console deve mostrar:
 *      [TA-DL] v0.3.7 ready | token=yes | GM_xhr=yes | ...
 *
 * -----------------------------------------------------------------------------
 * USO NORMAL
 * -----------------------------------------------------------------------------
 * - Abra a lista de tasks / gerações com item "inapropriado" / bloqueado.
 * - Espere o botão virar "Download".
 * - Clique → "Done" = salvou; "Fail" = falhou (veja diagnóstico abaixo).
 * - Em sucesso o console fica quase silencioso (de propósito).
 *
 * -----------------------------------------------------------------------------
 * DIAGNÓSTICO AUTOMÁTICO (só quando parece quebra por ATUALIZAÇÃO do site)
 * -----------------------------------------------------------------------------
 * NÃO gera arquivo a cada clique. Só em falhas estruturais, por exemplo:
 *   - payload /query sem data.tasks[]
 *   - DOM da task não encontrado (seletor CSS mudou)
 *   - item sem imageId / sem URLs
 *   - API de download quebrada + zero candidatos
 *   - todas as URLs falharam / só placeholder forbidden
 *
 * Quando dispara:
 *   1) Toast laranja na página
 *   2) console.group "[TA-DL] UPDATE DIAGNOSTIC"
 *   3) Baixa automaticamente: ta-dl-diag-<timestamp>.json
 *   4) Guarda histórico em localStorage (chave: tadl_diag_reports_v1, máx. 8)
 *   5) Debounce 90s para o mesmo conjunto de códigos (anti-spam)
 *
 * O JSON do relatório inclui:
 *   - codes          → códigos da quebra
 *   - whatToFix      → área + causa provável + o que editar no script
 *   - contract       → o que o script espera do site (seletores, paths, campos)
 *   - domProbe       → se os seletores ainda batem no HTML atual
 *   - payloadProbe   → keys/URLs/JSON truncado do item
 *   - runtime        → token, GM_xhr, tamanhos de índices, lastDownloadApi
 *   - recentTrail    → últimos eventos internos (migalhas)
 *   - context        → detalhes do fail (candidatos, routeIds, etc.)
 *
 * COMO PEDIR AJUDA DEPOIS DE UMA QUEBRA:
 *   → Envie o arquivo ta-dl-diag-*.json (ou codes + whatToFix + sampleItemJson).
 *   → Dá para corrigir só a área apontada, sem reinvestigar tudo.
 *
 * -----------------------------------------------------------------------------
 * CÓDIGOS DE QUEBRA → ONDE MEXER NO SCRIPT
 * -----------------------------------------------------------------------------
 * PAYLOAD_NO_TASKS      → path do /query (hoje: detail.data.tasks)
 * DOM_TASK_NOT_FOUND    → CONTRACT.selectors.taskList / taskIdSpan + findTaskElement()
 * DOM_BLOCKED_SELECTOR  → CONTRACT.selectors.blockedItem (registrado no trail se sumir)
 * ITEM_MISSING_ID       → CONTRACT.itemIdFields + leitura do imageId no handler
 * ITEM_NO_URLS          → site parou de mandar URL no JSON; ver sampleItemJson
 * DOWNLOAD_API_FAIL     → CONTRACT.downloadPath, body, headers (sign/token)
 * NO_CANDIDATES         → coletores de URL (JSON/DOM/index/API)
 * ALL_CANDIDATES_FAILED → fetch de mídia / CDN / placeholders
 * TOKEN_MISSING         → cookie CONTRACT.cookie (ta_token_prod) / login
 * GM_XHR_MISSING        → @grant GM_xmlhttpRequest no manager
 *
 * -----------------------------------------------------------------------------
 * COMANDOS NO CONSOLE (página tensor.art, F12)
 * -----------------------------------------------------------------------------
 * __TADL.help()           → imprime este guia de novo
 * __TADL.diag.last()      → último relatório de quebra
 * __TADL.diag.history()   → lista de relatórios salvos
 * __TADL.diag.export()    → baixa de novo o último .json
 * __TADL.diag.clear()     → limpa histórico + trail
 * __TADL.dump()           → mediaIndex, allSeenUrls, itemIndex, last diag
 * __TADL.contract         → contrato/seletores/paths esperados
 * __TADL.version          → string da versão
 *
 * -----------------------------------------------------------------------------
 * CONTRATO COM O SITE (ponto único de manutenção)
 * -----------------------------------------------------------------------------
 * Objeto CONTRACT (logo abaixo no código) concentra:
 *   - cookie de auth
 *   - trecho de URL do /query
 *   - path da API de download
 *   - campos de id do item
 *   - seletores CSS da lista / task / item bloqueado / botão
 * Se o site mudar layout ou API, comece por CONTRACT + o código no relatório.
 *
 * Assinatura HMAC da API de download: usa o par fixo da 0.2 (FALLBACK_SIGN +
 * FALLBACK_TS) + Bearer do cookie/tráfego. Se a API passar a exigir sign
 * válido de verdade, isso é o próximo ponto frágil (ver DOWNLOAD_API_FAIL).
 *
 * -----------------------------------------------------------------------------
 * HISTÓRICO RESUMIDO
 * -----------------------------------------------------------------------------
 * 0.2   — original (fetch da página + sign fixo + open em aba)
 * 0.3.2 — GM_xhr (CORS)
 * 0.3.3 — multi-fonte de URL; filtro forbidden agressivo demais (bug)
 * 0.3.4 — index global; ainda filtrava demais
 * 0.3.5 — FIX: não zerar candidatos; sign 0.2 puro; logs em texto → FUNCIONOU
 * 0.3.6 — diagnóstico automático só em falha de atualização
 * 0.3.7 — este guia embutido no código + __TADL.help()
 *
 * -----------------------------------------------------------------------------
 * CHECKLIST RÁPIDO SE PARAR DE FUNCIONAR
 * -----------------------------------------------------------------------------
 * [ ] Só uma cópia do script ativa?
 * [ ] token=yes e GM_xhr=yes no boot?
 * [ ] Logado no tensor.art?
 * [ ] Botão nem aparece → DOM/query (relatório DOM_TASK_* / PAYLOAD_*)
 * [ ] Botão Fail → baixou ta-dl-diag-*.json? Abra e leia codes/whatToFix
 * [ ] Sem relatório → falha pode ser genérica; rode __TADL.dump() e
 *     __TADL.diag.history()
 *
 * =============================================================================
 */

(async () => {
  "use strict";

  const SCRIPT_VERSION = "0.3.7";
  const print = console.log.bind(window.console, "[TA-DL]");
  const win = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  /** Texto do guia (mesmo conteúdo do bloco no topo) — usado por __TADL.help() */
  const HELP_TEXT = `
TensorArt Downloader v${SCRIPT_VERSION}
========================================
Uso: lista de tasks com mídia bloqueada → botão Download → salva o arquivo.

Diagnóstico: só gera ta-dl-diag-*.json se falhar por possível ATUALIZAÇÃO do site
(payload, seletores DOM, campos do item, API download, zero URLs, etc.).
Em sucesso: silencioso. Debounce 90s no mesmo erro.

Console:
  __TADL.help()
  __TADL.diag.last() | .history() | .export() | .clear()
  __TADL.dump() | __TADL.contract | __TADL.version

Códigos → onde mexer:
  PAYLOAD_NO_TASKS      path /query (data.tasks)
  DOM_TASK_NOT_FOUND    CONTRACT.selectors + findTaskElement
  ITEM_MISSING_ID       CONTRACT.itemIdFields
  ITEM_NO_URLS          JSON da task sem URL (sampleItemJson no relatório)
  DOWNLOAD_API_FAIL     path/body/headers da API download
  NO_CANDIDATES         coletores de URL
  ALL_CANDIDATES_FAILED CDN/blob/placeholders
  TOKEN_MISSING         cookie ta_token_prod / login
  GM_XHR_MISSING        @grant GM_xmlhttpRequest

Ao quebrar: envie o .json baixado (ou codes + whatToFix).
Contrato do site: objeto CONTRACT no código (seletores, paths, campos).
Guia completo: comentário grande no início deste arquivo .user.js
`.trim();

  const FALLBACK_SIGN =
    "NDc3MTZiZDc2MDlhOWJlMTQ1YTMxNjgwYzE4NzljMDRjNTQ3ZTgzMjUyNjk1YTE5YzkzYzdhOGNmYWJiYTI1NA==";
  const FALLBACK_TS = "1766394106674";

  const FORBIDDEN_URL_RE =
    /forbidden|placeholder|blocked|nsfw[_-]?cover|content[_-]?warning|moderated|access[_-]?denied|no[_-]?access/i;

  // Contract the script expects from tensor.art (for diffing when things break)
  const CONTRACT = {
    cookie: "ta_token_prod",
    queryUrlIncludes: "/query",
    downloadPath: "/works/v1/generation/image/download",
    downloadBodyShapes: ["{ids:[id]}", "{imageIds:[id]}", "{image_ids:[id]}"],
    taskPayloadPath: "data.tasks[]",
    itemIdFields: ["imageId", "image_id", "mediaId", "id", "fileId"],
    selectors: {
      taskList: 'div.space-y-12:has(>div:not([class]))',
      taskIdSpan:
        ".space-y-8>.items-center:has(span):first-child>div:first-of-type>span",
      blockedItem: ".group.cursor-not-allowed",
      blockedButton: ".cursor-not-allowed>button",
    },
  };

  let token = await getToken();
  let lastAuthHeader = null;

  const mediaIndex = new Map();
  const itemIndex = new Map();
  const allSeenUrls = new Set();

  const gmXhr =
    typeof GM_xmlhttpRequest === "function"
      ? GM_xmlhttpRequest
      : typeof GM !== "undefined" && typeof GM.xmlHttpRequest === "function"
        ? GM.xmlHttpRequest
        : null;

  // ═══════════════════════════════════════════════════════════════════════════
  // Update Diagnostics — silent until structural / update-like failure
  // ═══════════════════════════════════════════════════════════════════════════

  const Diag = {
    STORAGE_KEY: "tadl_diag_reports_v1",
    MAX_STORED: 8,
    MAX_EVENTS: 100,
    /** @type {object[]} */
    events: [],
    stats: {
      queries: 0,
      injected: 0,
      downloadsOk: 0,
      downloadsFail: 0,
      lastQueryAt: null,
    },
    lastDownloadApi: null,
    lastReport: null,
    /** debounce: code -> timestamp */
    recentCodes: new Map(),

    /** Quiet breadcrumb (kept in memory only; not printed) */
    trail(type, data) {
      this.events.push({
        t: Date.now(),
        type,
        data: safeClone(data),
      });
      if (this.events.length > this.MAX_EVENTS) {
        this.events.splice(0, this.events.length - this.MAX_EVENTS);
      }
    },

    /**
     * Fire only for failures that likely mean the site/API changed.
     * @param {string|string[]} codes
     * @param {object} context
     */
    reportUpdateFailure(codes, context = {}) {
      const list = (Array.isArray(codes) ? codes : [codes]).filter(Boolean);
      if (!list.length) return null;

      // Debounce identical code sets for 90s (avoid spam on multi-click)
      const key = list.slice().sort().join("|");
      const now = Date.now();
      const prev = this.recentCodes.get(key);
      if (prev && now - prev < 90_000) {
        print("Diag suppressed (duplicate within 90s):", key);
        return this.lastReport;
      }
      this.recentCodes.set(key, now);

      const report = this.buildReport(list, context);
      this.lastReport = report;
      this.persist(report);
      this.printReport(report);
      this.downloadReport(report);
      this.toast(
        "Quebra detectada — relatório baixado: " + report.filename + " (também em __TADL.diag.last())"
      );
      return report;
    },

    buildReport(codes, context) {
      const hints = codes.map((c) => CODE_HINTS[c] || { area: "unknown", fix: "Investigar" });

      const sampleItem = context.item || null;
      const sampleKeys = sampleItem && typeof sampleItem === "object" ? Object.keys(sampleItem) : [];

      const missingIdFields = CONTRACT.itemIdFields.filter(
        (f) => sampleItem && sampleItem[f] == null
      );
      const unexpectedMissing =
        sampleKeys.length > 0 &&
        CONTRACT.itemIdFields.every((f) => !sampleKeys.includes(f));

      const report = {
        kind: "TA-DL-UPDATE-DIAG",
        generatedAt: new Date().toISOString(),
        scriptVersion: SCRIPT_VERSION,
        pageUrl: location.href,
        userAgent: navigator.userAgent,
        codes,
        summary: codes.map((c) => `${c}: ${(CODE_HINTS[c] || {}).title || c}`).join(" | "),
        whatToFix: hints.map((h, i) => ({
          code: codes[i],
          area: h.area,
          title: h.title,
          likelyCause: h.cause,
          suggestedFix: h.fix,
        })),
        contract: CONTRACT,
        runtime: {
          hasToken: !!token,
          hasGmXhr: !!gmXhr,
          hasLastAuthHeader: !!lastAuthHeader,
          mediaIndexSize: mediaIndex.size,
          itemIndexSize: itemIndex.size,
          allSeenUrlsSize: allSeenUrls.size,
          stats: { ...this.stats },
          lastDownloadApi: this.lastDownloadApi,
        },
        domProbe: probeDom(),
        payloadProbe: {
          sampleItemKeys: sampleKeys,
          missingExpectedIdFields: missingIdFields,
          noKnownIdFieldAtAll: unexpectedMissing,
          sampleItemUrls: sampleItem ? collectAllUrlsDeep(sampleItem).slice(0, 10) : [],
          sampleItemJson: sampleItem
            ? truncate(JSON.stringify(sampleItem), 4000)
            : null,
        },
        context: safeClone(context, 6000),
        recentTrail: this.events.slice(-40),
        filename: "",
      };

      const ts = report.generatedAt.replace(/[:.]/g, "-");
      report.filename = `ta-dl-diag-${ts}.json`;
      return report;
    },

    persist(report) {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        arr.unshift({
          at: report.generatedAt,
          codes: report.codes,
          summary: report.summary,
          filename: report.filename,
          report,
        });
        while (arr.length > this.MAX_STORED) arr.pop();
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(arr));
      } catch (e) {
        print("Diag localStorage failed:", e);
      }
    },

    printReport(report) {
      console.group(
        "%c[TA-DL] UPDATE DIAGNOSTIC",
        "color:#fff;background:#b45309;padding:2px 6px;border-radius:4px"
      );
      console.log("Codes:", report.codes);
      console.log("Summary:", report.summary);
      console.log("What to fix:", report.whatToFix);
      console.log("DOM probe:", report.domProbe);
      console.log("Payload probe:", report.payloadProbe);
      console.log("Runtime:", report.runtime);
      console.log("Full report object:", report);
      console.log(
        "%cArquivo baixado: " + report.filename + " — cole aqui se precisar de ajuda",
        "color:#b45309;font-weight:bold"
      );
      console.groupEnd();
    },

    downloadReport(report) {
      try {
        const blob = new Blob([JSON.stringify(report, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = report.filename;
        a.style.display = "none";
        document.documentElement.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 20_000);
      } catch (e) {
        print("Diag download failed:", e);
      }
    },

    toast(message) {
      try {
        let host = document.getElementById("ta-dl-toast-host");
        if (!host) {
          host = document.createElement("div");
          host.id = "ta-dl-toast-host";
          Object.assign(host.style, {
            position: "fixed",
            bottom: "16px",
            right: "16px",
            zIndex: "2147483647",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            pointerEvents: "none",
            fontFamily: "system-ui,sans-serif",
          });
          (document.body || document.documentElement).appendChild(host);
        }
        const el = document.createElement("div");
        el.textContent = message;
        Object.assign(el.style, {
          background: "#9a3412",
          color: "#fff",
          padding: "12px 14px",
          borderRadius: "8px",
          fontSize: "13px",
          maxWidth: "360px",
          boxShadow: "0 4px 16px rgba(0,0,0,.35)",
          opacity: "0",
          transition: "opacity .2s",
        });
        host.appendChild(el);
        requestAnimationFrame(() => {
          el.style.opacity = "1";
        });
        setTimeout(() => {
          el.style.opacity = "0";
          setTimeout(() => el.remove(), 250);
        }, 6000);
      } catch (_) {}
    },

    last() {
      return this.lastReport || this.history()[0]?.report || null;
    },

    history() {
      try {
        return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || "[]");
      } catch {
        return [];
      }
    },

    export() {
      const r = this.last();
      if (!r) {
        print("Nenhum relatório ainda.");
        return null;
      }
      this.downloadReport(r);
      return r;
    },

    clear() {
      this.events = [];
      this.lastReport = null;
      this.recentCodes.clear();
      try {
        localStorage.removeItem(this.STORAGE_KEY);
      } catch (_) {}
      print("Diag limpo.");
    },
  };

  const CODE_HINTS = {
    PAYLOAD_NO_TASKS: {
      title: "Payload /query sem data.tasks[]",
      area: "API intercept / shape",
      cause: "Resposta do /query mudou de formato",
      fix: "Ajustar path do payload (hoje: event.detail.data.tasks) e re-mapear campos",
    },
    DOM_TASK_NOT_FOUND: {
      title: "Card da task não encontrado no DOM",
      area: "seletores DOM",
      cause: "Layout/classes CSS da lista de tasks mudaram",
      fix: "Atualizar CONTRACT.selectors.taskList / taskIdSpan e findTaskElement()",
    },
    DOM_BLOCKED_SELECTOR: {
      title: "Nenhum .group.cursor-not-allowed",
      area: "seletores DOM",
      cause: "Classe do item bloqueado mudou",
      fix: "Atualizar CONTRACT.selectors.blockedItem",
    },
    ITEM_MISSING_ID: {
      title: "Item sem imageId (e fallbacks)",
      area: "campos do item JSON",
      cause: "Campo de id da mídia foi renomeado",
      fix: "Incluir novo nome em CONTRACT.itemIdFields e na leitura do item",
    },
    ITEM_NO_URLS: {
      title: "Item sem nenhuma URL https",
      area: "campos de mídia no JSON",
      cause: "Site parou de enviar URL no payload da task (só placeholder/API)",
      fix: "Descobrir novo campo/endpoint; ver sampleItemJson no relatório",
    },
    DOWNLOAD_API_FAIL: {
      title: "API /generation/image/download falhou",
      area: "download API",
      cause: "Auth/sign, path, body ou método mudaram (ex.: 405 SYSTEM.FAIL)",
      fix: "Ver lastDownloadApi no relatório; atualizar path/body/headers",
    },
    NO_CANDIDATES: {
      title: "Zero URLs candidatas para baixar",
      area: "coleta de mídia",
      cause: "JSON+DOM+API não entregaram URL utilizável",
      fix: "Comparar sampleItemJson e domProbe; ampliar coletores",
    },
    ALL_CANDIDATES_FAILED: {
      title: "URLs existiram mas todas falharam",
      area: "fetch de mídia / CDN",
      cause: "CDN/auth, CORS no blob, ou só placeholders forbidden",
      fix: "Ver context.candidateResults e blob sizes no relatório",
    },
    TOKEN_MISSING: {
      title: "Sem token de sessão",
      area: "auth",
      cause: "Cookie ta_token_prod ausente ou renomeado",
      fix: "Logar de novo; se cookie mudou de nome, atualizar getToken()",
    },
    GM_XHR_MISSING: {
      title: "GM_xmlhttpRequest indisponível",
      area: "userscript grants",
      cause: "@grant não aplicado / manager bloqueou",
      fix: "Reinstalar script com @grant GM_xmlhttpRequest e @connect *",
    },
  };

  function probeDom() {
    const sel = CONTRACT.selectors;
    const out = {
      taskListFound: false,
      taskIdSpanCount: 0,
      blockedItemCount: 0,
      sampleIdTexts: [],
      errors: [],
    };
    try {
      const taskList = document.querySelector(sel.taskList);
      out.taskListFound = !!taskList;
      if (taskList) {
        const spans = taskList.querySelectorAll(sel.taskIdSpan);
        out.taskIdSpanCount = spans.length;
        out.sampleIdTexts = [...spans].slice(0, 5).map((s) => s.textContent.trim());
      }
      out.blockedItemCount = document.querySelectorAll(sel.blockedItem).length;
    } catch (e) {
      out.errors.push(String(e));
    }
    return out;
  }

  function safeClone(value, maxLen = 4000) {
    try {
      const s = JSON.stringify(value, (_k, v) => {
        if (typeof v === "string" && v.length > 500) return v.slice(0, 500) + "…";
        if (v instanceof Map) return Object.fromEntries([...v.entries()].slice(0, 20));
        if (v instanceof Set) return [...v].slice(0, 30);
        if (typeof Element !== "undefined" && v instanceof Element) {
          return {
            tag: v.tagName,
            class: v.className,
            id: v.id,
          };
        }
        return v;
      });
      if (s && s.length > maxLen) return JSON.parse(s.slice(0, maxLen) + '"}'); // may fail
      return value == null ? value : JSON.parse(s);
    } catch {
      try {
        return truncate(String(value), maxLen);
      } catch {
        return "[unserializable]";
      }
    }
  }

  function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  // ─── Token ───────────────────────────────────────────────────────────────

  async function getToken() {
    try {
      if (win.cookieStore?.get) {
        const c = await win.cookieStore.get(CONTRACT.cookie);
        if (c?.value) return c.value;
      }
    } catch (_) {}
    const m = document.cookie.match(
      new RegExp("(?:^|;\\s*)" + CONTRACT.cookie + "=([^;]+)")
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

  // ─── Intercept fetch ─────────────────────────────────────────────────────

  const _fetch = win.fetch.bind(win);

  win.fetch = async function (...args) {
    try {
      const reqUrl = typeof args[0] === "string" ? args[0] : args[0]?.url;
      if (reqUrl && String(reqUrl).includes("api.tensor.art") && args[1]?.headers) {
        const h = headersToObject(args[1].headers);
        const auth = headerGet(h, "Authorization");
        if (auth) {
          lastAuthHeader = auth;
          const m = String(auth).match(/^Bearer\s+(.+)$/i);
          if (m) token = m[1];
        }
      }
    } catch (_) {}

    const response = await _fetch(...args);

    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      const u = url ? String(url) : "";
      if (u.includes("api.tensor.art") && response.ok) {
        response
          .clone()
          .json()
          .then((data) => {
            indexApiPayload(data, u);
            if (u.includes(CONTRACT.queryUrlIncludes)) {
              window.dispatchEvent(new CustomEvent("reloadQuery", { detail: data }));
            }
          })
          .catch(() => {});
      }
    } catch (_) {}

    return response;
  };

  function headersToObject(headers) {
    if (!headers) return {};
    if (headers instanceof Headers) {
      const o = {};
      headers.forEach((v, k) => {
        o[k] = v;
      });
      return o;
    }
    if (Array.isArray(headers)) return Object.fromEntries(headers);
    return { ...headers };
  }

  function headerGet(obj, name) {
    if (!obj) return undefined;
    if (obj[name] != null) return obj[name];
    const lower = name.toLowerCase();
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === lower) return obj[k];
    }
    return undefined;
  }

  function gmRequest({ url, method = "GET", headers = {}, body = null, responseType = "text" }) {
    return new Promise((resolve, reject) => {
      if (!gmXhr) {
        reject(new Error("GM_xmlhttpRequest unavailable"));
        return;
      }
      const opts = {
        method: String(method).toUpperCase(),
        url,
        headers,
        responseType,
        anonymous: false,
        onload: resolve,
        onerror: (res) =>
          reject(new Error("GM network error: " + (res?.statusText || res?.error || "unknown"))),
        ontimeout: () => reject(new Error("GM request timeout")),
      };
      if (body != null) opts.data = body;
      gmXhr(opts);
    });
  }

  // ─── Indexing ────────────────────────────────────────────────────────────

  function indexApiPayload(data, sourceUrl) {
    walkIndex(data, sourceUrl);
  }

  function walkIndex(node, sourceUrl, depth = 0) {
    if (node == null || depth > 12) return;
    if (Array.isArray(node)) {
      for (const x of node) walkIndex(x, sourceUrl, depth + 1);
      return;
    }
    if (typeof node !== "object") return;

    const ids = [];
    for (const k of CONTRACT.itemIdFields.concat(["media_id", "file_id", "resourceId"])) {
      if (node[k] != null && (typeof node[k] === "string" || typeof node[k] === "number")) {
        ids.push(String(node[k]));
      }
    }

    if (node.imageId || node.image_id) {
      itemIndex.set(String(node.imageId || node.image_id), node);
    }

    for (const v of Object.values(node)) {
      if (typeof v === "string" && /^https?:\/\//i.test(v)) {
        allSeenUrls.add(v);
        for (const id of ids) rememberMedia(id, v, sourceUrl);
      } else if (v && typeof v === "object") {
        walkIndex(v, sourceUrl, depth + 1);
      }
    }
  }

  function rememberMedia(id, url, source) {
    if (!id || !url) return;
    const score = scoreUrl(url);
    const prev = mediaIndex.get(String(id));
    if (!prev || score > prev.score) {
      mediaIndex.set(String(id), { url, score, source: source || "api" });
    }
  }

  function isForbiddenUrl(url) {
    if (!url) return true;
    return FORBIDDEN_URL_RE.test(url);
  }

  function scoreUrl(url) {
    let score = 0;
    const u = String(url).toLowerCase();
    if (isForbiddenUrl(url)) score -= 80;
    if (/\.(png|jpe?g|webp|gif|mp4|webm)(\?|$)/i.test(url)) score += 30;
    if (/\.(mp4|webm)(\?|$)/i.test(url)) score += 25;
    if (/origin|original|raw|full|high|master|source|download/i.test(u)) score += 45;
    if (/thumb|small|preview|cover|blur|low|tiny|icon/i.test(u)) score -= 40;
    if (/[?&](w|width|h|height)=\d{1,3}\b/i.test(url)) score -= 25;
    if (/tensor\.art|qiandao|cdn|images|media|oss|aliyuncs|cloudfront/i.test(u)) score += 10;
    score += Math.min(15, Math.floor(String(url).length / 80));
    return score;
  }

  function collectAllUrlsDeep(value, out = [], depth = 0) {
    if (depth > 12 || value == null) return out;
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) out.push(value);
      return out;
    }
    if (Array.isArray(value)) {
      for (const v of value) collectAllUrlsDeep(v, out, depth + 1);
      return out;
    }
    if (typeof value === "object") {
      for (const v of Object.values(value)) collectAllUrlsDeep(v, out, depth + 1);
    }
    return out;
  }

  function collectUrlsFromDom(root) {
    const urls = [];
    if (!root) return urls;
    root.querySelectorAll("img").forEach((img) => {
      for (const attr of ["src", "data-src", "data-original", "data-url"]) {
        const v = img.getAttribute(attr);
        if (v && /^https?:\/\//i.test(v)) urls.push(v);
      }
      if (img.currentSrc && /^https?:\/\//i.test(img.currentSrc)) urls.push(img.currentSrc);
      const srcset = img.getAttribute("srcset");
      if (srcset) {
        srcset.split(",").forEach((part) => {
          const u = part.trim().split(/\s+/)[0];
          if (u && /^https?:\/\//i.test(u)) urls.push(u);
        });
      }
    });
    root.querySelectorAll("video, source").forEach((el) => {
      for (const attr of ["src", "data-src"]) {
        const v = el.getAttribute(attr);
        if (v && /^https?:\/\//i.test(v)) urls.push(v);
      }
      if (el.currentSrc && /^https?:\/\//i.test(el.currentSrc)) urls.push(el.currentSrc);
    });
    return urls;
  }

  // ─── Query handler ───────────────────────────────────────────────────────

  window.removeEventListener("reloadQuery", queryEventHandler, false);
  window.addEventListener("reloadQuery", queryEventHandler, false);

  async function queryEventHandler(event) {
    Diag.stats.queries++;
    Diag.stats.lastQueryAt = Date.now();
    Diag.trail("query", {
      topKeys: event?.detail ? Object.keys(event.detail) : null,
    });

    const tasks = event?.detail?.data?.tasks;
    if (!Array.isArray(tasks)) {
      Diag.reportUpdateFailure("PAYLOAD_NO_TASKS", {
        detailKeys: event?.detail ? Object.keys(event.detail) : null,
        dataKeys: event?.detail?.data ? Object.keys(event.detail.data) : null,
        detailPreview: truncate(JSON.stringify(event?.detail), 2000),
      });
      return;
    }

    if (!token) token = await getToken();

    let anyTaskEl = false;
    let anyBlocked = false;
    let injected = 0;
    let missingDom = 0;
    let missingId = 0;

    for (let attempt = 0; attempt < 10; attempt++) {
      missingDom = 0;
      injected = 0;
      missingId = 0;
      anyTaskEl = false;
      anyBlocked = false;

      for (const task of tasks) {
        indexApiPayload(task, "task");

        const taskEl = findTaskElement(task.routeId);
        if (!taskEl) {
          missingDom++;
          continue;
        }
        anyTaskEl = true;

        const taskItems = taskEl.querySelectorAll(CONTRACT.selectors.blockedItem);
        if (taskItems.length) anyBlocked = true;

        for (const [idx, itemEl] of taskItems.entries()) {
          if (itemEl.getAttribute("data-ta-dl") === "1") continue;

          const item = task.items?.[idx];
          if (!item) continue;

          const imageId = String(
            item.imageId || item.image_id || item.mediaId || item.id || item.fileId || ""
          );
          if (!imageId) {
            missingId++;
            Diag.trail("item_missing_id", {
              keys: Object.keys(item),
              preview: truncate(JSON.stringify(item), 800),
            });
            continue;
          }

          itemIndex.set(imageId, item);
          indexApiPayload(item, "item");

          const btnHost =
            itemEl.querySelector(CONTRACT.selectors.blockedButton) ||
            itemEl.querySelector("button");
          if (!btnHost) continue;

          btnHost.replaceWith(createDownloadButton(imageId, item, itemEl, task));
          itemEl.setAttribute("data-ta-dl", "1");
          injected++;
        }
      }

      if (missingDom === 0 || injected > 0) break;
      await sleep(300);
    }

    Diag.stats.injected += injected;
    Diag.trail("query_done", {
      tasks: tasks.length,
      injected,
      missingDom,
      anyTaskEl,
      anyBlocked,
      missingId,
    });

    // Structural failures after retries (only if we had work to do)
    if (tasks.length > 0 && !anyTaskEl) {
      Diag.reportUpdateFailure("DOM_TASK_NOT_FOUND", {
        routeIds: tasks.slice(0, 5).map((t) => t.routeId),
        tasksCount: tasks.length,
      });
    } else if (tasks.length > 0 && anyTaskEl && !anyBlocked) {
      // Not always an error (no blocked media) — only note in trail
      Diag.trail("no_blocked_items", { tasks: tasks.length });
    }

    if (missingId > 0 && injected === 0) {
      const sample = tasks.find((t) => t.items?.[0])?.items?.[0];
      Diag.reportUpdateFailure("ITEM_MISSING_ID", { item: sample, missingId });
    }
  }

  function findTaskElement(taskId) {
    try {
      const id = String(taskId);
      const taskList = document.querySelector(CONTRACT.selectors.taskList);
      if (taskList) {
        const taskIds = taskList.querySelectorAll(CONTRACT.selectors.taskIdSpan);
        for (const el of taskIds) {
          if (el.textContent.trim() === id) {
            return el.closest("div:not(div[class])");
          }
        }
        for (const span of taskList.querySelectorAll("span")) {
          if (span.childElementCount === 0 && span.textContent.trim() === id) {
            return span.closest("div.space-y-8") || span.closest("div:not([class])");
          }
        }
      }
      for (const span of document.querySelectorAll("span")) {
        if (span.childElementCount === 0 && span.textContent.trim() === id) {
          return (
            span.closest("div.space-y-8") ||
            span.closest("div:not([class])") ||
            span.parentElement?.parentElement?.parentElement
          );
        }
      }
    } catch (e) {
      Diag.trail("findTaskElement_error", { error: String(e) });
    }
    return null;
  }

  // ─── Button ──────────────────────────────────────────────────────────────

  function createDownloadButton(imageId, item, itemEl, task) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "⬇ Download";
    btn.classList.add(
      "mt-12",
      "vi-button",
      "vi-button--size-medium",
      "vi-button--type-dark"
    );
    btn.style.cursor = "pointer";
    btn.title = `imageId: ${imageId}`;

    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const prev = btn.textContent;
      btn.textContent = "…";
      btn.disabled = true;

      const candidateResults = [];

      try {
        if (!token) {
          token = await getToken();
          if (!token) {
            Diag.reportUpdateFailure("TOKEN_MISSING", { imageId });
            throw new Error("Sem token");
          }
        }
        if (!gmXhr) {
          Diag.reportUpdateFailure("GM_XHR_MISSING", { imageId });
        }

        const itemUrls = collectAllUrlsDeep(item);
        const domUrls = collectUrlsFromDom(itemEl);

        const candidates = await gatherCandidates(imageId, item, itemEl, task);
        Diag.trail("download_attempt", {
          imageId,
          candidates: candidates.length,
          itemUrls: itemUrls.length,
          domUrls: domUrls.length,
        });

        if (!candidates.length) {
          const codes = ["NO_CANDIDATES"];
          if (!itemUrls.length) codes.push("ITEM_NO_URLS");
          if (Diag.lastDownloadApi && Diag.lastDownloadApi.ok === false) {
            codes.push("DOWNLOAD_API_FAIL");
          }
          Diag.stats.downloadsFail++;
          Diag.reportUpdateFailure(codes, {
            imageId,
            item,
            itemUrls,
            domUrls,
            lastDownloadApi: Diag.lastDownloadApi,
            mediaIndexSample: [...mediaIndex.entries()].slice(0, 15),
            allSeenUrlsSample: [...allSeenUrls].slice(0, 20),
          });
          throw new Error("Nenhuma URL candidata");
        }

        let saved = false;
        let lastErr = null;

        for (const c of candidates) {
          try {
            const blob = await fetchBlob(c.url);
            const meta = {
              source: c.source,
              score: c.score,
              url: c.url,
              size: blob.size,
              type: blob.type,
              forbiddenLike: looksLikeForbiddenBlob(blob, c.url),
            };
            candidateResults.push(meta);

            if (meta.forbiddenLike && candidates.length > 1) {
              if (!btn.__lastResort) btn.__lastResort = { blob, url: c.url };
              continue;
            }

            const filename = guessName(c.url, imageId, blob.type);
            triggerSave(blob, filename);
            rememberMedia(imageId, c.url, c.source);
            saved = true;
            break;
          } catch (err) {
            lastErr = err;
            candidateResults.push({
              source: c.source,
              score: c.score,
              url: c.url,
              error: String(err),
            });
          }
        }

        if (!saved && btn.__lastResort) {
          const { blob, url } = btn.__lastResort;
          triggerSave(blob, guessName(url, imageId, blob.type));
          saved = true;
          Diag.trail("saved_last_resort", { imageId, size: blob.size });
        }

        if (!saved) {
          const canvasBlob = await tryCanvasCapture(itemEl);
          if (canvasBlob) {
            triggerSave(canvasBlob, `tensorart-${imageId}.png`);
            saved = true;
          }
        }

        if (!saved) {
          Diag.stats.downloadsFail++;
          const codes = ["ALL_CANDIDATES_FAILED"];
          if (candidateResults.every((r) => r.forbiddenLike || r.size < 12000)) {
            codes.push("ITEM_NO_URLS");
          }
          if (Diag.lastDownloadApi && Diag.lastDownloadApi.ok === false) {
            codes.push("DOWNLOAD_API_FAIL");
          }
          Diag.reportUpdateFailure(codes, {
            imageId,
            item,
            candidateResults,
            lastDownloadApi: Diag.lastDownloadApi,
          });
          throw lastErr || new Error("Falha em todas as URLs");
        }

        Diag.stats.downloadsOk++;
        Diag.trail("download_ok", { imageId });
        btn.textContent = "✓ Done";
        setTimeout(() => {
          btn.textContent = prev;
          btn.disabled = false;
          delete btn.__lastResort;
        }, 1500);
      } catch (ex) {
        // report already emitted for structured cases; keep quiet otherwise
        if (!Diag.lastReport || Date.now() - new Date(Diag.lastReport.generatedAt).getTime() > 2000) {
          // generic fail without prior report
          if (String(ex).includes("Sem token") || String(ex).includes("Nenhuma URL") || String(ex).includes("Falha em todas")) {
            // already reported
          } else {
            Diag.trail("download_error", { imageId, error: String(ex), candidateResults });
          }
        }
        btn.textContent = "✕ Fail";
        btn.disabled = false;
        setTimeout(() => {
          btn.textContent = prev;
        }, 3000);
      }
    };

    return btn;
  }

  async function gatherCandidates(imageId, item, itemEl, task) {
    const list = [];
    const push = (url, source, bonus = 0) => {
      if (!url || typeof url !== "string") return;
      if (!/^https?:\/\//i.test(url) && !url.startsWith("blob:") && !url.startsWith("data:"))
        return;
      list.push({ url, score: scoreUrl(url) + bonus, source });
    };

    const hit = mediaIndex.get(String(imageId));
    if (hit) push(hit.url, "index", 60);

    if (item) {
      for (const [k, v] of Object.entries(item)) {
        if (v != null && (typeof v === "string" || typeof v === "number")) {
          if (/id$/i.test(k) || k === "id") {
            const h = mediaIndex.get(String(v));
            if (h) push(h.url, "index:" + k, 40);
          }
        }
      }
      for (const url of collectAllUrlsDeep(item)) push(url, "item-json", 30);
    }

    if (task) {
      for (const url of collectAllUrlsDeep(task)) {
        if (String(url).includes(String(imageId))) push(url, "task-url-id", 70);
        else push(url, "task-url", -10);
      }
    }

    for (const url of collectUrlsFromDom(itemEl)) push(url, "dom", 20);

    try {
      for (const ent of performance.getEntriesByType("resource") || []) {
        const name = ent.name || "";
        if (name.includes(String(imageId))) push(name, "performance", 80);
      }
    } catch (_) {}

    for (const url of allSeenUrls) {
      if (url.includes(String(imageId))) push(url, "seen-id", 75);
    }

    try {
      const apiUrls = await getDownloadUrls(imageId);
      for (const url of apiUrls) push(url, "download-api", 10);
    } catch (e) {
      Diag.trail("download_api_throw", { error: String(e) });
    }

    const best = new Map();
    for (const c of list) {
      const prev = best.get(c.url);
      if (!prev || c.score > prev.score) best.set(c.url, c);
    }
    return [...best.values()].sort((a, b) => b.score - a.score);
  }

  async function getDownloadUrls(id) {
    const headers = buildDownloadHeaders();
    const bodies = [
      JSON.stringify({ ids: [id] }),
      JSON.stringify({ ids: [String(id)] }),
      JSON.stringify({ imageIds: [id] }),
      JSON.stringify({ image_ids: [id] }),
    ];

    const urls = [];
    const attempts = [];

    for (const body of bodies) {
      try {
        const res = await gmRequest({
          url: "https://api.tensor.art" + CONTRACT.downloadPath,
          method: "POST",
          headers,
          body,
          responseType: "text",
        });
        const text = String(res.responseText || res.response || "");
        const attempt = {
          via: "gm",
          status: res.status,
          bodyShape: body.slice(0, 80),
          responsePreview: text.slice(0, 400),
        };
        attempts.push(attempt);

        if (res.status >= 200 && res.status < 300) {
          try {
            const data = JSON.parse(text);
            indexApiPayload(data, "download-api");
            urls.push(...collectAllUrlsDeep(data));
            if (urls.length) {
              Diag.lastDownloadApi = { ok: true, attempts, urls: urls.slice(0, 5) };
              return unique(urls);
            }
          } catch (_) {}
        }
      } catch (e) {
        attempts.push({ via: "gm", error: String(e) });
      }

      try {
        const res = await _fetch("https://api.tensor.art" + CONTRACT.downloadPath, {
          method: "POST",
          body,
          headers,
          credentials: "include",
        });
        const text = await res.text();
        attempts.push({
          via: "page",
          status: res.status,
          bodyShape: body.slice(0, 80),
          responsePreview: text.slice(0, 400),
        });
        if (res.ok) {
          try {
            const data = JSON.parse(text);
            indexApiPayload(data, "download-api-page");
            urls.push(...collectAllUrlsDeep(data));
            if (urls.length) {
              Diag.lastDownloadApi = { ok: true, attempts, urls: urls.slice(0, 5) };
              return unique(urls);
            }
          } catch (_) {}
        }
      } catch (e) {
        attempts.push({ via: "page", error: String(e) });
      }
    }

    Diag.lastDownloadApi = {
      ok: urls.length > 0,
      attempts,
      urls: urls.slice(0, 5),
    };
    return unique(urls);
  }

  function buildDownloadHeaders() {
    const auth = lastAuthHeader || (token ? `Bearer ${token}` : "");
    return {
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Request-Package-Sign-Version": "0.0.1",
      "X-Request-Package-Id": "3000",
      "X-Request-Timestamp": FALLBACK_TS,
      "X-Request-Sign": FALLBACK_SIGN,
      "X-Request-Lang": "en-US",
      "X-Request-Sign-Type": "HMAC_SHA256",
      "X-Request-Sign-Version": "v1",
    };
  }

  function unique(arr) {
    return [...new Set(arr.filter(Boolean))];
  }

  async function fetchBlob(url) {
    if (url.startsWith("blob:") || url.startsWith("data:")) {
      const r = await _fetch(url);
      if (!r.ok) throw new Error("blob fetch " + r.status);
      return r.blob();
    }

    const res = await gmRequest({
      url,
      method: "GET",
      headers: {
        Referer: "https://tensor.art/",
        Origin: "https://tensor.art",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      responseType: "blob",
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error("File HTTP " + res.status);
    }

    if (res.response instanceof Blob) return res.response;
    return new Blob([res.response]);
  }

  function looksLikeForbiddenBlob(blob, url) {
    if (!blob) return true;
    if (isForbiddenUrl(url)) return true;
    if (blob.size > 0 && blob.size < 12_000) return true;
    if (blob.type && /html|json|text\//i.test(blob.type)) return true;
    return false;
  }

  async function tryCanvasCapture(itemEl) {
    try {
      const img = itemEl.querySelector("img");
      if (!img || !img.naturalWidth) return null;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    } catch (e) {
      return null;
    }
  }

  function triggerSave(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename || "tensorart-download";
    a.style.display = "none";
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 15_000);
  }

  function guessName(url, id, mime) {
    let ext = "png";
    if (mime) {
      if (/mp4/i.test(mime)) ext = "mp4";
      else if (/webm/i.test(mime)) ext = "webm";
      else if (/jpeg|jpg/i.test(mime)) ext = "jpg";
      else if (/webp/i.test(mime)) ext = "webp";
      else if (/gif/i.test(mime)) ext = "gif";
    }
    if (url && /^https?:\/\//i.test(url)) {
      try {
        const last = new URL(url).pathname.split("/").filter(Boolean).pop();
        if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last.slice(0, 180);
      } catch (_) {}
    }
    return `tensorart-${id}.${ext}`;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  win.__TADL = {
    version: SCRIPT_VERSION,
    mediaIndex,
    itemIndex,
    allSeenUrls,
    contract: CONTRACT,
    diag: Diag,
    /** Guia resumido (console). O guia completo está no comentário no topo do .user.js */
    help() {
      console.log(
        "%c[TA-DL] HELP",
        "color:#fff;background:#1d4ed8;padding:2px 8px;border-radius:4px;font-weight:bold"
      );
      console.log(HELP_TEXT);
      console.log(
        "Guia completo: abra o arquivo do userscript e leia o bloco de comentário no topo."
      );
      return HELP_TEXT;
    },
    dump() {
      console.log("[TA-DL] version", SCRIPT_VERSION);
      console.log("[TA-DL] mediaIndex", [...mediaIndex.entries()]);
      console.log("[TA-DL] allSeenUrls", [...allSeenUrls]);
      console.log("[TA-DL] itemIndex keys", [...itemIndex.keys()]);
      console.log("[TA-DL] last diag", Diag.last());
      console.log("[TA-DL] tip: __TADL.help() para o guia");
    },
  };

  print(
    `v${SCRIPT_VERSION} ready | token=${token ? "yes" : "NO"} | GM_xhr=${gmXhr ? "yes" : "NO"} | diag on update-fail only | __TADL.help()`
  );
})();
