import { PrismaService } from "../shared/prisma.service";

/**
 * DOMICILIO POSTAL DEL DUENO (13-oct-2026).
 *
 * POR QUE EXISTE. Deal.mailingAddress estaba vacio en todos los deals: ninguna capa de parcelas que usamos
 * lo publica para Broward (BCPA_INFO no tiene domicilio) ni para Miami-Dade (la descarga de parcelas
 * tampoco), y Palm Beach lo trae en PADDR1 a PADDR3, que la ingesta no leia. La accion CONTACT_NOW del
 * carril DISTRESS_OWNER no tenia adonde escribir.
 *
 * FUENTES. Palm Beach: su propia capa (domicilioDeLaCapa), que es la del ano en curso y manda. Broward y
 * Miami-Dade: el catastro estatal del Departamento de Revenue publicado por FGIO (rol certificado, campos
 * OWN_ADDR1 a OWN_ZIPCD), abierto y gratis. Es el rol del ano anterior: si la propiedad se vendio despues,
 * el domicilio seria del dueno anterior. Por eso, cuando conocemos el dueno, el del rol tiene que ser el
 * mismo (mismoDueno); si no coincide, no se escribe nada.
 *
 * Nunca pisa un domicilio existente.
 */
export const CATASTRO_ESTATAL_URL =
  "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0";

/** Numero de condado del Departamento de Revenue para cada fuente de parcelas. */
export const CONDADO_DOR: Record<string, number> = {
  "broward-parcels": 16,
  "miami-dade-parcels": 23,
  "palm-beach-parcels": 60,
};

function limpio(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).replace(/\s+/g, " ").trim();
}

function folioNormalizado(folio: unknown): string {
  return limpio(folio).toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Palm Beach: PADDR1 a PADDR3 son el domicilio postal del dueno. Sin PADDR1 no hay domicilio. */
export function domicilioDeLaCapa(attrs: Record<string, unknown>): string | undefined {
  const linea1 = limpio(attrs.PADDR1);
  if (!linea1) return undefined;
  return [linea1, limpio(attrs.PADDR2), limpio(attrs.PADDR3)].filter(Boolean).join(", ");
}

const ESTADOS: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA", COLORADO: "CO", CONNECTICUT: "CT",
  DELAWARE: "DE", "DISTRICT OF COLUMBIA": "DC", FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL",
  INDIANA: "IN", IOWA: "IA", KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD",
  MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT",
  NEBRASKA: "NE", NEVADA: "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY",
  "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA",
  "PUERTO RICO": "PR", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX",
  UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV", WISCONSIN: "WI", WYOMING: "WY",
};

/** El rol trae el estado a veces como codigo (OWN_STATE_), a veces con el nombre entero ("FLORIDA"). */
function estadoDelRol(a: Record<string, unknown>): string {
  const codigo = limpio(a.OWN_STATE_).toUpperCase();
  if (/^[A-Z]{2}$/.test(codigo)) return codigo;
  const texto = limpio(a.OWN_STATE);
  return ESTADOS[texto.toUpperCase()] ?? texto;
}

/** El zip del rol es un numero: 0 es "sin zip" y los ceros a la izquierda se pierden (02108 llega 2108). */
function zipDelRol(v: unknown): string {
  const n = Number(limpio(v).replace(/[^0-9]/g, "") || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n <= 99999 ? String(n).padStart(5, "0") : String(n).padStart(9, "0").slice(0, 5);
}

/** "1 MAIN ST, STE 2, FORT LAUDERDALE, FL 33301". Sin calle o sin ciudad no hay domicilio. */
export function formatearDomicilioEstatal(a: Record<string, unknown>): string | undefined {
  const linea1 = limpio(a.OWN_ADDR1);
  const ciudad = limpio(a.OWN_CITY);
  if (!linea1 || !ciudad) return undefined;
  const estadoZip = [estadoDelRol(a), zipDelRol(a.OWN_ZIPCD)].filter(Boolean).join(" ");
  return [linea1, limpio(a.OWN_ADDR2), ciudad, estadoZip].filter(Boolean).join(", ");
}

function nucleo(nombre: string): string {
  return (nombre || "").toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]/g, "");
}

