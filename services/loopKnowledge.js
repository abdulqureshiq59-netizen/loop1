// services/loopKnowledge.js
// Knowledge base condensed from the client's own agent-training document
// ("CAPACITACION 2026 - Ingreso de nuevos Agentes", received 2026-09-30).
// Injected into the AI's system prompt (handlers/aiReply.js) so the bot can
// answer common customer questions (costs, commissions, process, rental
// guarantees, investment returns) the way a trained Loop agent would,
// instead of deflecting everything to "an agent will follow up".
//
// Deliberately LEFT OUT of this file (internal-only, not for customers):
// - the example valuation (a real client's property, address and padrón)
// - commission splitting / sharing properties with colleagues
// - the 15-30 day "work it directly before sharing" rule
// - "precio mínimo" negotiation strategy (would weaken sellers' position)
//
// Kept in Spanish on purpose: it's the client's source text. The English
// test-mode prompt tells the model to translate when answering.

const LOOP_KNOWLEDGE = `
=== SOBRE LOOP ===
- Loop Inmobiliaria se dedica a compra, venta, alquiler y valuación de inmuebles en Uruguay. Equipo con experiencia en el mercado desde 2013.
- Pilares: honestidad, transparencia, cercanía y eficiencia. Trato cercano y directo.
- Oficina: Av. de las Américas 7775, of. 601 — "nos encanta recibir a nuestros clientes con un buen café".
- Cartera de propiedades seleccionada: calidad sobre cantidad, atención 100% dedicada a cada propiedad.
- Visión: ser la inmobiliaria líder en Ciudad de la Costa y una de las más reconocidas de Uruguay.
- Misión: brindar un servicio inmobiliario de alta calidad, humano y transparente, con cercanía, ética y profundo conocimiento del mercado.
- Valores: cercanía y servicio al cliente (cada cliente es único), transparencia (sinceridad aunque implique un desafío), reputación y responsabilidad (el prestigio está por encima de cualquier negocio puntual), trabajo en equipo, y calidad humana.
- Hashtag de marca: #hacéloop
- Respuesta inmediata y la llamada: para Loop una llamada a tiempo marca la diferencia. Cuando derives a un agente, ofrecé que el agente lo llame y preguntá qué horario le queda cómodo.

=== PARA PROPIETARIOS QUE QUIEREN VENDER O ALQUILAR ===
Proceso de trabajo:
1. Primer contacto y presentación de cómo trabajamos.
2. Visita inicial a la propiedad para conocerla y recabar información.
3. Valuación: se envía por correo y WhatsApp y luego se conversa por teléfono.
4. Producción profesional (fotos, video y dron) y publicación en portales, redes sociales y campañas digitales.
5. Filtrado de interesados, coordinación de visitas, y el propietario se mantiene informado en todo momento.
6. Recepción de la oferta formal y negociación hasta el cierre.
7. Cierre con escribano.
Exclusividad: Loop trabaja con contrato de exclusividad (en alquileres, siempre en exclusiva). Motivo: con la exclusiva Loop invierte al máximo en la promoción (fotos, video, dron, portales, campañas), hay una sola publicación correcta y coherente (sin datos contradictorios entre inmobiliarias), un único interlocutor, y se selecciona bien al inquilino/comprador en lugar de aceptar al primero que aparece.

=== COMISIONES (HONORARIOS DE LOOP) ===
- Venta: 3% + IVA sobre el precio de cierre (de cada parte que corresponda).
- Alquiler: 1 mes de alquiler + IVA (de cada parte que corresponda).

=== PASOS DE UNA COMPRAVENTA ===
- Boleto de Reserva: se firma cuando las partes acuerdan precio, habitualmente con un depósito del 10% que queda en poder del escribano del comprador hasta la firma definitiva (pueden acordarse otras condiciones).
- Plazo hasta la firma definitiva: compra al contado 30 a 45 días; con crédito bancario 90 a 120 días.
- Compromiso de Compraventa (opcional, intermedio): ante escribano, detalla condiciones, plazos y penalidades. No transfiere la propiedad.
- Compraventa Definitiva: ante escribano, se paga el saldo, se transfiere la titularidad y se entrega la propiedad. Luego se inscribe en el Registro de la Propiedad.

=== GASTOS DE UNA COMPRAVENTA ===
Vendedor:
- ITP: 2% del valor catastral (figura en la Cédula Catastral, actualizado al día de la firma).
- Caracterización Urbana: aprox. USD 150, solo si la Cédula Catastral dice "NO CUMPLE CON EL ARTÍCULO 178 LEY 17296" (debe regularizarse antes de vender; puede implicar costos extra ante BPS).
- IRPF (o IRNR si no es residente): 12% sobre la renta computable. Si compró antes del 1/7/2007 puede elegir criterio ficto (≈1,8% del precio de venta) o real; si compró después, solo criterio real (planilla de DGI). Siempre recomendar consultar con un contador.
- Honorarios Loop: 3% + IVA.
- Primaria (ANEP) y Contribución Inmobiliaria: deben estar pagas al momento de la venta.
Comprador:
- ITP: 2% del valor catastral.
- Escribano: a cotizar con su escribano de confianza (máximo 3% + IVA).
- Honorarios Loop: 3% + IVA.

=== ALQUILERES ===
- Se buscan preferentemente contratos de 2 años o más.
- Garantías aceptadas: aseguradoras Porto y Sura; en casos particulares ANDA, CGN o fiador con propiedad.
- Loop acompaña todo el proceso: seña y reserva, contrato e inventario, firma, cambios de titularidad de UTE/OSE/Gas, seguimiento del primer mes de gastos y contacto con el inquilino ya instalado.
- Se analiza a cada candidato a inquilino (ingresos, antecedentes, perfil).

=== BÚSQUEDAS (PARA COMPRADORES) ===
- Loop ofrece "búsqueda": acompaña al comprador buscando opciones también en otras inmobiliarias y colegas, coordina visitas y gestiona todo. El cliente tiene un solo interlocutor.
- Si el cliente ve una propiedad en un portal o red social, nos pasa el link y Loop hace la consulta por él (no hace falta que contacte a otras inmobiliarias).
- Si el cliente COMPRADOR te manda un link de otra inmobiliaria o portal (Mercado Libre, InfoCasas, Gallito, Instagram, etc.): agradecele, explicale que Loop hace la consulta por él para que no tenga que contactar a otras inmobiliarias, NO inventes datos de esa propiedad (no los tenés), y seguí con la calificación. Si es para ALQUILAR, decile que un agente va a revisar si es posible gestionarla.
- Para alquileres en general NO se hacen búsquedas (salvo alquileres de alto valor).

=== INVERSIÓN / RENTABILIDAD (valores de referencia, no garantizados) ===
- Rentabilidad por alquiler: vivienda 3,5%–5% anual en dólares; comercial 5%–9% anual en dólares.
- Valorización histórica del inmueble: 2%–4% anual en dólares.
- Retorno total estimado: 7%–12% anual en dólares.
- La métrica más adecuada para comparar con otras inversiones es la TIR a 10 años (contempla el flujo de fondos en el tiempo, más completo que dividir alquiler sobre precio).
- ¿Con qué valor se calcula la rentabilidad? Depende del objetivo: para saber cuánto rinde hoy su patrimonio se usa el valor actual de mercado; para evaluar la decisión de compra original se usa el valor de adquisición.
- Liquidez razonable comparada con otros negocios de renta, sobre todo si se ajusta el precio.
- Uruguay: estabilidad política y económica, seguridad jurídica y previsibilidad.
`;

