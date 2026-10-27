import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ADMIN_EMAIL,
  ADMIN_UID,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "./supabase-config.js";
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const shuffle = (a) => {
    a = [...a];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const POS = {
    QQ: "Qualquer",
    LEV: "Levantador",
    PON: "Ponteiro",
    OPO: "Oposto",
    CEN: "Central",
    LIB: "Líbero",
  };
  const COLORS = [
    ["Azul", "#1450C8"],
    ["Amarelo", "#FFC72C"],
    ["Branco", "#F4F6FA"],
    ["Marinho", "#0A2A6B"],
    ["Turquesa", "#0E9AA7"],
    ["Laranja", "#F07D1A"],
    ["Verde", "#2E8B57"],
    ["Vermelho", "#D23A32"],
    ["Roxo", "#7A4FD6"],
    ["Grafite", "#3E4660"],
  ];
  const ink = (hex) => {
    const n = parseInt(hex.slice(1), 16),
      r = n >> 16,
      g = (n >> 8) & 255,
      b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#0B1A3A" : "#FFFFFF";
  };

  /* ---------- toast ---------- */
  let tT;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(tT);
    tT = setTimeout(() => (t.hidden = true), 2600);
  }

  /* two-step confirm */
  function armed(btn, label) {
    if (btn.classList.contains("armed")) {
      btn.classList.remove("armed");
      btn.textContent = btn.dataset.orig;
      return true;
    }
    btn.dataset.orig = btn.textContent;
    btn.textContent = label || "Confirmar?";
    btn.classList.add("armed");
    setTimeout(() => {
      if (btn.isConnected && btn.classList.contains("armed")) {
        btn.classList.remove("armed");
        btn.textContent = btn.dataset.orig;
      }
    }, 3500);
    return false;
  }

  /* ---------- shared storage ---------- */
  const DEL = {};
  function dbAdapter(client) {
    const fetchCollection = async (name, cb) => {
      try {
        const { data, error } = await client.from(name).select("*").order("id");
        if (error) return dbErr(error);
        cb(data);
      } catch (e) {
        dbErr(e);
      }
    };
    const fetchDoc = async (path, cb) => {
      try {
        const { data, error } = await client
          .from("app_state")
          .select("data")
          .eq("doc_key", path)
          .maybeSingle();
        if (error) return dbErr(error);
        cb(data?.data ?? null);
      } catch (e) {
        dbErr(e);
      }
    };
    const subscribe = (table, callback) =>
      client
        .channel(`public:${table}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          callback,
        )
        .subscribe((status, error) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            dbErr(error || new Error(`Realtime ${status}: ${table}`));
          }
        });
    return {
      watchColl(name, cb) {
        const channel = subscribe(name, () => fetchCollection(name, cb));
        fetchCollection(name, cb);
        return () => client.removeChannel(channel);
      },
      watchDoc(path, cb) {
        const channel = subscribe("app_state", () => fetchDoc(path, cb));
        fetchDoc(path, cb);
        return () => client.removeChannel(channel);
      },
      async set(path, data) {
        const parts = path.split("/");
        if (parts.length === 2 && ["players", "games"].includes(parts[0])) {
          const [table, id] = parts;
          const query = client.from(table);
          const { error } =
            data === DEL
              ? await query.delete().eq("id", id)
              : await query.upsert({ id, ...data });
          if (error) throw error;
          return;
        }
        if (parts.length === 2) {
          const query = client.from("app_state");
          const { error } =
            data === DEL
              ? await query.delete().eq("doc_key", path)
              : await query.upsert({ doc_key: path, data });
          if (error) throw error;
          return;
        }
        throw new Error(`Caminho de armazenamento inválido: ${path}`);
      },
    };
  }
  function dbErr(e) {
    console.error("Erro ao receber dados do Supabase:", e);
    if (e?.code === "42501" || e?.status === 401 || e?.status === 403) {
      setSync("error");
      toast("Sem permissão para receber os dados compartilhados.");
    } else {
      setSync("error");
      toast("Falha ao receber dados do Database.");
    }
  }
  const Store = {
    adapter: {
      watchColl: () => () => {},
      watchDoc: () => () => {},
      set: async () => {
        throw new Error("O Supabase não está conectado.");
      },
    },
    mode: "disconnected",
    watchers: [],
    q: {},
    watch(kind, path, cb) {
      const w = { kind, path, cb, unsub: null };
      this.watchers.push(w);
      this._sub(w);
    },
    _sub(w) {
      w.unsub =
        w.kind === "coll"
          ? this.adapter.watchColl(w.path, w.cb)
          : this.adapter.watchDoc(w.path, w.cb);
    },
    use(ad, mode) {
      this.watchers.forEach((w) => {
        if (w.unsub) w.unsub();
      });
      this.adapter = ad;
      this.mode = mode;
      this.watchers.forEach((w) => this._sub(w));
    },
    put(path, data) {
      if (RO) {
        toast("Modo leitura: sem permissão para editar.");
        return Promise.resolve(false);
      }
      const st =
        this.q[path] ||
        (this.q[path] = {
          busy: false,
          has: false,
          data: null,
          waiters: [],
        });
      return new Promise((resolve) => {
        st.data = data;
        st.has = true;
        st.waiters.push(resolve);
        if (!st.busy) this._flush(path);
      });
    },
    del(path) {
      this.put(path, DEL);
    },
    async _flush(path) {
      const st = this.q[path];
      st.busy = true;
      while (st.has) {
        const d = st.data;
        st.has = false;
        const waiters = st.waiters.splice(0);
        try {
          await this.adapter.set(path, d);
          waiters.forEach((resolve) => resolve(true));
        } catch (e) {
          console.error("Erro ao salvar no Supabase:", e);
          const c = e?.code;
          if (c === "PGRST000" || c === "08006" || c === "57014") {
            await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
            try {
              await this.adapter.set(path, d);
              waiters.forEach((resolve) => resolve(true));
            } catch (e2) {
              console.error("Falha na nova tentativa do Supabase:", e2);
              waiters.forEach((resolve) => resolve(false));
              toast("Não foi possível salvar agora. Tente de novo.");
            }
          } else if (c === "42501" || e?.status === 401 || e?.status === 403) {
            waiters.forEach((resolve) => resolve(false));
            toast("Acesso negado. Entre como administrador para editar.");
          } else {
            waiters.forEach((resolve) => resolve(false));
            toast("Não foi possível salvar no Database.");
          }
        }
      }
      st.busy = false;
    },
  };

  let RO = true;
  function setRO(v) {
    RO = v;
    document.body.classList.toggle("ro", v);
    $("#roNote").hidden = !v;
    $("#adminAccess").textContent = v
      ? "Entrar como administrador"
      : "Sair do administrador";
    renderAll();
  }
  function setSync(state) {
    const el = $("#sync");
    el.classList.toggle("ok", state === "db");
    el.classList.toggle("error", state === "error" || state === "setup");
    el.querySelector("span").textContent =
      state === "db"
        ? "Sincronizado"
        : state === "setup"
          ? "Banco não configurado"
          : state === "error"
            ? "Erro de conexão"
            : "Conectando…";
  }

  /* ---------- state ---------- */
  const S = { players: [], games: [], draw: null, cup: null, live: null };
  Store.watch("coll", "players", (v) => {
    S.players = v;
    renderAll();
  });
  Store.watch("coll", "games", (v) => {
    S.games = v;
    renderAll();
  });
  Store.watch("doc", "draw/last", (v) => {
    S.draw = v;
    renderAll();
  });
  Store.watch("doc", "cup/current", (v) => {
    S.cup = v;
    renderAll();
  });
  Store.watch("doc", "live/score", (v) => {
    S.live = v;
    renderAll();
  });

  let supabase = null;
  let adminUser = null;
  const supabaseConfigured =
    SUPABASE_URL &&
    !SUPABASE_URL.includes("COLE_") &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_ANON_KEY.includes("COLE_") &&
    ADMIN_UID &&
    !ADMIN_UID.includes("COLE_");
  async function connect() {
    if (!supabaseConfigured) {
      setRO(true);
      setSync("setup");
      return;
    }
    try {
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      Store.use(dbAdapter(supabase), "db");
      setSync("db");
      supabase.auth.onAuthStateChange((_event, session) => {
        adminUser = session?.user ?? null;
        setRO(
          !(adminUser?.email === ADMIN_EMAIL && adminUser?.id === ADMIN_UID),
        );
      });
    } catch (e) {
      console.error("Falha ao conectar com Supabase:", e);
      setRO(true);
      setSync("error");
      toast("Não foi possível conectar ao Database.");
    }
  }

  $("#adminAccess").addEventListener("click", async () => {
    if (adminUser?.email === ADMIN_EMAIL && adminUser?.id === ADMIN_UID) {
      try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        toast("Sessão administrativa encerrada.");
      } catch (e) {
        console.error("Não foi possível encerrar a sessão:", e);
        toast("Não foi possível sair do modo administrador.");
      }
      return;
    }
    $("#adminError").textContent = "";
    $("#adminPassword").value = "";
    $("#adminDialog").showModal();
    $("#adminPassword").focus();
  });
  $("#closeAdmin").addEventListener("click", () => $("#adminDialog").close());
  $("#adminForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = $("#adminError");
    const submit = $("#adminSubmit");
    if (!supabase) {
      error.textContent =
        "O Database ainda não foi configurado para este site.";
      return;
    }
    submit.disabled = true;
    error.textContent = "";
    try {
      const { data, error: loginError } =
        await supabase.auth.signInWithPassword({
          email: ADMIN_EMAIL,
          password: $("#adminPassword").value,
        });
      if (loginError) throw loginError;
      if (data.user?.email !== ADMIN_EMAIL || data.user?.id !== ADMIN_UID) {
        await supabase.auth.signOut();
        throw new Error("Conta sem permissão administrativa.");
      }
      $("#adminDialog").close();
      toast("Acesso administrativo liberado.");
    } catch (e) {
      console.error("Falha na autenticação administrativa:", e.message);
      error.textContent =
        e?.code === "invalid_credentials"
          ? "Senha incorreta."
          : "Não foi possível entrar. Verifique a configuração do Supabase.";
    } finally {
      submit.disabled = false;
    }
  });

  /* ---------- routing ---------- */
  const VIEWS = ["jogadores", "sorteio", "campeonato", "placar", "calendario"];
  let VIEW = "jogadores";
  function route() {
    const h = (location.hash || "").slice(1);
    VIEW = VIEWS.includes(h) ? h : "jogadores";
    VIEWS.forEach((v) => ($("#v-" + v).hidden = v !== VIEW));
    document
      .querySelectorAll("nav.tabs a")
      .forEach(
        (a) =>
          a.toggleAttribute(
            "aria-current",
            a.getAttribute("href") === "#" + VIEW,
          ) && a.setAttribute("aria-current", "page"),
      );
    if (VIEW === "placar") wake();
    renderAll();
  }
  window.addEventListener("hashchange", () => {
    route();
    window.scrollTo(0, 0);
  });

  let lock = null;
  async function wake() {
    try {
      if (navigator.wakeLock && !lock) {
        lock = await navigator.wakeLock.request("screen");
        lock.addEventListener("release", () => (lock = null));
      }
    } catch (e) {}
  }

  function renderAll() {
    renderNext();
    if (VIEW === "jogadores") renderPlayers();
    else if (VIEW === "sorteio") renderDraw();
    else if (VIEW === "campeonato") renderCup();
    else if (VIEW === "placar") renderLive();
    else renderCal();
  }

  /* ---------- dates ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) =>
    d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parseISO = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const fmtLong = (s) =>
    parseISO(s).toLocaleDateString("pt-BR", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  function upcoming() {
    const now = new Date(),
      t = iso(now),
      hm = pad(now.getHours()) + ":" + pad(now.getMinutes());
    return S.games
      .filter((g) => g.date > t || (g.date === t && (g.time || "23:59") >= hm))
      .sort((a, b) =>
        (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")),
      );
  }
  function renderNext() {
    const g = upcoming()[0],
      el = $("#nextGame");
    el.innerHTML = g
      ? `Próximo jogo: <strong>${esc(fmtLong(g.date))}${g.time ? " · " + esc(g.time) : ""}</strong>${g.place ? " · " + esc(g.place) : ""}`
      : "Nenhum jogo marcado. Use o calendário para marcar o próximo.";
  }

  /* ---------- PLAYERS ---------- */
  $("#pPos").innerHTML = Object.entries(POS)
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join("");
  const sortedPlayers = () =>
    [...S.players].sort((a, b) =>
      String(a.name).localeCompare(String(b.name), "pt", {
        sensitivity: "base",
      }),
    );
  const pData = (p) => ({
    name: p.name,
    pos: p.pos || "QQ",
    level: p.level || 3,
    present: !!p.present,
    sample: !!p.sample,
    at: p.at || Date.now(),
  });
  function renderPlayers() {
    const q = $("#pSearch").value.trim().toLowerCase();
    const all = sortedPlayers(),
      list = all.filter((p) => !q || String(p.name).toLowerCase().includes(q));
    $("#cTotal").textContent = all.length;
    $("#cPres").textContent = all.filter((p) => p.present).length;
    $("#pEmpty").hidden = all.length > 0;
    $("#rmSample").hidden = !all.some((p) => p.sample);
    const dis = RO ? "disabled" : "";
    $("#pList").innerHTML = list
      .map(
        (
          p,
        ) => `<li class="prow ${p.present ? "on" : ""}" data-id="${esc(p.id)}">
    <input type="checkbox" data-act="present" ${p.present ? "checked" : ""} ${dis} aria-label="Presente: ${esc(p.name)}">
    <span class="pname">${esc(p.name)}${p.sample ? '<span class="tag">exemplo</span>' : ""}</span>
    <select class="pos-sel" data-act="pos" ${dis} aria-label="Posição de ${esc(p.name)}">${Object.entries(
      POS,
    )
      .map(
        ([k, v]) =>
          `<option value="${k}" ${p.pos === k ? "selected" : ""}>${v}</option>`,
      )
      .join("")}</select>
    <span class="lvl" role="group" aria-label="Nível ${p.level || 3} de 5">${[1, 2, 3, 4, 5].map((i) => `<button type="button" data-act="lvl" data-v="${i}" class="${i <= (p.level || 3) ? "f" : ""}" ${dis} aria-label="Nível ${i}"></button>`).join("")}</span>
    <button type="button" class="icon-btn edit" data-act="rm">Remover</button></li>`,
      )
      .join("");
    if (all.length && !list.length)
      $("#pList").innerHTML =
        `<li class="muted" style="padding:10px 4px">Ninguém com esse nome.</li>`;
  }
  function savePlayer(p) {
    Store.put("players/" + p.id, pData(p));
  }
  $("#pList").addEventListener("change", (e) => {
    const li = e.target.closest(".prow");
    if (!li) return;
    const p = S.players.find((x) => x.id === li.dataset.id);
    if (!p) return;
    if (e.target.dataset.act === "present")
      savePlayer({ ...p, present: e.target.checked });
    if (e.target.dataset.act === "pos")
      savePlayer({ ...p, pos: e.target.value });
  });
  $("#pList").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    const li = e.target.closest(".prow");
    if (!b || !li) return;
    const p = S.players.find((x) => x.id === li.dataset.id);
    if (!p) return;
    if (b.dataset.act === "lvl") savePlayer({ ...p, level: +b.dataset.v });
    if (b.dataset.act === "rm" && armed(b, "Confirmar"))
      Store.del("players/" + p.id);
  });
  $("#pSearch").addEventListener("input", renderPlayers);
  $("#fPlayer").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#pName").value.trim();
    if (!name) return;
    if (
      S.players.some((p) => String(p.name).toLowerCase() === name.toLowerCase())
    ) {
      toast(name + " já está na lista.");
      return;
    }
    savePlayer({
      id: uid(),
      name,
      pos: $("#pPos").value,
      level: +$("#pLvl").value,
      present: true,
    });
    $("#pName").value = "";
    $("#pName").focus();
    toast(name + " adicionado como presente.");
  });
  $("#fPaste").addEventListener("submit", (e) => {
    e.preventDefault();
    const have = new Set(S.players.map((p) => String(p.name).toLowerCase()));
    let n = 0;
    $("#pPaste")
      .value.split(/\n/)
      .map((l) =>
        l
          .replace(/^\s*\d+\s*[.)\-–:]*\s*/, "")
          .replace(/[^\p{L}\p{M}\s'.-]/gu, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)
      .forEach((name) => {
        if (have.has(name.toLowerCase())) return;
        have.add(name.toLowerCase());
        savePlayer({
          id: uid(),
          name: name.slice(0, 40),
          pos: "QQ",
          level: 3,
          present: true,
        });
        n++;
      });
    $("#pPaste").value = "";
    toast(
      n
        ? `${n} jogador${n > 1 ? "es" : ""} adicionado${n > 1 ? "s" : ""}.`
        : "Nenhum nome novo na lista.",
    );
  });
  $("#allIn").addEventListener("click", () =>
    S.players
      .filter((p) => !p.present)
      .forEach((p) => savePlayer({ ...p, present: true })),
  );
  $("#allOut").addEventListener("click", () =>
    S.players
      .filter((p) => p.present)
      .forEach((p) => savePlayer({ ...p, present: false })),
  );
  $("#loadSample").addEventListener("click", () => {
    [
      ["Ana", "LEV", 4],
      ["Bruno", "PON", 5],
      ["Carla", "CEN", 3],
      ["Diego", "OPO", 4],
      ["Eduarda", "LIB", 3],
      ["Felipe", "PON", 2],
      ["Gabi", "LEV", 3],
      ["Henrique", "CEN", 4],
      ["Isa", "PON", 3],
      ["João", "QQ", 2],
      ["Larissa", "OPO", 5],
      ["Mateus", "QQ", 1],
    ].forEach(([name, pos, level]) =>
      savePlayer({
        id: uid(),
        name,
        pos,
        level,
        present: true,
        sample: true,
      }),
    );
    toast("12 jogadores de exemplo carregados.");
  });
  $("#rmSample").addEventListener("click", (e) => {
    if (armed(e.currentTarget, "Confirmar remoção"))
      S.players
        .filter((p) => p.sample)
        .forEach((p) => Store.del("players/" + p.id));
  });

  /* ---------- DRAW ---------- */
  let K = 4;
  try {
    K = +localStorage.getItem("vgo:k") || 4;
  } catch (e) {}
  let justDrew = false;
  document.querySelectorAll("#modeSeg button").forEach((b) =>
    b.addEventListener("click", () => {
      K = +b.dataset.k;
      try {
        localStorage.setItem("vgo:k", K);
      } catch (e) {}
      renderDraw();
    }),
  );
  function renderDraw() {
    document
      .querySelectorAll("#modeSeg button")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(+b.dataset.k === K)),
      );
    const n = S.players.filter((p) => p.present).length,
      t = Math.floor(n / K),
      r = n - t * K;
    $("#drawInfo").innerHTML =
      t >= 2
        ? `<strong>${n} presentes</strong> → ${t} times de ${K}${r ? ` e ${r} de fora na primeira` : ""}.`
        : `<strong>${n} presentes.</strong> Para ${K}x${K} são precisos pelo menos ${K * 2}.`;
    $("#doDraw").disabled = t < 2;
    const d = S.draw,
      out = $("#drawOut");
    if (!d || !d.teams) {
      out.innerHTML = "";
      return;
    }
    const when = new Date(d.at).toLocaleString("pt-BR", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    out.innerHTML = `<div class="row" style="justify-content:space-between"><h3>Último sorteio · ${d.k}x${d.k}</h3><span class="muted">${esc(when)}</span></div>
   <div class="teams ${justDrew ? "reveal" : ""}">${d.teams
     .map((tm, i) => {
       const avg =
         tm.players.reduce((s, p) => s + (p.level || 3), 0) / tm.players.length;
       return `<article class="team" style="--tc:${tm.color};animation-delay:${i * 90}ms"><header><h3>${esc(tm.name)}</h3><span class="muted num" title="Nível médio">nível ${avg.toFixed(1).replace(".", ",")}</span></header>
     <ul>${tm.players.map((p) => `<li><span>${esc(p.name)}</span><span class="pos">${p.pos && p.pos !== "QQ" ? esc(POS[p.pos] || "") : ""}</span></li>`).join("")}</ul></article>`;
     })
     .join("")}</div>
   ${d.bench && d.bench.length ? `<p class="bench"><strong>De fora (entram na próxima):</strong> ${d.bench.map((p) => esc(p.name)).join(", ")}</p>` : ""}
   <div class="row edit"><button class="btn primary" id="toCup" type="button">Criar campeonato com estes ${d.teams.length} times</button><button class="btn" id="toLive" type="button">Levar os 2 primeiros ao placar</button></div>`;
    justDrew = false;
    const tc = $("#toCup");
    if (tc)
      tc.addEventListener("click", (e) => {
        if (
          S.cup &&
          S.cup.stage !== "done" &&
          !armed(e.currentTarget, "Substituir campeonato atual?")
        )
          return;
        createCup(d.teams);
      });
    const tl = $("#toLive");
    if (tl)
      tl.addEventListener("click", () => {
        newLive(d.teams[0], d.teams[1], null);
        location.hash = "placar";
      });
  }
  $("#doDraw").addEventListener("click", () => {
    const pool = shuffle(S.players.filter((p) => p.present)),
      t = Math.floor(pool.length / K);
    if (t < 2) return;
    const chosen = pool.slice(0, t * K),
      bench = pool.slice(t * K);
    const teams = Array.from({ length: t }, (_, i) => ({
      name:
        "Time " +
        COLORS[i % COLORS.length][0] +
        (i >= COLORS.length ? " " + (Math.floor(i / COLORS.length) + 1) : ""),
      color: COLORS[i % COLORS.length][1],
      ps: [],
    }));
    let rest = chosen;
    if ($("#optSet").checked) {
      const setters = chosen.filter((p) => p.pos === "LEV").slice(0, t);
      setters.forEach((p, i) => teams[i].ps.push(p));
      rest = chosen.filter((p) => !setters.includes(p));
    }
    if ($("#optBal").checked) {
      rest = [...rest].sort((a, b) => (b.level || 3) - (a.level || 3));
      const sum = (tm) => tm.ps.reduce((s, p) => s + (p.level || 3), 0);
      for (const p of rest) {
        const open = shuffle(teams.filter((tm) => tm.ps.length < K));
        open.sort((a, b) => sum(a) - sum(b) || a.ps.length - b.ps.length);
        open[0].ps.push(p);
      }
    } else {
      for (const p of rest) {
        const open = teams.filter((tm) => tm.ps.length < K);
        open.sort((a, b) => a.ps.length - b.ps.length);
        open[0].ps.push(p);
      }
    }
    const snap = (p) => ({
      id: p.id,
      name: p.name,
      pos: p.pos || "QQ",
      level: p.level || 3,
    });
    justDrew = true;
    Store.put("draw/last", {
      k: K,
      at: Date.now(),
      teams: teams.map((tm) => ({
        name: tm.name,
        color: tm.color,
        players: shuffle(tm.ps).map(snap),
      })),
      bench: bench.map(snap),
    });
  });

  /* ---------- CUP ---------- */
  const STAGE = { q: "Qualificação", s: "Semifinal", f: "Final" };
  function genRR(ids) {
    const arr = [...ids];
    if (arr.length % 2) arr.push(null);
    const n = arr.length,
      out = [];
    for (let r = 0; r < n - 1; r++) {
      for (let i = 0; i < n / 2; i++) {
        const a = arr[i],
          b = arr[n - 1 - i];
        if (a && b)
          out.push({
            id: uid(),
            stage: "q",
            round: r + 1,
            a,
            b,
            sa: null,
            sb: null,
          });
      }
      arr.splice(1, 0, arr.pop());
    }
    return out;
  }
  function createCup(teams) {
    const ts = teams.map((t, i) => ({
      id: "t" + i,
      name: t.name,
      color: t.color,
      players: (t.players || []).map((p) => p.name),
    }));
    const cup = {
      at: Date.now(),
      teams: ts,
      stage: ts.length === 2 ? "f" : "q",
      matches:
        ts.length === 2
          ? [
              {
                id: uid(),
                stage: "f",
                round: 1,
                a: "t0",
                b: "t1",
                sa: null,
                sb: null,
              },
            ]
          : genRR(ts.map((t) => t.id)),
      champion: null,
    };
    Store.put("cup/current", cup);
    location.hash = "campeonato";
    toast("Campeonato criado.");
  }
  const team = (cup, id) =>
    cup.teams.find((t) => t.id === id) || { name: "?", color: "#888" };
  const done = (m) => m.sa != null && m.sb != null;
  const winner = (m) => (m.sa > m.sb ? m.a : m.b);
  function standings(cup) {
    const rows = {};
    cup.teams.forEach(
      (t) => (rows[t.id] = { t, j: 0, v: 0, d: 0, pf: 0, pc: 0 }),
    );
    cup.matches
      .filter((m) => m.stage === "q" && done(m))
      .forEach((m) => {
        const A = rows[m.a],
          B = rows[m.b];
        if (!A || !B) return;
        A.j++;
        B.j++;
        A.pf += m.sa;
        A.pc += m.sb;
        B.pf += m.sb;
        B.pc += m.sa;
        if (m.sa > m.sb) {
          A.v++;
          B.d++;
        } else {
          B.v++;
          A.d++;
        }
      });
    return Object.values(rows).sort(
      (x, y) =>
        y.v - x.v ||
        y.pf - y.pc - (x.pf - x.pc) ||
        y.pf - x.pf ||
        x.t.name.localeCompare(y.t.name),
    );
  }
  const drafts = {};
  function renderCup() {
    const cup = S.cup,
      out = $("#cupOut");
    $("#endCup").hidden = !cup;
    if (!cup) {
      const d = S.draw;
      out.innerHTML = `<div class="empty"><h3>Nenhum campeonato em andamento</h3>
     <p class="muted">Os times vêm do sorteio. Com 4 ou mais times tem qualificação, semifinal (1º x 4º e 2º x 3º) e final. Com 3 times, os dois melhores vão direto para a final.</p>
     ${d && d.teams && d.teams.length >= 2 ? `<button class="btn primary edit" id="cupFromDraw" type="button">Criar com os ${d.teams.length} times do último sorteio</button>` : `<a class="btn primary" href="#sorteio">Ir para o sorteio</a>`}</div>`;
      const b = $("#cupFromDraw");
      if (b) b.addEventListener("click", () => createCup(S.draw.teams));
      return;
    }
    const n = cup.teams.length,
      stages = n >= 4 ? ["q", "s", "f"] : n === 3 ? ["q", "f"] : ["f"];
    const ci = cup.stage === "done" ? stages.length : stages.indexOf(cup.stage);
    let html = `<ol class="steps">${stages
      .map((s, i) => {
        const ms = cup.matches.filter((m) => m.stage === s);
        return `<li class="${i < ci ? "done" : i === ci ? "cur" : ""}">${STAGE[s]}<small>${ms.length ? `${ms.filter(done).length} de ${ms.length} jogos` : "aguardando"}</small></li>`;
      })
      .join("")}</ol>`;
    if (cup.stage === "done" && cup.champion) {
      const c = team(cup, cup.champion);
      html += `<div class="champ"><span class="k">Campeão</span><h2>${esc(c.name)}</h2><p>${c.players.map(esc).join(" · ")}</p></div>`;
    }
    if (stages.includes("q")) {
      const st = standings(cup),
        cut = n >= 4 ? 4 : 2;
      html += `<div class="panel"><h3>Classificação</h3><div class="tbl-wrap"><table class="std"><thead><tr><th>#</th><th>Time</th><th>J</th><th>V</th><th>D</th><th>PF</th><th>PC</th><th>Saldo</th></tr></thead><tbody>
    ${st.map((r, i) => `<tr class="${i === cut - 1 && st.length > cut ? "cut" : ""}"><td>${i + 1}</td><td><span class="dot" style="--tc:${r.t.color}"></span>${esc(r.t.name)}</td><td>${r.j}</td><td><strong>${r.v}</strong></td><td>${r.d}</td><td>${r.pf}</td><td>${r.pc}</td><td>${r.pf - r.pc > 0 ? "+" : ""}${r.pf - r.pc}</td></tr>`).join("")}
    </tbody></table></div><p class="muted" style="font-size:.85rem">Desempate: vitórias, saldo de pontos, pontos feitos. ${st.length > cut ? `A linha amarela marca quem avança.` : ""}</p></div>`;
    }
    [...stages].reverse().forEach((s) => {
      const ms = cup.matches.filter((m) => m.stage === s);
      if (!ms.length) return;
      const editable = s === cup.stage && !RO;
      html += `<div class="panel"><h3>${STAGE[s]}</h3><div class="matches">${ms
        .map((m) => {
          const A = team(cup, m.a),
            B = team(cup, m.b),
            dn = done(m),
            w = dn ? winner(m) : null;
          const va = drafts[m.id + "a"] ?? m.sa ?? "",
            vb = drafts[m.id + "b"] ?? m.sb ?? "";
          return `<div class="match" data-id="${m.id}"><span class="rd">${s === "q" ? "Rodada " + m.round : STAGE[s]}${dn ? " · encerrado" : ""}</span>
       <span class="tn r ${w === m.a ? "win" : ""}">${esc(A.name)} <span class="dot" style="--tc:${A.color};margin:0 0 0 6px"></span></span>
       <span class="sc">${editable ? `<input type="number" min="0" max="99" inputmode="numeric" id="m-${m.id}-a" data-side="a" value="${esc(va)}" aria-label="Pontos ${esc(A.name)}"><span class="muted">x</span><input type="number" min="0" max="99" inputmode="numeric" id="m-${m.id}-b" data-side="b" value="${esc(vb)}" aria-label="Pontos ${esc(B.name)}">` : `<b class="num">${dn ? m.sa : "–"}</b><span class="muted">x</span><b class="num">${dn ? m.sb : "–"}</b>`}</span>
       <span class="tn ${w === m.b ? "win" : ""}"><span class="dot" style="--tc:${B.color}"></span>${esc(B.name)}</span>
       <span class="acts">${editable ? `<button class="btn sm primary" type="button" data-act="save">Salvar</button><button class="btn sm" type="button" data-act="live">Placar</button>` : ""}</span></div>`;
        })
        .join("")}</div>`;
      if (s === cup.stage && s !== "f" && ms.every(done) && !RO)
        html += `<button class="btn go" type="button" id="advance">${s === "q" ? (n >= 4 ? "Gerar semifinais" : "Gerar final") : "Gerar final"}</button>`;
      html += `</div>`;
    });
    out.innerHTML = html;
    const adv = $("#advance");
    if (adv) adv.addEventListener("click", advance);
  }
  $("#cupOut").addEventListener("input", (e) => {
    const el = e.target.closest(".match input");
    if (!el) return;
    drafts[el.closest(".match").dataset.id + el.dataset.side] = el.value;
  });
  $("#cupOut").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.closest(".match").dataset.id,
      cup = clone(S.cup),
      m = cup.matches.find((x) => x.id === id);
    if (!m) return;
    if (b.dataset.act === "save") {
      const a = $(`#m-${id}-a`).value,
        bb = $(`#m-${id}-b`).value;
      if (a === "" || bb === "") {
        toast("Preencha os dois placares.");
        return;
      }
      const sa = Math.max(0, Math.round(+a)),
        sb = Math.max(0, Math.round(+bb));
      if (sa === sb) {
        toast("No vôlei não tem empate. Confira o placar.");
        return;
      }
      saveResult(cup, m, sa, sb);
      delete drafts[id + "a"];
      delete drafts[id + "b"];
    }
    if (b.dataset.act === "live") {
      newLive(team(cup, m.a), team(cup, m.b), {
        cupAt: cup.at,
        match: m.id,
        a: m.a,
        b: m.b,
        label:
          m.stage === "q" ? "Qualificação · Rodada " + m.round : STAGE[m.stage],
      });
      location.hash = "placar";
    }
  });
  function saveResult(cup, m, sa, sb) {
    m.sa = sa;
    m.sb = sb;
    if (m.stage === "f") {
      cup.stage = "done";
      cup.champion = winner(m);
      toast("Temos campeão: " + team(cup, cup.champion).name + "!");
    } else toast("Resultado salvo.");
    Store.put("cup/current", cup);
  }
  function advance() {
    const cup = clone(S.cup),
      n = cup.teams.length;
    if (cup.stage === "q") {
      const st = standings(cup);
      if (n >= 4) {
        cup.matches.push(
          {
            id: uid(),
            stage: "s",
            round: 1,
            a: st[0].t.id,
            b: st[3].t.id,
            sa: null,
            sb: null,
          },
          {
            id: uid(),
            stage: "s",
            round: 2,
            a: st[1].t.id,
            b: st[2].t.id,
            sa: null,
            sb: null,
          },
        );
        cup.stage = "s";
      } else {
        cup.matches.push({
          id: uid(),
          stage: "f",
          round: 1,
          a: st[0].t.id,
          b: st[1].t.id,
          sa: null,
          sb: null,
        });
        cup.stage = "f";
      }
    } else if (cup.stage === "s") {
      const ss = cup.matches.filter((m) => m.stage === "s");
      cup.matches.push({
        id: uid(),
        stage: "f",
        round: 1,
        a: winner(ss[0]),
        b: winner(ss[1]),
        sa: null,
        sb: null,
      });
      cup.stage = "f";
    }
    Store.put("cup/current", cup);
  }
  $("#endCup").addEventListener("click", (e) => {
    if (armed(e.currentTarget, "Confirmar: apagar campeonato"))
      Store.del("cup/current");
  });

  /* ---------- LIVE SCOREBOARD ---------- */
  const colorOpts = COLORS.map(
    ([n, h]) => `<option value="${h}">${n}</option>`,
  ).join("");
  $("#lColA").innerHTML = colorOpts;
  $("#lColB").innerHTML = colorOpts;
  const defLive = () => ({
    A: { name: "Time Azul", color: "#1450C8" },
    B: { name: "Time Amarelo", color: "#FFC72C" },
    pA: 0,
    pB: 0,
    setsA: 0,
    setsB: 0,
    sets: [],
    bestOf: 3,
    target: 25,
    tb: 15,
    serve: null,
    over: false,
    winner: null,
    swapped: false,
    ref: null,
    undo: [],
  });
  const L = () => S.live || defLive();
  function newLive(ta, tb, ref) {
    const cur = L();
    const l = defLive();
    l.A = { name: ta.name, color: ta.color };
    l.B = { name: tb.name, color: tb.color };
    if (ref) {
      l.ref = ref;
      l.bestOf = 1;
      l.target = cur.target || 25;
    } else {
      l.bestOf = cur.bestOf;
      l.target = cur.target;
      l.tb = cur.tb;
    }
    S.live = l;
    Store.put("live/score", l);
  }
  const isTB = (l) => l.bestOf > 1 && l.setsA + l.setsB === l.bestOf - 1;
  const tgt = (l) => (isTB(l) ? l.tb : l.target);
  function commit(l) {
    S.live = l;
    renderLive();
    Store.put("live/score", l);
  }
  function point(side) {
    if (RO) return;
    const l = clone(L());
    if (l.over) return;
    l.undo = (l.undo || []).slice(-29);
    l.undo.push({
      pA: l.pA,
      pB: l.pB,
      setsA: l.setsA,
      setsB: l.setsB,
      sets: l.sets,
      serve: l.serve,
      over: l.over,
      winner: l.winner,
    });
    l["p" + side]++;
    l.serve = side;
    const me = l["p" + side],
      op = l["p" + (side === "A" ? "B" : "A")];
    if (me >= tgt(l) && me - op >= 2) {
      l.sets = [...l.sets, { a: l.pA, b: l.pB }];
      l["sets" + side]++;
      l.pA = 0;
      l.pB = 0;
      if (l["sets" + side] >= Math.ceil(l.bestOf / 2)) {
        l.over = true;
        l.winner = side;
        toast((side === "A" ? l.A : l.B).name + " venceu o jogo!");
      } else toast("Fim do set para " + (side === "A" ? l.A : l.B).name + ".");
    }
    commit(l);
  }
  function sideHTML(l, s) {
    const t = s === "A" ? l.A : l.B,
      p = l["p" + s],
      o = l["p" + (s === "A" ? "B" : "A")],
      need = Math.ceil(l.bestOf / 2),
      won = l["sets" + s];
    const sp = !l.over && p >= tgt(l) - 1 && p > o;
    const mp = sp && won === need - 1;
    return `<span class="nm">${esc(t.name)}</span><span class="pts">${p}</span>
   <span class="meta">${l.bestOf > 1 ? `<span class="pips" aria-label="${won} sets">${Array.from({ length: need }, (_, i) => `<i class="${i < won ? "f" : ""}"></i>`).join("")}</span>` : ""}
   <svg class="srv ${l.serve === s && !l.over ? "on" : ""}" viewBox="0 0 24 24" aria-label="Saque"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2c-2 4-2 8 0 10s7 3 10 1M3 7c4 0 7 2 9 5s1 7-2 10M12 12c-3 2-7 2-10 0" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
   ${l.over && l.winner === s ? `<span class="flag">Venceu</span>` : mp ? `<span class="flag">Match point</span>` : sp ? `<span class="flag">Set point</span>` : ""}</span>`;
  }
  function renderLive() {
    const l = L();
    const left = l.swapped ? "B" : "A",
      right = l.swapped ? "A" : "B";
    [
      ["#sideL", left],
      ["#sideR", right],
    ].forEach(([sel, s]) => {
      const el = $(sel),
        t = s === "A" ? l.A : l.B;
      el.style.setProperty("--tc", t.color);
      el.style.setProperty("--ti", ink(t.color));
      el.dataset.side = s;
      el.disabled = RO || l.over;
      el.setAttribute(
        "aria-label",
        `Ponto para ${t.name}. Placar ${l["p" + s]}`,
      );
      el.innerHTML = sideHTML(l, s);
    });
    const setN = l.setsA + l.setsB + 1;
    $("#setHist").innerHTML =
      `<span class="lbl">${l.over ? "Sets" : `Set ${setN}${isTB(l) ? " · tie-break" : ""} · até ${tgt(l)}`}</span>` +
      l.sets.map((x) => `<span class="chip num">${x.a}–${x.b}</span>`).join("");
    let ban = "";
    if (l.ref) {
      const cup = S.cup,
        ok =
          cup &&
          cup.at === l.ref.cupAt &&
          cup.matches.some(
            (m) => m.id === l.ref.match && m.stage === cup.stage && !done(m),
          );
      ban = `<div class="banner ${l.over ? "win" : ""}"><span>Jogo do campeonato · ${esc(l.ref.label)}</span>${l.over && ok && !RO ? `<button class="btn sm primary" id="sendRes" type="button">Enviar resultado ao campeonato</button>` : ""}</div>`;
    } else if (l.over)
      ban = `<div class="banner win"><span>${esc((l.winner === "A" ? l.A : l.B).name)} venceu por ${Math.max(l.setsA, l.setsB)} a ${Math.min(l.setsA, l.setsB)} em sets.</span></div>`;
    $("#liveBanner").innerHTML = ban;
    const sr = $("#sendRes");
    if (sr) sr.addEventListener("click", sendResult);
    const fa = document.activeElement;
    if (fa !== $("#lNameA")) $("#lNameA").value = l.A.name;
    if (fa !== $("#lNameB")) $("#lNameB").value = l.B.name;
    $("#lColA").value = l.A.color;
    $("#lColB").value = l.B.color;
    $("#lBest").value = l.bestOf;
    $("#lTarget").value = l.target;
    $("#lTb").value = l.tb;
    $("#lTb").disabled = l.bestOf === 1;
    const d = S.draw;
    $("#loadDrawRow").hidden = !(d && d.teams && d.teams.length >= 2);
    if (d && d.teams) {
      const o = d.teams
        .map((t, i) => `<option value="${i}">${esc(t.name)}</option>`)
        .join("");
      const a = $("#lFromA").value,
        b = $("#lFromB").value;
      $("#lFromA").innerHTML = o;
      $("#lFromB").innerHTML = o;
      $("#lFromA").value = a || "0";
      $("#lFromB").value = b || "1";
    }
    $("#undo").disabled = !(l.undo && l.undo.length);
  }
  ["#sideL", "#sideR"].forEach((s) =>
    $(s).addEventListener("click", (e) => point(e.currentTarget.dataset.side)),
  );
  document.addEventListener("keydown", (e) => {
    if (
      VIEW !== "placar" ||
      /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)
    )
      return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      point($("#sideL").dataset.side);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      point($("#sideR").dataset.side);
    }
  });
  $("#undo").addEventListener("click", () => {
    const l = clone(L());
    const u = (l.undo || []).pop();
    if (!u) return;
    Object.assign(l, u);
    commit(l);
  });
  $("#swap").addEventListener("click", () => {
    const l = clone(L());
    l.swapped = !l.swapped;
    commit(l);
  });
  $("#resetLive").addEventListener("click", (e) => {
    if (!armed(e.currentTarget, "Confirmar: zerar")) return;
    const l = clone(L());
    Object.assign(l, {
      pA: 0,
      pB: 0,
      setsA: 0,
      setsB: 0,
      sets: [],
      serve: null,
      over: false,
      winner: null,
      undo: [],
    });
    commit(l);
  });
  const liveSet = (fn) => {
    const l = clone(L());
    fn(l);
    commit(l);
  };
  let nameT;
  ["A", "B"].forEach((s) => {
    $("#lName" + s).addEventListener("input", (e) => {
      clearTimeout(nameT);
      const v = e.target.value.slice(0, 30);
      nameT = setTimeout(
        () => liveSet((l) => (l[s].name = v || "Time " + s)),
        500,
      );
    });
    $("#lCol" + s).addEventListener("change", (e) =>
      liveSet((l) => (l[s].color = e.target.value)),
    );
  });
  $("#lBest").addEventListener("change", (e) =>
    liveSet((l) => (l.bestOf = +e.target.value)),
  );
  $("#lTarget").addEventListener("change", (e) =>
    liveSet((l) => (l.target = +e.target.value)),
  );
  $("#lTb").addEventListener("change", (e) =>
    liveSet((l) => (l.tb = +e.target.value)),
  );
  $("#lLoad").addEventListener("click", () => {
    const d = S.draw,
      a = +$("#lFromA").value,
      b = +$("#lFromB").value;
    if (a === b) {
      toast("Escolha dois times diferentes.");
      return;
    }
    newLive(d.teams[a], d.teams[b], null);
    toast("Times carregados no placar.");
  });
  function sendResult() {
    const l = L(),
      cup = clone(S.cup);
    if (!cup || !l.ref) return;
    const m = cup.matches.find((x) => x.id === l.ref.match);
    if (!m) return;
    let ra, rb;
    if (l.bestOf === 1) {
      const last = l.sets[l.sets.length - 1];
      ra = last.a;
      rb = last.b;
    } else {
      ra = l.setsA;
      rb = l.setsB;
    }
    if (m.a === l.ref.a) saveResult(cup, m, ra, rb);
    else saveResult(cup, m, rb, ra);
    const nl = clone(l);
    nl.ref = null;
    commit(nl);
    location.hash = "campeonato";
  }

  /* ---------- CALENDAR ---------- */
  const today = new Date();
  let calY = today.getFullYear(),
    calM = today.getMonth(),
    selDay = null;
  $("#gDate").value = iso(today);
  function renderCal() {
    const first = new Date(calY, calM, 1),
      start = new Date(calY, calM, 1 - first.getDay());
    $("#calTitle").textContent = first.toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric",
    });
    const byDay = {};
    S.games.forEach((g) => (byDay[g.date] = byDay[g.date] || []).push(g));
    let h = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
      .map((d) => `<span class="dow">${d}</span>`)
      .join("");
    for (let i = 0; i < 42; i++) {
      const d = new Date(
          start.getFullYear(),
          start.getMonth(),
          start.getDate() + i,
        ),
        k = iso(d);
      h += `<button type="button" data-d="${k}" class="${d.getMonth() !== calM ? "out" : ""} ${k === iso(today) ? "today" : ""} ${k === selDay ? "sel" : ""} ${byDay[k] ? "has" : ""}" aria-label="${d.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}${byDay[k] ? `, ${byDay[k].length} jogo(s)` : ""}">${d.getDate()}<i></i></button>`;
    }
    $("#cal").innerHTML = h;
    const item = (g) => {
      const d = parseISO(g.date);
      return `<li class="game" data-id="${esc(g.id)}"><div class="d"><b class="num">${d.getDate()}</b><span>${d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</span></div>
    <div style="min-width:0"><h4>${esc(g.title)}</h4><p>${esc(d.toLocaleDateString("pt-BR", { weekday: "long" }))}${g.time ? " · " + esc(g.time) : ""}${g.place ? " · " + esc(g.place) : ""}</p>${g.note ? `<p>${esc(g.note)}</p>` : ""}</div>
    <button type="button" class="icon-btn edit" data-act="rm">Apagar</button></li>`;
    };
    let list, title;
    if (selDay) {
      list = (byDay[selDay] || []).sort((a, b) =>
        (a.time || "").localeCompare(b.time || ""),
      );
      title = "Jogos em " + fmtLong(selDay);
    } else {
      list = upcoming();
      title = "Próximos jogos";
    }
    $("#gListTitle").textContent = title;
    $("#gList").innerHTML = list.length
      ? list.map(item).join("")
      : `<li class="muted">${selDay ? "Nada marcado neste dia. O formulário já está com esta data." : "Nenhum jogo marcado. Escolha um dia no calendário e salve o primeiro."}</li>` +
        (selDay
          ? `<li><button class="btn sm ghost" type="button" id="clrDay">Ver todos os próximos</button></li>`
          : "");
    const up = new Set(upcoming().map((g) => g.id)),
      past = S.games
        .filter((g) => !up.has(g.id))
        .sort((a, b) =>
          (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")),
        );
    $("#pastWrap").hidden = selDay || !past.length;
    $("#gPast").innerHTML = past.map(item).join("");
    const c = $("#clrDay");
    if (c)
      c.addEventListener("click", () => {
        selDay = null;
        renderCal();
      });
  }
  $("#cal").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-d]");
    if (!b) return;
    const k = b.dataset.d;
    selDay = selDay === k ? null : k;
    if (selDay) $("#gDate").value = k;
    const d = parseISO(k);
    if (d.getMonth() !== calM) {
      calY = d.getFullYear();
      calM = d.getMonth();
    }
    renderCal();
  });
  $("#calPrev").addEventListener("click", () => {
    calM--;
    if (calM < 0) {
      calM = 11;
      calY--;
    }
    renderCal();
  });
  $("#calNext").addEventListener("click", () => {
    calM++;
    if (calM > 11) {
      calM = 0;
      calY++;
    }
    renderCal();
  });
  const onRm = (e) => {
    const b = e.target.closest("button[data-act=rm]");
    if (!b) return;
    const id = b.closest(".game").dataset.id;
    if (armed(b, "Confirmar")) Store.del("games/" + id);
  };
  $("#gList").addEventListener("click", onRm);
  $("#gPast").addEventListener("click", onRm);
  $("#fGame").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("#gTitle").value.trim(),
      date = $("#gDate").value;
    if (!title || !date) return;
    const save = Store.put("games/" + uid(), {
      title,
      date,
      time: $("#gTime").value,
      place: $("#gPlace").value.trim(),
      note: $("#gNote").value.trim(),
      at: Date.now(),
    });
    $("#gTitle").value = "";
    $("#gNote").value = "";
    selDay = date;
    const d = parseISO(date);
    calY = d.getFullYear();
    calM = d.getMonth();
    toast("Salvando jogo no Database…");
    save.then((saved) => {
      if (saved) toast("Jogo salvo no calendário.");
    });
  });

  /* ---------- boot ---------- */
  route();
  connect();
})();
