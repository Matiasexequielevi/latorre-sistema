const express = require("express");
const PDFDocument = require("pdfkit");

const db = require("../database/db");

const {
  requiereLogin,
  requiereSucursal,
} = require("../middleware/auth");

const {
  EMPRESA,
  direccionPorUbicacion,
} = require("../lib/empresa");

const router = express.Router();

// =========================================================
// FORMATEAR DINERO
// =========================================================

function money(valor) {
  return Number(valor || 0).toLocaleString(
    "es-AR",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  );
}

// =========================================================
// FORMATEAR FECHA
// =========================================================

function fechaArgentina(fecha) {
  if (!fecha) {
    return "-";
  }

  return new Date(fecha).toLocaleString(
    "es-AR",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}

// =========================================================
// DATOS DE VENTA
// =========================================================

async function ventaData(
  id,
  usuario
) {
  const params = [id];

  let filtroUbicacion = "";

  if (
    usuario.rol === "empleado"
  ) {
    params.push(
      Number(
        usuario.ubicacion_id
      )
    );

    filtroUbicacion =
      `AND v.ubicacion_id = $${params.length}`;
  }

  const ventaResultado =
    await db.pool.query(
      `
        SELECT
          v.*,

          ub.nombre AS ubicacion,

          us.nombre AS vendedor,

          fp.nombre AS forma_pago,

          t.nombre AS tarjeta

        FROM ventas v

        INNER JOIN ubicaciones ub
          ON ub.id = v.ubicacion_id

        INNER JOIN usuarios us
          ON us.id = v.usuario_id

        LEFT JOIN formas_pago fp
          ON fp.id = v.forma_pago_id

        LEFT JOIN tarjetas t
          ON t.id = v.tarjeta_id

        WHERE
          v.id = $1
          ${filtroUbicacion}

        LIMIT 1;
      `,
      params
    );

  if (
    ventaResultado.rows.length ===
    0
  ) {
    return null;
  }

  const itemsResultado =
    await db.pool.query(
      `
        SELECT
          vi.*,

          p.codigo_interno,
          p.codigo_barras

        FROM venta_items vi

        LEFT JOIN productos p
          ON p.id = vi.producto_id

        WHERE
          vi.venta_id = $1

        ORDER BY vi.id;
      `,
      [id]
    );

  return {
    venta:
      ventaResultado.rows[0],

    items:
      itemsResultado.rows,
  };
}

// =========================================================
// DATOS DE PRESUPUESTO
// =========================================================

async function presupuestoData(
  id,
  usuario
) {
  const params = [id];

  let filtroUbicacion = "";

  if (
    usuario.rol === "empleado"
  ) {
    params.push(
      Number(
        usuario.ubicacion_id
      )
    );

    filtroUbicacion =
      `AND p.ubicacion_id = $${params.length}`;
  }

  const presupuestoResultado =
    await db.pool.query(
      `
        SELECT
          p.*,

          ub.nombre AS ubicacion,

          us.nombre AS vendedor

        FROM presupuestos p

        INNER JOIN ubicaciones ub
          ON ub.id = p.ubicacion_id

        INNER JOIN usuarios us
          ON us.id = p.usuario_id

        WHERE
          p.id = $1
          ${filtroUbicacion}

        LIMIT 1;
      `,
      params
    );

  if (
    presupuestoResultado.rows.length ===
    0
  ) {
    return null;
  }

  const itemsResultado =
    await db.pool.query(
      `
        SELECT
          pi.*,

          pr.codigo_interno,
          pr.codigo_barras

        FROM presupuesto_items pi

        LEFT JOIN productos pr
          ON pr.id = pi.producto_id

        WHERE
          pi.presupuesto_id = $1

        ORDER BY pi.id;
      `,
      [id]
    );

  return {
    presupuesto:
      presupuestoResultado.rows[0],

    items:
      itemsResultado.rows,
  };
}

// =========================================================
// ENCABEZADO PDF
// =========================================================

function encabezadoPdf(
  doc,
  data,
  tipo
) {
  // =======================================================
  // LOGO
  // =======================================================

  try {
    doc.image(
      EMPRESA.logoPath,
      48,
      32,
      {
        fit: [
          95,
          95,
        ],
        align:
          "center",
        valign:
          "center",
      }
    );
  } catch (error) {
    console.error(
      "No se pudo cargar el logo en el PDF:",
      error.message
    );
  }

  // =======================================================
  // EMPRESA
  // =======================================================

  doc
    .font(
      "Helvetica-Bold"
    )
    .fontSize(22)
    .fillColor("#111827")
    .text(
      EMPRESA.nombre,
      165,
      38
    );

  doc
    .font(
      "Helvetica"
    )
    .fontSize(11)
    .fillColor("#374151")
    .text(
      EMPRESA.rubro,
      165,
      66
    );

  doc
    .fontSize(9.5)
    .text(
      direccionPorUbicacion(
        data.ubicacion
      ),
      165,
      86
    );

  doc.text(
    `Tel: ${EMPRESA.telefono}`,
    165,
    102
  );

  doc.text(
    `Instagram: ${EMPRESA.instagram}`,
    165,
    118
  );

  // =======================================================
  // LÍNEA
  // =======================================================

  doc
    .moveTo(
      45,
      148
    )
    .lineTo(
      550,
      148
    )
    .lineWidth(1)
    .strokeColor(
      "#111827"
    )
    .stroke();

  // =======================================================
  // TÍTULO
  // =======================================================

  const titulo =
    tipo ===
    "presupuesto"
      ? "PRESUPUESTO"
      : "COMPROBANTE DE VENTA";

  doc
    .font(
      "Helvetica-Bold"
    )
    .fontSize(18)
    .fillColor("#111827")
    .text(
      `${titulo} #${data.numero}`,
      45,
      170,
      {
        align:
          "center",
      }
    );

  doc.y = 208;

  // =======================================================
  // DATOS
  // =======================================================

  doc
    .font(
      "Helvetica"
    )
    .fontSize(10)
    .fillColor("#111827");

  doc.text(
    `Fecha: ${fechaArgentina(
      data.created_at
    )}`
  );

  doc.text(
    `Sucursal: ${data.ubicacion}`
  );

  doc.text(
    `Vendedor: ${data.vendedor}`
  );

  if (
    data.cliente_nombre
  ) {
    doc.moveDown(
      0.4
    );

    doc
      .font(
        "Helvetica-Bold"
      )
      .text(
        "Cliente:",
        {
          continued:
            true,
        }
      )
      .font(
        "Helvetica"
      )
      .text(
        ` ${data.cliente_nombre}`
      );
  }

  if (
    data.cliente_documento
  ) {
    doc.text(
      `DNI / CUIT: ${data.cliente_documento}`
    );
  }

  if (
    data.cliente_telefono
  ) {
    doc.text(
      `Teléfono: ${data.cliente_telefono}`
    );
  }

  doc.moveDown(
    1
  );
}

// =========================================================
// CABECERA DE TABLA
// =========================================================

function cabeceraTabla(
  doc
) {
  const y =
    doc.y;

  doc
    .rect(
      45,
      y,
      505,
      24
    )
    .fill(
      "#F3F4F6"
    );

  doc
    .fillColor(
      "#374151"
    )
    .font(
      "Helvetica-Bold"
    )
    .fontSize(9);

  doc.text(
    "PRODUCTO",
    52,
    y + 7,
    {
      width: 270,
    }
  );

  doc.text(
    "CANT.",
    325,
    y + 7,
    {
      width: 45,
      align:
        "center",
    }
  );

  doc.text(
    "PRECIO",
    375,
    y + 7,
    {
      width: 80,
      align:
        "right",
    }
  );

  doc.text(
    "SUBTOTAL",
    460,
    y + 7,
    {
      width: 82,
      align:
        "right",
    }
  );

  doc.y =
    y + 30;
}

// =========================================================
// ITEM DE TABLA
// =========================================================

function itemTabla(
  doc,
  item
) {
  // Nueva página si queda poco espacio
  if (
    doc.y > 700
  ) {
    doc.addPage();

    doc.y = 50;

    cabeceraTabla(
      doc
    );
  }

  const y =
    doc.y;

  const cantidad =
    Number(
      item.cantidad
    ) || 0;

  doc
    .font(
      "Helvetica-Bold"
    )
    .fontSize(9.5)
    .fillColor(
      "#111827"
    )
    .text(
      item.descripcion ||
        "Producto",
      52,
      y,
      {
        width: 265,
      }
    );

  doc
    .font(
      "Helvetica"
    )
    .fontSize(9.5)
    .text(
      cantidad.toString(),
      325,
      y,
      {
        width: 45,
        align:
          "center",
      }
    );

  doc.text(
    `$${money(
      item.precio_unitario
    )}`,
    375,
    y,
    {
      width: 80,
      align:
        "right",
    }
  );

  doc
    .font(
      "Helvetica-Bold"
    )
    .text(
      `$${money(
        item.subtotal
      )}`,
      460,
      y,
      {
        width: 82,
        align:
          "right",
      }
    );

  // Código debajo si existe
  const codigo =
    item.codigo_interno ||
    item.codigo_barras;

  let alto =
    25;

  if (codigo) {
    doc
      .font(
        "Helvetica"
      )
      .fontSize(7.5)
      .fillColor(
        "#6B7280"
      )
      .text(
        `Código: ${codigo}`,
        52,
        y + 15
      );

    alto =
      32;
  }

  doc
    .moveTo(
      45,
      y + alto
    )
    .lineTo(
      550,
      y + alto
    )
    .lineWidth(
      0.4
    )
    .strokeColor(
      "#E5E7EB"
    )
    .stroke();

  doc.y =
    y + alto + 8;
}

// =========================================================
// TOTALES
// =========================================================

function totalesPdf(
  doc,
  data,
  tipo
) {
  if (
    doc.y > 650
  ) {
    doc.addPage();

    doc.y = 50;
  }

  doc.moveDown(
    0.8
  );

  const xTexto =
    375;

  const ancho =
    170;

  doc
    .font(
      "Helvetica"
    )
    .fontSize(10)
    .fillColor(
      "#374151"
    );

  doc.text(
    `Subtotal: $${money(
      data.subtotal
    )}`,
    xTexto,
    doc.y,
    {
      width:
        ancho,
      align:
        "right",
    }
  );

  if (
    Number(
      data.descuento
    ) > 0
  ) {
    doc.text(
      `Descuento: -$${money(
        data.descuento
      )}`,
      xTexto,
      doc.y,
      {
        width:
          ancho,
        align:
          "right",
      }
    );
  }

  if (
    Number(
      data.recargo
    ) > 0
  ) {
    doc.text(
      `Recargo: $${money(
        data.recargo
      )}`,
      xTexto,
      doc.y,
      {
        width:
          ancho,
        align:
          "right",
      }
    );
  }

  if (
    tipo === "venta" &&
    Number(
      data.flete
    ) > 0
  ) {
    // El cargo forma parte del total,
    // pero no se detalla como "Flete".
    doc.text(
      "Servicios incluidos",
      xTexto,
      doc.y,
      {
        width:
          ancho,
        align:
          "right",
      }
    );
  }

  doc.moveDown(
    0.5
  );

  doc
    .font(
      "Helvetica-Bold"
    )
    .fontSize(16)
    .fillColor(
      "#111827"
    )
    .text(
      `TOTAL: $${money(
        data.total
      )}`,
      xTexto - 30,
      doc.y,
      {
        width:
          ancho + 30,
        align:
          "right",
      }
    );

  // =======================================================
  // FORMA DE PAGO
  // =======================================================

  if (
    tipo === "venta"
  ) {
    doc.moveDown(
      1
    );

    doc
      .font(
        "Helvetica"
      )
      .fontSize(9.5)
      .fillColor(
        "#374151"
      );

    if (
      data.forma_pago
    ) {
      doc.text(
        `Forma de pago: ${data.forma_pago}`
      );
    }

    if (
      data.tarjeta
    ) {
      let texto =
        `Tarjeta: ${data.tarjeta}`;

      if (
        data.cuotas
      ) {
        texto +=
          ` · ${data.cuotas} cuotas`;
      }

      doc.text(
        texto
      );
    }
  }
}

// =========================================================
// PIE PDF
// =========================================================

function piePdf(
  doc,
  tipo
) {
  const yPie =
    760;

  doc
    .moveTo(
      45,
      yPie - 10
    )
    .lineTo(
      550,
      yPie - 10
    )
    .lineWidth(
      0.5
    )
    .strokeColor(
      "#D1D5DB"
    )
    .stroke();

  doc
    .font(
      "Helvetica"
    )
    .fontSize(8)
    .fillColor(
      "#6B7280"
    );

  if (
    tipo ===
    "presupuesto"
  ) {
    doc.text(
      "Presupuesto válido por 7 días, sujeto a disponibilidad y actualización de precios.",
      45,
      yPie,
      {
        width: 505,
        align:
          "center",
      }
    );
  } else {
    doc.text(
      "Comprobante interno de venta. No reemplaza comprobante fiscal cuando corresponda.",
      45,
      yPie,
      {
        width: 505,
        align:
          "center",
      }
    );
  }

  doc.text(
    `${EMPRESA.instagram}  ·  Tel: ${EMPRESA.telefono}`,
    45,
    yPie + 14,
    {
      width: 505,
      align:
        "center",
    }
  );
}

// =========================================================
// GENERAR PDF
// =========================================================

function generarPdf(
  res,
  tipo,
  data
) {
  const doc =
    new PDFDocument({
      size:
        "A4",

      margin:
        45,

      bufferPages:
        true,

      info: {
        Title:
          tipo ===
          "presupuesto"
            ? `Presupuesto #${data.numero} - La Torre`
            : `Comprobante de venta #${data.numero} - La Torre`,

        Author:
          "La Torre Electro Hogar",
      },
    });

  res.setHeader(
    "Content-Type",
    "application/pdf"
  );

  res.setHeader(
    "Content-Disposition",
    `inline; filename="${tipo}-${data.numero}.pdf"`
  );

  doc.pipe(
    res
  );

  // =======================================================
  // ENCABEZADO
  // =======================================================

  encabezadoPdf(
    doc,
    data,
    tipo
  );

  // =======================================================
  // TABLA
  // =======================================================

  cabeceraTabla(
    doc
  );

  for (
    const item of data.items
  ) {
    itemTabla(
      doc,
      item
    );
  }

  // =======================================================
  // TOTALES
  // =======================================================

  totalesPdf(
    doc,
    data,
    tipo
  );

  // =======================================================
  // PIE EN TODAS LAS PÁGINAS
  // =======================================================

  const rango =
    doc.bufferedPageRange();

  for (
    let i = rango.start;
    i <
    rango.start +
      rango.count;
    i++
  ) {
    doc.switchToPage(
      i
    );

    piePdf(
      doc,
      tipo
    );
  }

  doc.end();
}

// =========================================================
// COMPROBANTE A4 DE VENTA
// =========================================================

router.get(
  "/ventas/:id/comprobante",
  requiereLogin,
  requiereSucursal,
  async (
    req,
    res
  ) => {
    try {
      const datos =
        await ventaData(
          Number(
            req.params.id
          ),
          req.session.usuario
        );

      if (!datos) {
        return res
          .status(404)
          .send(
            "Venta no encontrada."
          );
      }

      return res.render(
        "venta-comprobante",
        {
          usuario:
            req.session.usuario,

          ...datos,

          empresa:
            EMPRESA,

          direccion:
            direccionPorUbicacion(
              datos.venta
                .ubicacion
            ),
        }
      );
    } catch (error) {
      console.error(
        "Error mostrando comprobante:",
        error
      );

      return res
        .status(500)
        .send(
          "No se pudo generar el comprobante."
        );
    }
  }
);

// =========================================================
// TICKET DE VENTA
// =========================================================

router.get(
  "/ventas/:id/ticket",
  requiereLogin,
  requiereSucursal,
  async (
    req,
    res
  ) => {
    try {
      const datos =
        await ventaData(
          Number(
            req.params.id
          ),
          req.session.usuario
        );

      if (!datos) {
        return res
          .status(404)
          .send(
            "Venta no encontrada."
          );
      }

      return res.render(
        "venta-ticket",
        {
          ...datos,

          empresa:
            EMPRESA,

          direccion:
            direccionPorUbicacion(
              datos.venta
                .ubicacion
            ),
        }
      );
    } catch (error) {
      console.error(
        "Error mostrando ticket:",
        error
      );

      return res
        .status(500)
        .send(
          "No se pudo generar el ticket."
        );
    }
  }
);

// =========================================================
// PDF DE VENTA
// =========================================================

router.get(
  "/ventas/:id/pdf",
  requiereLogin,
  requiereSucursal,
  async (
    req,
    res
  ) => {
    try {
      const datos =
        await ventaData(
          Number(
            req.params.id
          ),
          req.session.usuario
        );

      if (!datos) {
        return res
          .status(404)
          .send(
            "Venta no encontrada."
          );
      }

      return generarPdf(
        res,
        "venta",
        {
          ...datos.venta,

          items:
            datos.items,
        }
      );
    } catch (error) {
      console.error(
        "Error generando PDF de venta:",
        error
      );

      if (
        !res.headersSent
      ) {
        return res
          .status(500)
          .send(
            "No se pudo generar el PDF."
          );
      }
    }
  }
);

// =========================================================
// WHATSAPP VENTA
// =========================================================

router.get(
  "/ventas/:id/whatsapp",
  requiereLogin,
  requiereSucursal,
  async (
    req,
    res
  ) => {
    try {
      const datos =
        await ventaData(
          Number(
            req.params.id
          ),
          req.session.usuario
        );

      if (!datos) {
        return res
          .status(404)
          .send(
            "Venta no encontrada."
          );
      }

      const base =
        `${req.protocol}://${req.get(
          "host"
        )}`;

      const texto =
        `LA TORRE - ELECTRO HOGAR\n\n` +
        `Comprobante de venta #${datos.venta.numero}\n` +
        `Total: $${money(
          datos.venta.total
        )}\n\n` +
        `Ver / descargar PDF:\n` +
        `${base}/ventas/${datos.venta.id}/pdf\n\n` +
        `${EMPRESA.instagram}\n` +
        `Tel: ${EMPRESA.telefono}`;

      return res.redirect(
        "https://wa.me/?text=" +
          encodeURIComponent(
            texto
          )
      );
    } catch (error) {
      console.error(
        "Error compartiendo venta por WhatsApp:",
        error
      );

      return res
        .status(500)
        .send(
          "No se pudo abrir WhatsApp."
        );
    }
  }
);

// =========================================================
// COMPROBANTE DE PRESUPUESTO
// =========================================================

router.get(
  "/presupuestos/:id/comprobante",
  requiereLogin,
  requiereSucursal,
  async (
    req,
    res
  ) => {
    try {
      const datos =
        await presupuestoData(
          Number(
            req.params.id
          ),
          req.session.usuario
        );

      if (!datos) {
        return res
          .status(404)
          .send(
            "Presupuesto no encontrado."
          );
      }

      return res.render(
        "presupuesto-comprobante",
        {
          usuario:
            req.session.usuario,

          ...datos,

          empresa:
            EMPRESA,

          direccion:
            direccionPorUbicacion(
              datos.presupuesto
                .ubicacion
            ),
        }
      );
    } catch (error) {
      console.error(
        "Error mostrando presupuesto:",
        error
      );

      return res
        .status(500)
        .send(
          "No se pudo generar el presupuesto."
        );
    }
  }
);

// =========================================================
// PDF PRESUPUESTO
// =========================================================

router.get(
  "/presupuestos/:id/pdf",
  requiereLogin,
  requiereSucursal,
  async (
    req,
    res
  ) => {
    try {
      const datos =
        await presupuestoData(
          Number(
            req.params.id
          ),
          req.session.usuario
        );

      if (!datos) {
        return res
          .status(404)
          .send(
            "Presupuesto no encontrado."
          );
      }

      return generarPdf(
        res,
        "presupuesto",
        {
          ...datos.presupuesto,

          items:
            datos.items,
        }
      );
    } catch (error) {
      console.error(
        "Error generando PDF de presupuesto:",
        error
      );

      if (
        !res.headersSent
      ) {
        return res
          .status(500)
          .send(
            "No se pudo generar el PDF."
          );
      }
    }
  }
);

// =========================================================
// WHATSAPP PRESUPUESTO
// =========================================================

router.get(
  "/presupuestos/:id/whatsapp",
  requiereLogin,
  requiereSucursal,
  async (
    req,
    res
  ) => {
    try {
      const datos =
        await presupuestoData(
          Number(
            req.params.id
          ),
          req.session.usuario
        );

      if (!datos) {
        return res
          .status(404)
          .send(
            "Presupuesto no encontrado."
          );
      }

      const base =
        `${req.protocol}://${req.get(
          "host"
        )}`;

      const texto =
        `LA TORRE - ELECTRO HOGAR\n\n` +
        `Presupuesto #${datos.presupuesto.numero}\n` +
        `Total: $${money(
          datos.presupuesto.total
        )}\n\n` +
        `Ver / descargar PDF:\n` +
        `${base}/presupuestos/${datos.presupuesto.id}/pdf\n\n` +
        `Presupuesto válido por 7 días.\n\n` +
        `${EMPRESA.instagram}\n` +
        `Tel: ${EMPRESA.telefono}`;

      return res.redirect(
        "https://wa.me/?text=" +
          encodeURIComponent(
            texto
          )
      );
    } catch (error) {
      console.error(
        "Error compartiendo presupuesto por WhatsApp:",
        error
      );

      return res
        .status(500)
        .send(
          "No se pudo abrir WhatsApp."
        );
    }
  }
);

module.exports =
  router;