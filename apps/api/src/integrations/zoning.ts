/**
 * CAMPOS DE ZONIFICACION (23-oct-2026).
 *
 * Que estaba mal: la lista de zoning terminaba en CVTTXDSCRP, CLASSDSCRP y DOR_DESC, que son el
 * municipio y la descripcion del uso del suelo, no la zonificacion. Medido el 23-oct: los 241
 * deals de Miami-Dade con zoning tenian el uso del suelo ("RESIDENTIAL - SINGLE FAMILY : 1 UNIT"),
 * y ningun condado traia zonificacion real. Ninguna capa de parcelas trae zoning: sale de la capa
 * de zonificacion del condado por ubicacion. Sin dato, null.
 */
export const CAMPOS_ZONING = ["ZONING", "ZONING_DESC", "ZONINGCODE", "ZONING_CODE"];
