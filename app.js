import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
 addDoc,
  getDocs,
  query,
  where,
  limit,
  orderBy,
  updateDoc,
  deleteDoc,
  doc,
  Timestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAvXzB0423tB-WlHFo2T77ijPM__r3BXl4",
  authDomain: "sistema-otimac.firebaseapp.com",
  projectId: "sistema-otimac",
  storageBucket: "sistema-otimac.firebasestorage.app",
  messagingSenderId: "269859338546",
  appId: "1:269859338546:web:339e9ef1401e79c8687f2b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const appRoot = document.getElementById("app");
const modalOverlay = document.getElementById("modalOverlay");
const modalBody = document.getElementById("modalBody");
const modalClose = document.getElementById("modalClose");

let usuarioActual = cargarSesion();
let mensajeActual = { texto: "", tipo: "" };
let movimientosCache = [];
let usuariosCache = [];
let resumenCache = null;
let unsubscribeMovimientos = null;
let unsubscribeUsuarios = null;

const state = {
  filtroTipo: "todos",
  busqueda: "",
  adminTab: "resumen",
  choferTab: "inicio"
};

if (modalClose) {
  modalClose.addEventListener("click", cerrarModal);
}

if (modalOverlay) {
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) cerrarModal();
  });
}

function guardarSesion(usuario) {
  localStorage.setItem("otimac_usuario", JSON.stringify(usuario));
}