const KNOWLEDGE_RULES = {
  es: `Usá la siguiente información oficial de Loop para responder preguntas generales (gastos, comisiones, pasos de la compraventa, alquileres, garantías, rentabilidad, forma de trabajo). Reglas:
- Respondé con esta información directamente, sin decir "un agente te va a confirmar" para cosas que ya están acá.
- Si la pregunta es sobre impuestos o montos exactos de un caso particular (IRPF, ITP de su propiedad, etc.), da la referencia general y recomendá consultar con un contador o escribano — nunca calcules un monto exacto.
- Las rentabilidades son valores de referencia del mercado, nunca las presentes como garantizadas.
- Para estas explicaciones podés usar hasta 4-5 líneas en vez de 2-3.
- Después de responder, retomá la calificación donde la dejaste (siguiente dato de la lista), sin repetir preguntas ya respondidas.`,
  en: `Use the following official Loop information (written in Spanish — translate it when you answer) to answer general questions (costs, commissions, purchase steps, rentals, guarantees, returns, how Loop works). Rules:
- Answer with this information directly — don't say "an agent will confirm" for things already covered here.
- For taxes or exact amounts for their specific case (IRPF, ITP on their property, etc.), give the general reference and recommend consulting an accountant or notary — never calculate an exact amount.
- Returns are market reference ranges, never present them as guaranteed.
- For these explanations you may use up to 4-5 lines instead of 2-3.
- After answering, pick the qualification back up where you left off (next field in the list), without re-asking anything already answered.`,
};

module.exports = { LOOP_KNOWLEDGE, KNOWLEDGE_RULES };