/**
 * El dueno del rol estatal es el nuestro: las dos fuentes salen del mismo Property Appraiser y escriben el
 * nombre igual, asi que alcanza con las primeras 12 letras. Sin nombre nuestro no hay contra que comparar.
 */
export function mismoDueno(nuestro: string | null | undefined, delRol: string | null | undefined): boolean {
  const a = nucleo(nuestro ?? "");
  if (!a) return true;
  const b = nucleo(delRol ?? "");
  if (!b) return false;
  if (a === b) return true;
  const n = Math.min(12, a.length, b.length);
  return n >= 6 && a.slice(0, n) === b.slice(0, n);
}

export type FilaEstatal = { nombre: string; domicilio: string };

/** Domicilio postal y dueno del rol estatal por folio. Un lote que falla deja esos folios sin domicilio. */
export async function domiciliosEstatales(
  condado: number,
  folios: string[],
  url = CATASTRO_ESTATAL_URL,
): Promise<Map<string, FilaEstatal>> {
  const salida = new Map<string, FilaEstatal>();
  const ids = [...new Set(folios.map(folioNormalizado).filter((f) => f.length >= 8))];
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    const where = encodeURIComponent(`CO_NO = ${condado} AND PARCEL_ID IN (${lote.map((f) => `'${f}'`).join(",")})`);
    try {
      const respuesta = await fetch(
        `${url}/query?where=${where}&outFields=PARCEL_ID,OWN_NAME,OWN_ADDR1,OWN_ADDR2,OWN_CITY,OWN_STATE,OWN_ZIPCD&returnGeometry=false&f=json`,
      );
      if (!respuesta.ok) continue;
      const cuerpo = (await respuesta.json()) as { error?: unknown; features?: Array<{ attributes?: Record<string, unknown> }> };
      if (cuerpo.error || !Array.isArray(cuerpo.features)) continue;
      for (const feature of cuerpo.features) {
        const a = feature.attributes ?? {};
        const id = folioNormalizado(a.PARCEL_ID);
        const domicilio = formatearDomicilioEstatal(a);
        if (id && domicilio && !salida.has(id)) salida.set(id, { nombre: limpio(a.OWN_NAME), domicilio });
      }
    } catch {
      // sigue con el resto; la proxima corrida reintenta
    }
  }
  return salida;
}

export type ResultadoDomicilios = { revisados: number; escritos: number; duenoDistinto: number };

/**
 * Completa el domicilio postal de los deals de una fuente de parcelas que no lo tienen, desde el rol
 * estatal y solo si el dueno coincide con el nuestro. No pisa ningun domicilio. Corre despues de cada
 * ingesta de parcelas; tope por corrida para no barrer la base entera de una vez.
 */
export async function completarDomiciliosPostales(
  prisma: PrismaService,
  source: string,
  tope = 500,
  url = CATASTRO_ESTATAL_URL,
): Promise<ResultadoDomicilios> {
  const resultado: ResultadoDomicilios = { revisados: 0, escritos: 0, duenoDistinto: 0 };
  const condado = CONDADO_DOR[source];
  if (!condado) return resultado;
  const vacio = [{ mailingAddress: null }, { mailingAddress: "" }];
  const deals = await prisma.deal.findMany({
    where: { source, parcelId: { not: null }, OR: vacio },
    select: { id: true, parcelId: true, owners: { select: { owner: { select: { name: true } } } } },
    orderBy: { updatedAt: "desc" },
    take: tope,
  });
  resultado.revisados = deals.length;
  if (!deals.length) return resultado;
  const filas = await domiciliosEstatales(condado, deals.map((d) => String(d.parcelId)), url);
  for (const d of deals) {
    const fila = filas.get(folioNormalizado(d.parcelId));
    if (!fila) continue;
    const nombres = d.owners.map((o) => o.owner?.name ?? "").filter(Boolean);
    if (nombres.length && !nombres.some((n) => mismoDueno(n, fila.nombre))) {
      resultado.duenoDistinto += 1;
      continue;
    }
    const r = await prisma.deal.updateMany({ where: { id: d.id, OR: vacio }, data: { mailingAddress: fila.domicilio } });
    resultado.escritos += r.count;
  }
  return resultado;
}