function cargarSesion() {
  try {
    const raw = localStorage.getItem("otimac_usuario");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function limpiarSesion() {
  localStorage.removeItem("otimac_usuario");
}

function escapeHtml(texto) {
  return String(texto ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function claveNombre(nombre) {
  return (nombre || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function dinero(valor) {
  const num = Number(valor || 0);
  return `$${num.toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function normalizarFecha(fecha) {
  if (!fecha) return null;
  if (fecha instanceof Timestamp) return fecha.toDate();
  if (fecha?.seconds) return new Date(fecha.seconds * 1000);
  if (fecha instanceof Date) return fecha;
  return new Date(fecha);
}

function fechaLegible(fecha) {
  if (!fecha) return "Sin fecha";
  try {
    const f = normalizarFecha(fecha);
    return f.toLocaleString("es-MX");
  } catch {
    return String(fecha);
  }
}

function inicioDelDia(dt) {
  const x = new Date(dt);
  x.setHours(0, 0, 0, 0);
  return x;
}

function inicioDeSemana(dt) {
  const base = inicioDelDia(dt);
  const day = base.getDay();
  const diff = day === 0 ? 6 : day - 1;
  base.setDate(base.getDate() - diff);
  return base;
}

function inicioDeMes(dt) {
  const x = new Date(dt);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function ahoraLocal() {
  return new Date();
}

function setMensaje(texto, tipo = "error") {
  mensajeActual = { texto, tipo };
  render();
}

function limpiarMensaje() {
  mensajeActual = { texto: "", tipo: "" };
}

function mensajeHtml() {
  if (!mensajeActual.texto) return "";
  return `<div class="message ${mensajeActual.tipo}">${escapeHtml(mensajeActual.texto)}</div>`;
}

function abrirModal(titulo, html) {
  if (!modalOverlay || !modalBody) return;
  const title = document.getElementById("modalTitle");
  if (title) title.textContent = titulo;
  modalBody.innerHTML = html;
  modalOverlay.classList.remove("hidden");
}

function cerrarModal() {
  if (!modalOverlay || !modalBody) return;
  modalOverlay.classList.add("hidden");
  modalBody.innerHTML = "";
}

async function obtenerUsuarioPorNombre(nombre) {
  const nombreKey = claveNombre(nombre);
  const q = query(
    collection(db, "usuarios"),
    where("nombre_key", "==", nombreKey),
    limit(1)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  const d = snapshot.docs[0];
  return { _id: d.id, ...d.data() };
}

async function crearUsuarioChofer(nombre, numeroEconomico) {
  const data = {
    nombre: (nombre || "").trim(),
    nombre_key: claveNombre(nombre),
    rol: "chofer",
    password: (numeroEconomico || "").trim(),
    numero_economico: (numeroEconomico || "").trim(),
    activo: true,
    creado_en: Timestamp.now()
  };
  await addDoc(collection(db, "usuarios"), data);
}

async function validarLogin(nombre, password) {
  nombre = (nombre || "").trim();
  password = (password || "").trim();

  if (!nombre || !password) {
    return { ok: false, mensaje: "Debes capturar nombre y contraseña.", usuario: null };
  }

  const usuario = await obtenerUsuarioPorNombre(nombre);

  if (usuario) {
    if (!usuario.activo) {
      return { ok: false, mensaje: "Usuario inactivo.", usuario: null };
    }

    if ((usuario.password || "") !== password) {
      return { ok: false, mensaje: "Contraseña incorrecta.", usuario: null };
    }

    return { ok: true, mensaje: "Acceso correcto.", usuario };
  }

  if (/^\d+$/.test(password)) {
    await crearUsuarioChofer(nombre, password);
    const usuarioNuevo = await obtenerUsuarioPorNombre(nombre);
    return { ok: true, mensaje: "Chofer creado correctamente.", usuario: usuarioNuevo };
  }

  return {
    ok: false,
    mensaje: "Usuario no encontrado. Si eres chofer, entra con tu nombre y tu número económico como contraseña.",
    usuario: null
  };
}

async function guardarOperacion(tipo, numeroEconomico, placa, monto, concepto, usuario) {
  const montoFloat = Number(monto);

  if (Number.isNaN(montoFloat)) {
    return { ok: false, mensaje: "El monto debe ser un número válido." };
  }

  if (montoFloat <= 0) {
    return { ok: false, mensaje: "El monto debe ser mayor que cero." };
  }

  numeroEconomico = (numeroEconomico || "").trim();
  placa = (placa || "").trim();
  concepto = (concepto || "").trim();

  if (tipo === "ingreso" && !numeroEconomico) {
    return { ok: false, mensaje: "Para ingreso debes capturar el número económico." };
  }

  if (!concepto) {
    concepto = tipo === "ingreso" ? "Cooperación diaria" : "Gasto general";
  }

  try {
    await addDoc(collection(db, "operaciones_otimac"), {
      tipo,
      numero_economico: numeroEconomico,
      placa,
      monto: montoFloat,
      concepto,
      fecha: Timestamp.now(),
      capturado_por: usuario?.nombre || "Sin nombre",
      rol_captura: usuario?.rol || ""
    });
    return { ok: true, mensaje: "Movimiento guardado correctamente." };
  } catch (e) {
    return { ok: false, mensaje: `Error al guardar: ${e.message}` };
  }
}

async function actualizarMovimiento(movId, tipo, numeroEconomico, placa, monto, concepto) {
  const montoFloat = Number(monto);

  if (Number.isNaN(montoFloat)) {
    return { ok: false, mensaje: "El monto debe ser un número válido." };
  }

  if (montoFloat <= 0) {
    return { ok: false, mensaje: "El monto debe ser mayor que cero." };
  }

  numeroEconomico = (numeroEconomico || "").trim();
  placa = (placa || "").trim();
  concepto = (concepto || "").trim();

  if (tipo === "ingreso" && !numeroEconomico) {
    return { ok: false, mensaje: "Para ingreso debes capturar el número económico." };
  }

  if (!concepto) {
    concepto = tipo === "ingreso" ? "Cooperación diaria" : "Gasto general";
  }

  try {
    await updateDoc(doc(db, "operaciones_otimac", movId), {
      tipo,
      numero_economico: numeroEconomico,
      placa,
      monto: montoFloat,
      concepto,
      editado_en: Timestamp.now()
    });
    return { ok: true, mensaje: "Movimiento actualizado correctamente." };
  } catch (e) {
    return { ok: false, mensaje: `Error al actualizar movimiento: ${e.message}` };
  }
}

async function borrarMovimiento(movId) {
  try {
    await deleteDoc(doc(db, "operaciones_otimac", movId));
    return { ok: true, mensaje: "Movimiento borrado correctamente." };
  } catch (e) {
    return { ok: false, mensaje: `Error al borrar movimiento: ${e.message}` };
  }
}

async function calcularResumenDesdeLista(lista) {
  const resumen = {
    ingresos_hoy: 0,
    egresos_hoy: 0,
    ingresos_semana: 0,
    egresos_semana: 0,
    ingresos_mes: 0,
    egresos_mes: 0,
    saldo_total: 0
  };

  const ahora = ahoraLocal();
  const desdeHoy = inicioDelDia(ahora);
  const desdeSemana = inicioDeSemana(ahora);
  const desdeMes = inicioDeMes(ahora);

  for (const m of lista) {
    const monto = Number(m.monto || 0);
    const tipo = m.tipo || "";
    const fecha = normalizarFecha(m.fecha);

    if (tipo === "ingreso") resumen.saldo_total += monto;
    else resumen.saldo_total -= monto;

    if (!fecha) continue;

    if (fecha >= desdeHoy) {
      if (tipo === "ingreso") resumen.ingresos_hoy += monto;
      else resumen.egresos_hoy += monto;
    }

    if (fecha >= desdeSemana) {
      if (tipo === "ingreso") resumen.ingresos_semana += monto;
      else resumen.egresos_semana += monto;
    }

    if (fecha >= desdeMes) {
      if (tipo === "ingreso") resumen.ingresos_mes += monto;
      else resumen.egresos_mes += monto;
    }
  }

  return resumen;
}

function getMovimientosFiltrados() {
  return movimientosCache.filter((m) => {
    const tipoOk = state.filtroTipo === "todos" ? true : m.tipo === state.filtroTipo;

    const texto = [
      m.numero_economico || "",
      m.placa || "",
      m.concepto || "",
      m.capturado_por || ""
    ].join(" ").toLowerCase();

    const busquedaOk = !state.busqueda.trim()
      ? true
      : texto.includes(state.busqueda.trim().toLowerCase());

    return tipoOk && busquedaOk;
  });
}

function getUsuariosOrdenados() {
  return [...usuariosCache].sort((a, b) => {
    const an = (a.nombre || "").toLowerCase();
    const bn = (b.nombre || "").toLowerCase();
    return an.localeCompare(bn);
  });
}

function statCard(label, value, cls) {
  return `
    <div class="stat ${cls}">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${dinero(value)}</div>
    </div>
  `;
}

function renderMovimientosList(esAdmin = false) {
  const lista = getMovimientosFiltrados();

  if (!lista.length) {
    return `<div class="card empty">No hay movimientos que coincidan con los filtros actuales.</div>`;
  }

  return `
    <div class="list">
      ${lista.map((m) => {
        const ingreso = m.tipo === "ingreso";
        const numero = m.numero_economico || "";
        const placa = m.placa || "";
        const concepto = m.concepto || "";
        const monto = Number(m.monto || 0);
        const fecha = fechaLegible(m.fecha);
        const capturadoPor = m.capturado_por || "Sin usuario";
        const titulo = ingreso && numero ? `Unidad ${escapeHtml(numero)}` : escapeHtml(concepto);

        let subtitulo = `${escapeHtml(concepto)} | ${escapeHtml(fecha)} | ${escapeHtml(capturadoPor)}`;
        if (placa) subtitulo += ` | Placa: ${escapeHtml(placa)}`;

        return `
          <div class="movement">
            <div class="movement-main">
              <div>
                <div class="movement-title">${titulo}</div>
                <div class="movement-subtitle">${subtitulo}</div>
              </div>
              <div class="movement-amount ${ingreso ? "ingreso" : "egreso"}">
                ${ingreso ? "+" : "-"}${dinero(monto)}
              </div>
            </div>
            ${
              esAdmin
                ? `
                <div class="actions">
                  <button class="btn btn-primary js-editar" data-id="${m._id}">Editar</button>
                  <button class="btn btn-danger js-borrar" data-id="${m._id}">Borrar</button>
                </div>
              `
                : ""
            }
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderUsuariosList() {
  const lista = getUsuariosOrdenados();

  if (!lista.length) {
    return `<div class="card empty">No hay usuarios creados todavía.</div>`;
  }

  return `
    <div class="list">
      ${lista.map((u) => `
        <div class="movement">
          <div class="movement-main">
            <div>
              <div class="movement-title">${escapeHtml(u.nombre || "Sin nombre")}</div>
              <div class="movement-subtitle">
                Rol: ${escapeHtml(u.rol || "")}
                ${u.numero_economico ? ` | Núm. económico: ${escapeHtml(u.numero_economico)}` : ""}
                | Estado: ${u.activo === false ? "Inactivo" : "Activo"}
              </div>
            </div>
            <div class="badge">${escapeHtml(u.rol || "usuario")}</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function buildToolbar() {
  return `
    <div class="card">
      <div class="toolbar">
        <input id="busquedaInput" class="input" type="text" placeholder="Buscar por número, placa, concepto o usuario" value="${escapeHtml(state.busqueda)}" />
        <select id="filtroTipo" class="select">
          <option value="todos" ${state.filtroTipo === "todos" ? "selected" : ""}>Todos</option>
          <option value="ingreso" ${state.filtroTipo === "ingreso" ? "selected" : ""}>Ingresos</option>
          <option value="egreso" ${state.filtroTipo === "egreso" ? "selected" : ""}>Egresos</option>
        </select>
      </div>
    </div>
  `;
}

function buildAdminTabs() {
  return `
    <div class="card">
      <div class="btn-row">
        <button class="btn ${state.adminTab === "resumen" ? "btn-primary" : "btn-soft"} js-admin-tab" data-tab="resumen">Resumen</button>
        <button class="btn ${state.adminTab === "movimientos" ? "btn-primary" : "btn-soft"} js-admin-tab" data-tab="movimientos">Movimientos</button>
        <button class="btn ${state.adminTab === "usuarios" ? "btn-primary" : "btn-soft"} js-admin-tab" data-tab="usuarios">Usuarios</button>
        <button class="btn btn-danger" id="btnCerrarSesion">Cerrar sesión</button>
      </div>
    </div>
  `;
}

function buildChoferTabs() {
  return `
    <div class="card">
      <div class="btn-row">
        <button class="btn ${state.choferTab === "inicio" ? "btn-primary" : "btn-soft"} js-chofer-tab" data-tab="inicio">Inicio</button>
        <button class="btn ${state.choferTab === "movimientos" ? "btn-primary" : "btn-soft"} js-chofer-tab" data-tab="movimientos">Movimientos</button>
        <button class="btn btn-danger" id="btnCerrarSesion">Cerrar sesión</button>
      </div>
    </div>
  `;
}

function buildHeaderAdmin(resumen) {
  return `
    <div class="header admin">
      <div class="header-inner">
        <p class="eyebrow">OTIMAC · Administración</p>
        <div class="header-main">
          <div>
            <h2>${escapeHtml(usuarioActual?.nombre || "")}</h2>
            <p class="header-sub">Panel de control de caja general</p>
          </div>
          <div>
            <div class="header-sub">Saldo total</div>
            <div class="header-balance">${dinero(resumen.saldo_total)}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildHeaderChofer(resumen) {
  return `
    <div class="header">
      <div class="header-inner">
        <p class="eyebrow">OTIMAC · Chofer</p>
        <div class="header-main">
          <div>
            <h2>${escapeHtml(usuarioActual?.nombre || "")}</h2>
            <p class="header-sub">Captura rápida de movimientos</p>
          </div>
          <div>
            <div class="header-sub">Saldo actual</div>
            <div class="header-balance">${dinero(resumen.saldo_total)}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildMovimientoForm(prefill = {}, buttonClass = "btn-accent", buttonText = "Guardar movimiento") {
  return `
    <div class="field">
      <label>Tipo de movimiento</label>
      <select id="movTipo" class="select">
        <option value="ingreso" ${prefill.tipo === "egreso" ? "" : "selected"}>Ingreso</option>
        <option value="egreso" ${prefill.tipo === "egreso" ? "selected" : ""}>Egreso</option>
      </select>
    </div>

    <div class="field">
      <label>Número económico</label>
      <input id="movNumero" class="input" type="text" value="${escapeHtml(prefill.numero_economico || "")}" />
    </div>

    <div class="field">
      <label>Placa (opcional)</label>
      <input id="movPlaca" class="input" type="text" value="${escapeHtml(prefill.placa || "")}" />
    </div>

    <div class="field">
      <label>Monto</label>
      <input id="movMonto" class="input" type="number" step="0.01" value="${escapeHtml(prefill.monto || "")}" />
    </div>

    <div class="field">
      <label>Concepto / nota</label>
      <input id="movConcepto" class="input" type="text" value="${escapeHtml(prefill.concepto || "")}" />
    </div>

    <div class="btn-row">
      <button id="btnGuardarMovimiento" class="btn ${buttonClass}">${buttonText}</button>
    </div>
  `;
}

function attachTabListeners() {
  document.querySelectorAll(".js-admin-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.adminTab = btn.dataset.tab;
      render();
    });
  });

  document.querySelectorAll(".js-chofer-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.choferTab = btn.dataset.tab;
      render();
    });
  });
}

function attachToolbarListeners() {
  const busquedaInput = document.getElementById("busquedaInput");
  const filtroTipo = document.getElementById("filtroTipo");

  if (busquedaInput) {
    busquedaInput.addEventListener("input", (e) => {
      state.busqueda = e.target.value;
      render();
    });
  }

  if (filtroTipo) {
    filtroTipo.addEventListener("change", (e) => {
      state.filtroTipo = e.target.value;
      render();
    });
  }
}

function attachCommonSessionButton() {
  const btnCerrarSesion = document.getElementById("btnCerrarSesion");
  if (btnCerrarSesion) {
    btnCerrarSesion.addEventListener("click", () => {
      usuarioActual = null;
      limpiarSesion();
      limpiarMensaje();
      detenerSuscripciones();
      state.adminTab = "resumen";
      state.choferTab = "inicio";
      render();
    });
  }
}

function detenerSuscripciones() {
  if (typeof unsubscribeMovimientos === "function") {
    unsubscribeMovimientos();
    unsubscribeMovimientos = null;
  }
  if (typeof unsubscribeUsuarios === "function") {
    unsubscribeUsuarios();
    unsubscribeUsuarios = null;
  }
}

function iniciarSuscripcionMovimientos() {
  if (typeof unsubscribeMovimientos === "function") unsubscribeMovimientos();

  const q = query(collection(db, "operaciones_otimac"), orderBy("fecha", "desc"));

  unsubscribeMovimientos = onSnapshot(
    q,
    async (snapshot) => {
      movimientosCache = snapshot.docs.map((d) => ({ _id: d.id, ...d.data() }));
      resumenCache = await calcularResumenDesdeLista(movimientosCache);
      render();
    },
    (error) => {
      console.error("Error en suscripción movimientos:", error);
      setMensaje(`Error al leer movimientos: ${error.message}`, "error");
    }
  );
}

function iniciarSuscripcionUsuarios() {
  if (typeof unsubscribeUsuarios === "function") unsubscribeUsuarios();

  unsubscribeUsuarios = onSnapshot(
    collection(db, "usuarios"),
    (snapshot) => {
      usuariosCache = snapshot.docs.map((d) => ({ _id: d.id, ...d.data() }));
      render();
    },
    (error) => {
      console.error("Error en suscripción usuarios:", error);
      setMensaje(`Error al leer usuarios: ${error.message}`, "error");
    }
  );
}

function openEditarMovimientoModal(mov) {
  abrirModal(
    "Editar movimiento",
    `
      ${buildMovimientoForm(mov, "btn-primary", "Guardar cambios")}
      <div id="modalMsg"></div>
    `
  );

  const btn = document.getElementById("btnGuardarMovimiento");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const tipo = document.getElementById("movTipo").value;
    const numero = document.getElementById("movNumero").value;
    const placa = document.getElementById("movPlaca").value;
    const monto = document.getElementById("movMonto").value;
    const concepto = document.getElementById("movConcepto").value;

    const r = await actualizarMovimiento(mov._id, tipo, numero, placa, monto, concepto);

    const modalMsg = document.getElementById("modalMsg");
    if (!r.ok) {
      if (modalMsg) {
        modalMsg.innerHTML = `<div class="message error">${escapeHtml(r.mensaje)}</div>`;
      }
      return;
    }

    cerrarModal();
    setMensaje(r.mensaje, "success");
  });
}

function attachAdminMovementActions() {
  document.querySelectorAll(".js-editar").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const mov = movimientosCache.find((x) => x._id === id);
      if (mov) openEditarMovimientoModal(mov);
    });
  });

  document.querySelectorAll(".js-borrar").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const ok = confirm("¿Seguro que deseas borrar este movimiento?");
      if (!ok) return;

      const r = await borrarMovimiento(id);
      if (!r.ok) {
        setMensaje(r.mensaje, "error");
        return;
      }

      setMensaje(r.mensaje, "success");
    });
  });
}

function renderLogin() {
  appRoot.innerHTML = `
    <div class="login-wrap">
      <div class="card login-card">
        <div class="login-logo">💼</div>
        <div class="center">
          <h1 style="margin:0 0 8px 0;">Caja General OTIMAC</h1>
          <p class="small" style="margin:0 0 18px 0;">
            Choferes: nombre + número económico<br>
            Administradores: nombre + contraseña propia
          </p>
        </div>

        ${mensajeHtml()}

        <div class="field">
          <label>Nombre</label>
          <input id="loginNombre" class="input" type="text" />
        </div>

        <div class="field">
          <label>Contraseña</label>
          <input id="loginPassword" class="input" type="password" />
        </div>

        <div class="btn-row">
          <button id="btnLogin" class="btn btn-accent" style="width:100%;">Entrar</button>
        </div>

        <hr class="sep">

        <p class="small center" style="margin:0;">
          Admins sugeridos:<br>
          <span class="code">Presidente / presi123</span><br>
          <span class="code">Secretario / secre123</span><br>
          <span class="code">Vigilancia / vigila123</span>
        </p>
      </div>
    </div>
  `;

  const btnLogin = document.getElementById("btnLogin");
  if (!btnLogin) return;

  btnLogin.addEventListener("click", async () => {
    const nombre = document.getElementById("loginNombre").value;
    const password = document.getElementById("loginPassword").value;

    try {
      const r = await validarLogin(nombre, password);

      if (!r.ok) {
        setMensaje(r.mensaje, "error");
        return;
      }

      usuarioActual = r.usuario;
      guardarSesion(usuarioActual);
      limpiarMensaje();

      iniciarSuscripcionMovimientos();
      iniciarSuscripcionUsuarios();

      render();
    } catch (e) {
      console.error("Error de login:", e);
      setMensaje(`Error de inicio de sesión: ${e.message}`, "error");
    }
  });
}

function renderChofer() {
  const resumen = resumenCache || {
    ingresos_hoy: 0,
    egresos_hoy: 0,
    saldo_total: 0
  };

  let contenido = "";

  if (state.choferTab === "inicio") {
    contenido = `
      <div class="grid grid-2">
        <div class="card">
          <h2 class="section-title">Registro rápido</h2>
          ${buildMovimientoForm(
            { numero_economico: usuarioActual?.numero_economico || "" },
            "btn-accent",
            "Guardar movimiento"
          )}
        </div>

        <div class="grid stats">
          ${statCard("Ingresos hoy", resumen.ingresos_hoy, "green")}
          ${statCard("Egresos hoy", resumen.egresos_hoy, "red")}
          ${statCard("Saldo total", resumen.saldo_total, "blue")}
        </div>
      </div>
    `;
  }

  if (state.choferTab === "movimientos") {
    contenido = `
      <div class="topbar">
        <h2 class="section-title" style="margin:0;">Movimientos recientes</h2>
      </div>
      ${buildToolbar()}
      ${renderMovimientosList(false)}
    `;
  }

  appRoot.innerHTML = `
    ${buildHeaderChofer(resumen)}

    <div class="container">
      ${mensajeHtml()}
      ${buildChoferTabs()}
      ${contenido}
    </div>
  `;

  attachTabListeners();
  attachCommonSessionButton();
  attachToolbarListeners();

  const btnGuardar = document.getElementById("btnGuardarMovimiento");
  if (btnGuardar) {
    btnGuardar.addEventListener("click", async () => {
      const tipo = document.getElementById("movTipo").value;
      const numero = document.getElementById("movNumero").value;
      const placa = document.getElementById("movPlaca").value;
      const monto = document.getElementById("movMonto").value;
      const concepto = document.getElementById("movConcepto").value;

      const r = await guardarOperacion(tipo, numero, placa, monto, concepto, usuarioActual);

      if (!r.ok) {
        setMensaje(r.mensaje, "error");
        return;
      }

      setMensaje(r.mensaje, "success");
    });
  }
}

function renderAdmin() {
  const resumen = resumenCache || {
    ingresos_hoy: 0,
    egresos_hoy: 0,
    ingresos_semana: 0,
    egresos_semana: 0,
    ingresos_mes: 0,
    egresos_mes: 0,
    saldo_total: 0
  };

  let contenido = "";

  if (state.adminTab === "resumen") {
    contenido = `
      <div class="grid grid-3 stats">
        ${statCard("Ingresos hoy", resumen.ingresos_hoy, "green")}
        ${statCard("Egresos hoy", resumen.egresos_hoy, "red")}
        ${statCard("Saldo total", resumen.saldo_total, "blue")}
        ${statCard("Ingresos semana", resumen.ingresos_semana, "green")}
        ${statCard("Egresos semana", resumen.egresos_semana, "red")}
        ${statCard("Ingresos mes", resumen.ingresos_mes, "slate")}
      </div>

      <div class="grid grid-3" style="margin-top:16px;">
        <div class="card">
          <h2 class="section-title">Registrar movimiento</h2>
          ${buildMovimientoForm({}, "btn-accent", "Guardar movimiento")}
        </div>

        <div class="card">
          <h2 class="section-title">Crear chofer</h2>

          <div class="field">
            <label>Nombre del chofer</label>
            <input id="choferNombre" class="input" type="text" />
          </div>

          <div class="field">
            <label>Número económico / contraseña</label>
            <input id="choferNumero" class="input" type="text" />
          </div>

          <div class="btn-row">
            <button id="btnCrearChofer" class="btn btn-success">Crear chofer</button>
          </div>
        </div>

        <div class="card">
          <h2 class="section-title">Crear administrador</h2>

          <div class="field">
            <label>Nombre del nuevo administrador</label>
            <input id="adminNombre" class="input" type="text" />
          </div>

          <div class="field">
            <label>Contraseña del nuevo administrador</label>
            <input id="adminPass" class="input" type="password" />
          </div>

          <div class="btn-row">
            <button id="btnCrearAdmin" class="btn btn-primary">Crear administrador</button>
          </div>
        </div>
      </div>
    `;
  }

  if (state.adminTab === "movimientos") {
    contenido = `
      <div class="topbar">
        <h2 class="section-title" style="margin:0;">Movimientos recientes</h2>
        <div class="badge">Tiempo real</div>
      </div>
      ${buildToolbar()}
      ${renderMovimientosList(true)}
    `;
  }

  if (state.adminTab === "usuarios") {
    contenido = `
      <div class="topbar">
        <h2 class="section-title" style="margin:0;">Usuarios creados</h2>
        <div class="badge">${usuariosCache.length} usuarios</div>
      </div>
      ${renderUsuariosList()}
    `;
  }

  appRoot.innerHTML = `
    ${buildHeaderAdmin(resumen)}

    <div class="container">
      ${mensajeHtml()}
      ${buildAdminTabs()}
      ${contenido}
    </div>
  `;

  attachTabListeners();
  attachCommonSessionButton();
  attachToolbarListeners();
  attachAdminMovementActions();

  const btnGuardar = document.getElementById("btnGuardarMovimiento");
  if (btnGuardar) {
    btnGuardar.addEventListener("click", async () => {
      const tipo = document.getElementById("movTipo").value;
      const numero = document.getElementById("movNumero").value;
      const placa = document.getElementById("movPlaca").value;
      const monto = document.getElementById("movMonto").value;
      const concepto = document.getElementById("movConcepto").value;

      const r = await guardarOperacion(tipo, numero, placa, monto, concepto, usuarioActual);

      if (!r.ok) {
        setMensaje(r.mensaje, "error");
        return;
      }

      setMensaje(r.mensaje, "success");
    });
  }

  const btnCrearChofer = document.getElementById("btnCrearChofer");
  if (btnCrearChofer) {
    btnCrearChofer.addEventListener("click", async () => {
      const nombre = document.getElementById("choferNombre").value.trim();
      const numero = document.getElementById("choferNumero").value.trim();

      if (!nombre || !numero) {
        setMensaje("Debes capturar nombre y número económico del chofer.", "error");
        return;
      }

      if (!/^\d+$/.test(numero)) {
        setMensaje("El número económico debe ser numérico.", "error");
        return;
      }

      const existente = await obtenerUsuarioPorNombre(nombre);
      if (existente) {
        setMensaje("Ya existe un usuario con ese nombre.", "error");
        return;
      }

      await crearUsuarioChofer(nombre, numero);
      setMensaje("Chofer creado correctamente.", "success");
      state.adminTab = "usuarios";
    });
  }

  const btnCrearAdmin = document.getElementById("btnCrearAdmin");
  if (btnCrearAdmin) {
    btnCrearAdmin.addEventListener("click", async () => {
      const nombre = document.getElementById("adminNombre").value.trim();
      const password = document.getElementById("adminPass").value.trim();

      if (!nombre || !password) {
        setMensaje("Debes capturar nombre y contraseña del administrador.", "error");
        return;
      }

      const existente = await obtenerUsuarioPorNombre(nombre);
      if (existente) {
        setMensaje("Ya existe un usuario con ese nombre.", "error");
        return;
      }

      await addDoc(collection(db, "usuarios"), {
        nombre,
        nombre_key: claveNombre(nombre),
        rol: "admin",
        password,
        numero_economico: "",
        activo: true,
        creado_en: Timestamp.now()
      });

      setMensaje("Administrador creado correctamente.", "success");
      state.adminTab = "usuarios";
    });
  }
}

function render() {
  try {
    if (!usuarioActual) {
      renderLogin();
      return;
    }

    if (usuarioActual.rol === "admin") {
      renderAdmin();
    } else {
      renderChofer();
    }
  } catch (e) {
    console.error("Error en render:", e);
    appRoot.innerHTML = `
      <div class="container">
        <div class="card">
          <h2 class="section-title">Error</h2>
          <p>${escapeHtml(e.message)}</p>
        </div>
      </div>
    `;
  }
}

async function init() {
  try {
    render();

    if (usuarioActual) {
      iniciarSuscripcionMovimientos();
      iniciarSuscripcionUsuarios();
    }
  } catch (e) {
    console.error("Error al iniciar:", e);
    document.body.innerHTML = `
      <div style="padding:20px;font-family:Arial,sans-serif;">
        <h2>Error al iniciar</h2>
        <pre style="white-space:pre-wrap;background:#f3f3f3;padding:12px;border-radius:8px;">${escapeHtml(e.message)}</pre>
      </div>
    `;
  }
}

init();
