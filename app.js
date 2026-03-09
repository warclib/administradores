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
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/*
  REEMPLAZA ESTO CON TU CONFIG REAL DE FIREBASE WEB
  La encuentras en:
  Firebase Console > Configuración del proyecto > Tus apps > Web app
*/
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROJECT_ID",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const appRoot = document.getElementById("app");

let usuarioActual = null;
let mensajeActual = { texto: "", tipo: "" };

function claveNombre(nombre) {
  return (nombre || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function dinero(valor) {
  const num = Number(valor || 0);
  return `$${num.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ahoraLocal() {
  return new Date();
}

function normalizarFecha(fecha) {
  if (!fecha) return null;
  if (fecha instanceof Timestamp) return fecha.toDate();
  if (fecha.seconds) return new Date(fecha.seconds * 1000);
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

function setMensaje(texto, tipo = "error") {
  mensajeActual = { texto, tipo };
  render();
}

function limpiarMensaje() {
  mensajeActual = { texto: "", tipo: "" };
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

async function crearAdministradoresIniciales() {
  const admins = [
    { nombre: "Presidente", password: "presi123" },
    { nombre: "Secretario", password: "secre123" },
    { nombre: "Vigilancia", password: "vigila123" }
  ];

  for (const admin of admins) {
    const existente = await obtenerUsuarioPorNombre(admin.nombre);
    if (!existente) {
      await addDoc(collection(db, "usuarios"), {
        nombre: admin.nombre,
        nombre_key: claveNombre(admin.nombre),
        rol: "admin",
        password: admin.password,
        numero_economico: "",
        activo: true,
        creado_en: Timestamp.now()
      });
    }
  }
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

async function obtenerMovimientos(maximo = 50) {
  const q = query(
    collection(db, "operaciones_otimac"),
    orderBy("fecha", "desc"),
    limit(maximo)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ _id: d.id, ...d.data() }));
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

async function calcularResumen() {
  const resumen = {
    ingresos_hoy: 0,
    egresos_hoy: 0,
    ingresos_semana: 0,
    egresos_semana: 0,
    ingresos_mes: 0,
    egresos_mes: 0,
    saldo_total: 0
  };

  const snapshot = await getDocs(collection(db, "operaciones_otimac"));
  const ahora = ahoraLocal();
  const desdeHoy = inicioDelDia(ahora);
  const desdeSemana = inicioDeSemana(ahora);
  const desdeMes = inicioDeMes(ahora);

  for (const d of snapshot.docs) {
    const m = d.data();
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

function mensajeHtml() {
  if (!mensajeActual.texto) return "";
  return `<div class="message ${mensajeActual.tipo}">${mensajeActual.texto}</div>`;
}

function escapeHtml(texto) {
  return String(texto ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function renderLogin() {
  appRoot.innerHTML = `
    <div class="container">
      <div class="login-box card center">
        <h1>Caja General OTIMAC</h1>
        <p class="small">
          Choferes: nombre + número económico<br>
          Administradores: nombre + contraseña propia
        </p>
        ${mensajeHtml()}
        <div class="field">
          <label>Nombre</label>
          <input id="loginNombre" type="text" />
        </div>
        <div class="field">
          <label>Contraseña</label>
          <input id="loginPassword" type="password" />
        </div>
        <button id="btnLogin" class="btn-yellow">Entrar</button>
        <hr>
        <p class="small">
          Admins iniciales:<br>
          Presidente / presi123<br>
          Secretario / secre123<br>
          Vigilancia / vigila123
        </p>
      </div>
    </div>
  `;

  document.getElementById("btnLogin").addEventListener("click", async () => {
    const nombre = document.getElementById("loginNombre").value;
    const password = document.getElementById("loginPassword").value;

    try {
      const r = await validarLogin(nombre, password);
      if (!r.ok) {
        setMensaje(r.mensaje, "error");
        return;
      }

      usuarioActual = r.usuario;
      limpiarMensaje();
      render();
    } catch (e) {
      setMensaje(`Error de inicio de sesión: ${e.message}`, "error");
    }
  });
}

function tarjetaStat(titulo, valor, clase) {
  return `
    <div class="stat ${clase}">
      <h3>${escapeHtml(titulo)}</h3>
      <div class="value">${dinero(valor)}</div>
    </div>
  `;
}

function formularioMovimiento(prefill = {}) {
  return `
    <div class="card">
      <h2>Registrar movimiento</h2>

      <div class="field">
        <label>Tipo de movimiento</label>
        <select id="movTipo">
          <option value="ingreso" ${prefill.tipo === "egreso" ? "" : "selected"}>Ingreso</option>
          <option value="egreso" ${prefill.tipo === "egreso" ? "selected" : ""}>Egreso</option>
        </select>
      </div>

      <div class="field">
        <label>Número económico</label>
        <input id="movNumero" type="text" value="${escapeHtml(prefill.numero_economico || "")}" />
      </div>

      <div class="field">
        <label>Placa (opcional)</label>
        <input id="movPlaca" type="text" value="${escapeHtml(prefill.placa || "")}" />
      </div>

      <div class="field">
        <label>Monto</label>
        <input id="movMonto" type="number" step="0.01" value="${escapeHtml(prefill.monto || "")}" />
      </div>

      <div class="field">
        <label>Concepto / Nota</label>
        <input id="movConcepto" type="text" value="${escapeHtml(prefill.concepto || "")}" />
      </div>

      <button id="btnGuardarMovimiento" class="btn-yellow">Guardar movimiento</button>
    </div>
  `;
}

function listaMovimientosHtml(movimientos, esAdmin = false) {
  if (!movimientos.length) {
    return `<div class="card">No hay movimientos registrados.</div>`;
  }

  return movimientos.map(m => {
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
        <div>
          <div class="movement-title">${titulo}</div>
          <div class="movement-subtitle">${subtitulo}</div>
          ${
            esAdmin
              ? `
                <div class="actions">
                  <button class="btn-blue btn-editar" data-id="${m._id}">Editar</button>
                  <button class="btn-red btn-borrar" data-id="${m._id}">Borrar</button>
                </div>
              `
              : ""
          }
        </div>
        <div class="movement-amount ${ingreso ? "ingreso" : "egreso"}">
          ${ingreso ? "+" : "-"}${dinero(monto)}
        </div>
      </div>
    `;
  }).join("");
}