/**
 * DUENO DEL ROL ESTATAL (15-oct-2026). La capa de parcelas de Miami-Dade (MD_Emaps/72) no trae el dueno: de los
 * deals que trajo el sync por corredores, ninguno tenia. El rol estatal si lo tiene (OWN_NAME). Es el del ano
 * anterior: si la propiedad se vendio despues, es el dueno anterior. Por eso solo se escribe en deals sin ningun
 * dueno, y el vinculo queda marcado con role ROL_ESTATAL. Con dueno, el triage reconoce gobierno, consorcio y
 * utility, igual que en Broward y Palm Beach, que lo traen en su capa.
 */
export const FUENTES_SIN_DUENO = new Set(["miami-dade-parcels"]);
export const ROL_ESTATAL = "ROL_ESTATAL";

/** Dueno del rol estatal por folio, aunque no tenga domicilio. Un lote que falla deja esos folios sin dueno. */
export async function duenosEstatales(condado: number, folios: string[], url = CATASTRO_ESTATAL_URL): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  const ids = [...new Set(folios.map(folioNormalizado).filter((f) => f.length >= 8))];
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    const where = encodeURIComponent(`CO_NO = ${condado} AND PARCEL_ID IN (${lote.map((f) => `'${f}'`).join(",")})`);
    try {
      const respuesta = await fetch(`${url}/query?where=${where}&outFields=PARCEL_ID,OWN_NAME&returnGeometry=false&f=json`);
      if (!respuesta.ok) continue;
      const cuerpo = (await respuesta.json()) as { error?: unknown; features?: Array<{ attributes?: Record<string, unknown> }> };
      if (cuerpo.error || !Array.isArray(cuerpo.features)) continue;
      for (const feature of cuerpo.features) {
        const a = feature.attributes ?? {};
        const id = folioNormalizado(a.PARCEL_ID);
        const nombre = limpio(a.OWN_NAME);
        if (id && nombre && !salida.has(id)) salida.set(id, nombre);
      }
    } catch {
      // sigue con el resto; la proxima corrida reintenta
    }
  }
  return salida;
}

export type ResultadoDuenos = { revisados: number; vinculados: number; sinFila: number };

/** Vincula el dueno del rol estatal a los deals sin dueno de una fuente que no lo publica. Tope por corrida. */
export async function completarDuenosEstatales(
  prisma: PrismaService,
  source: string,
  tope = 500,
  url = CATASTRO_ESTATAL_URL,
): Promise<ResultadoDuenos> {
  const resultado: ResultadoDuenos = { revisados: 0, vinculados: 0, sinFila: 0 };
  const condado = CONDADO_DOR[source];
  if (!condado || !FUENTES_SIN_DUENO.has(source)) return resultado;
  const deals = await prisma.deal.findMany({
    where: { source, parcelId: { not: null }, owners: { none: {} } },
    select: { id: true, parcelId: true },
    orderBy: { updatedAt: "desc" },
    take: tope,
  });
  resultado.revisados = deals.length;
  if (!deals.length) return resultado;
  const filas = await duenosEstatales(condado, deals.map((d) => String(d.parcelId)), url);
  for (const d of deals) {
    const nombre = filas.get(folioNormalizado(d.parcelId));
    if (!nombre) {
      resultado.sinFila += 1;
      continue;
    }
    let owner = await prisma.owner.findFirst({ where: { name: nombre } });
    if (!owner) owner = await prisma.owner.create({ data: { name: nombre } });
    await prisma.dealOwner.upsert({
      where: { dealId_ownerId: { dealId: d.id, ownerId: owner.id } },
      update: {},
      create: { dealId: d.id, ownerId: owner.id, role: ROL_ESTATAL },
    });
    resultado.vinculados += 1;
  }
  return resultado;
}
