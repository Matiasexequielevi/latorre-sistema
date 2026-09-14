const express = require('express');
const db = require('../database/db');
const { requiereLogin, requiereSucursal } = require('../middleware/auth');
const router = express.Router();

async function resumenCaja(cajaId) {
  const q = await db.pool.query(`
    SELECT fp.nombre, fp.tipo, COUNT(v.id)::int cantidad, COALESCE(SUM(v.total),0)::numeric total
    FROM formas_pago fp
    LEFT JOIN ventas v ON v.forma_pago_id=fp.id AND v.caja_id=$1 AND v.estado='confirmada'
    WHERE fp.activo=TRUE
    GROUP BY fp.id, fp.nombre, fp.tipo
    ORDER BY fp.id`, [cajaId]);
  return q.rows;
}

router.get('/cajas', requiereLogin, requiereSucursal, async (req,res) => {
  try {
    const u=req.session.usuario;
    const params=[]; let where='1=1';
    if(u.rol==='empleado') { params.push(Number(u.id)); where=`c.usuario_id=$1`; }
    const cajas = await db.pool.query(`
      SELECT c.*, ub.nombre ubicacion, us.nombre usuario_nombre,
        (SELECT COALESCE(SUM(v.total),0) FROM ventas v WHERE v.caja_id=c.id AND v.estado='confirmada') total_ventas
      FROM cajas c JOIN ubicaciones ub ON ub.id=c.ubicacion_id JOIN usuarios us ON us.id=c.usuario_id
      WHERE ${where} ORDER BY c.apertura_at DESC LIMIT 100`, params);
    const propia = await db.pool.query(`SELECT c.*,ub.nombre ubicacion FROM cajas c JOIN ubicaciones ub ON ub.id=c.ubicacion_id WHERE c.usuario_id=$1 AND c.estado='abierta' ORDER BY c.apertura_at DESC LIMIT 1`,[u.id]);
    let abierta = propia.rows[0] || null;
    let resumen = abierta ? await resumenCaja(abierta.id) : [];
    const locales = u.rol==='dueno' ? (await db.pool.query(`SELECT id,nombre FROM ubicaciones WHERE activo=TRUE AND tipo='local' ORDER BY id`)).rows : [];
    res.render('cajas',{usuario:u,cajas:cajas.rows,abierta,resumen,locales,mensaje:req.query.ok||null,error:req.query.error||null});
  } catch(e){ console.error(e); res.status(500).send('Error cargando cajas.'); }
});

router.post('/cajas/abrir', requiereLogin, requiereSucursal, async (req,res)=>{
  try {
    const u=req.session.usuario;
    const monto=Number(req.body.monto_inicial||0);
    if(!Number.isFinite(monto)||monto<0) throw new Error('Monto inicial inválido.');
    let ubicacionId = u.rol==='empleado' ? Number(u.ubicacion_id) : Number(req.body.ubicacion_id);
    if(!ubicacionId) throw new Error('Seleccioná la sucursal.');
    const ex=await db.pool.query(`SELECT id FROM cajas WHERE usuario_id=$1 AND estado='abierta' LIMIT 1`,[u.id]);
    if(ex.rows.length) throw new Error('Ya tenés una caja abierta.');
    await db.pool.query(`INSERT INTO cajas(ubicacion_id,usuario_id,monto_inicial,observaciones_apertura) VALUES($1,$2,$3,$4)`,[ubicacionId,u.id,monto,String(req.body.observaciones||'').trim()||null]);
    res.redirect('/cajas?ok='+encodeURIComponent('Caja abierta correctamente.'));
  } catch(e){ res.redirect('/cajas?error='+encodeURIComponent(e.message)); }
});

router.post('/cajas/:id/cerrar', requiereLogin, requiereSucursal, async (req,res)=>{
  const client=await db.pool.connect();
  try {
    const u=req.session.usuario; const id=Number(req.params.id); const contado=Number(req.body.efectivo_contado);
    if(!id||!Number.isFinite(contado)||contado<0) throw new Error('Efectivo contado inválido.');
    await client.query('BEGIN');
    const q=await client.query(`SELECT * FROM cajas WHERE id=$1 AND estado='abierta' FOR UPDATE`,[id]);
    if(!q.rows.length) throw new Error('La caja ya está cerrada o no existe.');
    const c=q.rows[0]; if(u.rol==='empleado'&&Number(c.usuario_id)!==Number(u.id)) throw new Error('No podés cerrar otra caja.');
    const ef=await client.query(`SELECT COALESCE(SUM(v.total),0) total FROM ventas v JOIN formas_pago fp ON fp.id=v.forma_pago_id WHERE v.caja_id=$1 AND v.estado='confirmada' AND fp.tipo='efectivo'`,[id]);
    const esperado=Number(c.monto_inicial||0)+Number(ef.rows[0].total||0); const diferencia=contado-esperado;
    await client.query(`UPDATE cajas SET estado='cerrada', cierre_at=NOW(), efectivo_esperado=$2, efectivo_contado=$3, diferencia=$4, observaciones_cierre=$5 WHERE id=$1`,[id,esperado,contado,diferencia,String(req.body.observaciones||'').trim()||null]);
    await client.query('COMMIT');
    res.redirect('/cajas?ok='+encodeURIComponent(`Caja cerrada. Diferencia: $${diferencia.toLocaleString('es-AR',{minimumFractionDigits:2})}`));
  } catch(e){ try{await client.query('ROLLBACK')}catch{} res.redirect('/cajas?error='+encodeURIComponent(e.message)); } finally{client.release();}
});
module.exports=router;
