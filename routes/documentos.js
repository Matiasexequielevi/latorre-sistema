const express=require('express');
const db=require('../database/db');
const {requiereLogin,requiereSucursal}=require('../middleware/auth');
const {EMPRESA,direccionPorUbicacion}=require('../lib/empresa');
const router=express.Router();

async function ventaData(id,usuario){
 const params=[id]; let f=''; if(usuario.rol==='empleado'){params.push(Number(usuario.ubicacion_id));f=`AND v.ubicacion_id=$${params.length}`;}
 const q=await db.pool.query(`SELECT v.*,ub.nombre ubicacion,us.nombre vendedor,fp.nombre forma_pago,t.nombre tarjeta FROM ventas v JOIN ubicaciones ub ON ub.id=v.ubicacion_id JOIN usuarios us ON us.id=v.usuario_id LEFT JOIN formas_pago fp ON fp.id=v.forma_pago_id LEFT JOIN tarjetas t ON t.id=v.tarjeta_id WHERE v.id=$1 ${f} LIMIT 1`,params);
 if(!q.rows.length)return null;
 const it=await db.pool.query(`SELECT vi.*,p.codigo_interno,p.codigo_barras FROM venta_items vi LEFT JOIN productos p ON p.id=vi.producto_id WHERE vi.venta_id=$1 ORDER BY vi.id`,[id]);
 return {venta:q.rows[0],items:it.rows};
}
async function presupuestoData(id,usuario){
 const params=[id]; let f=''; if(usuario.rol==='empleado'){params.push(Number(usuario.ubicacion_id));f=`AND p.ubicacion_id=$${params.length}`;}
 const q=await db.pool.query(`SELECT p.*,ub.nombre ubicacion,us.nombre vendedor FROM presupuestos p JOIN ubicaciones ub ON ub.id=p.ubicacion_id JOIN usuarios us ON us.id=p.usuario_id WHERE p.id=$1 ${f} LIMIT 1`,params);
 if(!q.rows.length)return null;
 const it=await db.pool.query(`SELECT pi.*,pr.codigo_interno,pr.codigo_barras FROM presupuesto_items pi LEFT JOIN productos pr ON pr.id=pi.producto_id WHERE pi.presupuesto_id=$1 ORDER BY pi.id`,[id]);
 return {presupuesto:q.rows[0],items:it.rows};
}
function money(n){return Number(n||0).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function pdf(res,tipo,data){
 const PDFDocument=require('pdfkit'); const doc=new PDFDocument({size:'A4',margin:45});
 res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition',`inline; filename="${tipo}-${data.numero}.pdf"`); doc.pipe(res);
 try{doc.image(EMPRESA.logoPath,45,35,{width:85});}catch{}
 doc.font('Helvetica-Bold').fontSize(20).text(EMPRESA.nombre,145,45).fontSize(10).font('Helvetica').text(EMPRESA.rubro).text(direccionPorUbicacion(data.ubicacion)).text(`Tel: ${EMPRESA.telefono} · Instagram: ${EMPRESA.instagram}`);
 doc.moveDown(3).font('Helvetica-Bold').fontSize(17).text(`${tipo==='presupuesto'?'PRESUPUESTO':'COMPROBANTE DE VENTA'} #${data.numero}`).fontSize(10).font('Helvetica').text(`Fecha: ${new Date(data.created_at).toLocaleString('es-AR')}`).text(`Sucursal: ${data.ubicacion}`).text(`Vendedor: ${data.vendedor}`);
 if(data.cliente_nombre) doc.text(`Cliente: ${data.cliente_nombre}${data.cliente_documento?' · '+data.cliente_documento:''}${data.cliente_telefono?' · '+data.cliente_telefono:''}`);
 doc.moveDown().moveTo(45,doc.y).lineTo(550,doc.y).stroke(); doc.moveDown();
 for(const i of data.items){doc.font('Helvetica-Bold').text(i.descripcion,{continued:false});doc.font('Helvetica').text(`${Number(i.cantidad)} x $${money(i.precio_unitario)}   $${money(i.subtotal)}`);doc.moveDown(.35)}
 doc.moveDown().moveTo(45,doc.y).lineTo(550,doc.y).stroke();doc.moveDown();
 doc.font('Helvetica').text(`Subtotal: $${money(data.subtotal)}`,{align:'right'}); if(Number(data.descuento)>0)doc.text(`Descuento: -$${money(data.descuento)}`,{align:'right'}); if(Number(data.recargo)>0)doc.text(`Recargo: $${money(data.recargo)}`,{align:'right'}); if(tipo==='venta'&&Number(data.flete)>0)doc.text(`Servicios incluidos`,{align:'right'});
 doc.font('Helvetica-Bold').fontSize(15).text(`TOTAL: $${money(data.total)}`,{align:'right'});
 doc.moveDown(2).font('Helvetica').fontSize(9); if(tipo==='presupuesto')doc.text('Presupuesto válido por 7 días, sujeto a disponibilidad y actualización de precios.'); else doc.text('Comprobante interno de venta. No reemplaza comprobante fiscal cuando corresponda.');
 doc.text(`${EMPRESA.instagram} · ${EMPRESA.telefono}`,{align:'center'}); doc.end();
}
router.get('/ventas/:id/comprobante',requiereLogin,requiereSucursal,async(req,res)=>{const d=await ventaData(Number(req.params.id),req.session.usuario);if(!d)return res.status(404).send('Venta no encontrada.');res.render('venta-comprobante',{usuario:req.session.usuario,...d,empresa:EMPRESA,direccion:direccionPorUbicacion(d.venta.ubicacion)});});
router.get('/ventas/:id/ticket',requiereLogin,requiereSucursal,async(req,res)=>{const d=await ventaData(Number(req.params.id),req.session.usuario);if(!d)return res.status(404).send('Venta no encontrada.');res.render('venta-ticket',{...d,empresa:EMPRESA,direccion:direccionPorUbicacion(d.venta.ubicacion)});});
router.get('/ventas/:id/pdf',requiereLogin,requiereSucursal,async(req,res)=>{const d=await ventaData(Number(req.params.id),req.session.usuario);if(!d)return res.status(404).send('Venta no encontrada.');pdf(res,'venta',{...d.venta,items:d.items});});
router.get('/ventas/:id/whatsapp',requiereLogin,requiereSucursal,async(req,res)=>{const d=await ventaData(Number(req.params.id),req.session.usuario);if(!d)return res.status(404).send('Venta no encontrada.');const base=`${req.protocol}://${req.get('host')}`;const text=`La Torre - Comprobante de venta #${d.venta.numero}\nTotal: $${money(d.venta.total)}\nPDF: ${base}/ventas/${d.venta.id}/pdf`;res.redirect('https://wa.me/?text='+encodeURIComponent(text));});
router.get('/presupuestos/:id/comprobante',requiereLogin,requiereSucursal,async(req,res)=>{const d=await presupuestoData(Number(req.params.id),req.session.usuario);if(!d)return res.status(404).send('Presupuesto no encontrado.');res.render('presupuesto-comprobante',{usuario:req.session.usuario,...d,empresa:EMPRESA,direccion:direccionPorUbicacion(d.presupuesto.ubicacion)});});
router.get('/presupuestos/:id/pdf',requiereLogin,requiereSucursal,async(req,res)=>{const d=await presupuestoData(Number(req.params.id),req.session.usuario);if(!d)return res.status(404).send('Presupuesto no encontrado.');pdf(res,'presupuesto',{...d.presupuesto,items:d.items});});
router.get('/presupuestos/:id/whatsapp',requiereLogin,requiereSucursal,async(req,res)=>{const d=await presupuestoData(Number(req.params.id),req.session.usuario);if(!d)return res.status(404).send('Presupuesto no encontrado.');const base=`${req.protocol}://${req.get('host')}`;const text=`La Torre - Presupuesto #${d.presupuesto.numero}\nTotal: $${money(d.presupuesto.total)}\nPDF: ${base}/presupuestos/${d.presupuesto.id}/pdf`;res.redirect('https://wa.me/?text='+encodeURIComponent(text));});
module.exports=router;