async function renderChofer() {
  const resumen = await calcularResumen();
  const movimientos = await obtenerMovimientos(50);

  appRoot.innerHTML = `
    <div class="header">
      <div class="container">
        <p>OTIMAC</p>
        <h2>Chofer: ${escapeHtml(usuarioActual.nombre || "")}</h2>
        <h1>Saldo actual: ${dinero(resumen.saldo_total)}</h1>
      </div>
    </div>

    <div class="container">
      ${mensajeHtml()}

      <div class="card">
        <h2>Registro rápido</h2>

        <div class="field">
          <label>Tipo de movimiento</label>
          <select id="movTipo">
            <option value="ingreso">Ingreso</option>
            <option value="egreso">Egreso</option>
          </select>
        </div>

        <div class="field">
          <label>Número económico</label>
          <input id="movNumero" type="text" value="${escapeHtml(usuarioActual.numero_economico || "")}" />
        </div>

        <div class="field">
          <label>Placa (opcional)</label>
          <input id="movPlaca" type="text" />
        </div>

        <div class="field">
          <label>Monto</label>
          <input id="movMonto" type="number" step="0.01" />
        </div>

        <div class="field">
          <label>Concepto / Nota</label>
          <input id="movConcepto" type="text" />
        </div>

        <button id="btnGuardarMovimiento" class="btn-yellow">Guardar movimiento</button>
      </div>

      <div class="grid grid-2">
        ${tarjetaStat("Ingresos hoy", resumen.ingresos_hoy, "green")}
        ${tarjetaStat("Egresos hoy", resumen.egresos_hoy, "red")}
      </div>

      <div class="topbar" style="margin-top:16px;">
        <h2>Movimientos recientes</h2>
        <button id="btnCerrarSesion" class="btn-gray">Cerrar sesión</button>
      </div>

      ${listaMovimientosHtml(movimientos, false)}
    </div>
  `;

  document.getElementById("btnGuardarMovimiento").addEventListener("click", async () => {
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

  document.getElementById("btnCerrarSesion").addEventListener("click", () => {
    usuarioActual = null;
    limpiarMensaje();
    render();
  });
}

async function renderAdmin() {
  const resumen = await calcularResumen();
  const movimientos = await obtenerMovimientos(50);

  appRoot.innerHTML = `
    <div class="header admin">
      <div class="container">
        <p>OTIMAC - ADMINISTRACIÓN</p>
        <h2>Administrador: ${escapeHtml(usuarioActual.nombre || "")}</h2>
        <h1>${dinero(resumen.saldo_total)}</h1>
      </div>
    </div>

    <div class="container">
      ${mensajeHtml()}

      <div class="grid grid-2">
        ${tarjetaStat("Ingresos hoy", resumen.ingresos_hoy, "green")}
        ${tarjetaStat("Egresos hoy", resumen.egresos_hoy, "red")}
        ${tarjetaStat("Ingresos semana", resumen.ingresos_semana, "green2")}
        ${tarjetaStat("Egresos semana", resumen.egresos_semana, "red2")}
        ${tarjetaStat("Ingresos mes", resumen.ingresos_mes, "green3")}
        ${tarjetaStat("Egresos mes", resumen.egresos_mes, "red3")}
      </div>

      ${formularioMovimiento()}

      <div class="card">
        <h2>Crear chofer</h2>
        <div class="field">
          <label>Nombre del chofer</label>
          <input id="choferNombre" type="text" />
        </div>
        <div class="field">
          <label>Número económico / contraseña</label>
          <input id="choferNumero" type="text" />
        </div>
        <button id="btnCrearChofer" class="btn-green">Crear chofer</button>
      </div>

      <div class="card">
        <h2>Crear administrador</h2>
        <div class="field">
          <label>Nombre del nuevo administrador</label>
          <input id="adminNombre" type="text" />
        </div>
        <div class="field">
          <label>Contraseña del nuevo administrador</label>
          <input id="adminPass" type="password" />
        </div>
        <button id="btnCrearAdmin" class="btn-blue">Crear administrador</button>
      </div>

      <div class="topbar">
        <h2>Movimientos recientes (editar / borrar)</h2>
        <button id="btnCerrarSesion" class="btn-gray">Cerrar sesión</button>
      </div>

      <div id="listaMovimientos">
        ${listaMovimientosHtml(movimientos, true)}
      </div>
    </div>
  `;

  document.getElementById("btnGuardarMovimiento").addEventListener("click", async () => {
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

  document.getElementById("btnCrearChofer").addEventListener("click", async () => {
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
  });

  document.getElementById("btnCrearAdmin").addEventListener("click", async () => {
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
  });

  document.getElementById("btnCerrarSesion").addEventListener("click", () => {
    usuarioActual = null;
    limpiarMensaje();
    render();
  });

  document.querySelectorAll(".btn-borrar").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.dataset.id;
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

  document.querySelectorAll(".btn-editar").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.dataset.id;
      const mov = movimientos.find(x => x._id === id);
      if (!mov) return;

      const nuevoTipo = prompt("Tipo (ingreso / egreso):", mov.tipo || "ingreso");
      if (!nuevoTipo) return;

      const nuevoNumero = prompt("Número económico:", mov.numero_economico || "");
      if (nuevoNumero === null) return;

      const nuevaPlaca = prompt("Placa:", mov.placa || "");
      if (nuevaPlaca === null) return;

      const nuevoMonto = prompt("Monto:", mov.monto || "");
      if (nuevoMonto === null) return;

      const nuevoConcepto = prompt("Concepto:", mov.concepto || "");
      if (nuevoConcepto === null) return;

      const r = await actualizarMovimiento(
        id,
        nuevoTipo.trim(),
        nuevoNumero,
        nuevaPlaca,
        nuevoMonto,
        nuevoConcepto
      );

      if (!r.ok) {
        setMensaje(r.mensaje, "error");
        return;
      }

      setMensaje(r.mensaje, "success");
    });
  });
}

async function render() {
  try {
    if (!usuarioActual) {
      await renderLogin();
      return;
    }

    if (usuarioActual.rol === "admin") {
      await renderAdmin();
    } else {
      await renderChofer();
    }
  } catch (e) {
    appRoot.innerHTML = `
      <div class="container">
        <div class="card">
          <h2>Error</h2>
          <p>${escapeHtml(e.message)}</p>
        </div>
      </div>
    `;
  }
}

async function init() {
  try {
    await crearAdministradoresIniciales();
    await render();
  } catch (e) {
    appRoot.innerHTML = `
      <div class="container">
        <div class="card">
          <h2>Error al iniciar</h2>
          <p>${escapeHtml(e.message)}</p>
          <p class="small">
            Revisa la configuración de Firebase en <code>app.js</code>.
          </p>
        </div>
      </div>
    `;
  }
}

init();