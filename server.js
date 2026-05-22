const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'aseada_secret_2024';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
app.use(cors());
app.use(express.json());
const verificarToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try { req.usuario = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalido' }); }
};
app.get('/', (req, res) => res.json({ mensaje: 'Aseada API funcionando', version: '2.0.0', db: 'PostgreSQL' }));
app.get('/api/workers', async (req, res) => {
  try {
    const r = await pool.query("SELECT id,nombre,email,tarifa,rating,total_servicios,activo FROM usuarios WHERE rol='worker' AND activo=true ORDER BY rating DESC");
    res.json(r.rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/disponibilidad', async (req, res) => {
  try {
    const r = await pool.query("SELECT d.*,u.nombre as worker_nombre,u.tarifa,u.rating FROM disponibilidad d JOIN usuarios u ON d.worker_id=u.id WHERE u.activo=true ORDER BY d.id DESC");
    res.json(r.rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/auth/registro', async (req, res) => {
  try {
    const {nombre,email,password,rol} = req.body;
    if(!nombre||!email||!password||!rol) return res.status(400).json({error:'Faltan campos'});
    const ex = await pool.query('SELECT id FROM usuarios WHERE email=$1',[email]);
    if(ex.rows.length>0) return res.status(400).json({error:'Email ya registrado'});
    const hash = await bcrypt.hash(password,10);
    const r = await pool.query("INSERT INTO usuarios(nombre,email,password,rol,tarifa,rating,total_servicios,activo) VALUES($1,$2,$3,$4,$5,5.0,0,true) RETURNING id,nombre,email,rol",[nombre,email,hash,rol,rol==='worker'?12000:null]);
    const token = jwt.sign({id:r.rows[0].id,email:r.rows[0].email,rol:r.rows[0].rol},JWT_SECRET,{expiresIn:'7d'});
    res.json({mensaje:'Cuenta creada',token,usuario:r.rows[0]});
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/auth/login', async (req, res) => {
  try {
    const {email,password} = req.body;
    const r = await pool.query('SELECT * FROM usuarios WHERE email=$1',[email]);
    if(!r.rows[0]) return res.status(400).json({error:'Credenciales incorrectas'});
    const valid = await bcrypt.compare(password,r.rows[0].password);
    if(!valid) return res.status(400).json({error:'Credenciales incorrectas'});
    const token = jwt.sign({id:r.rows[0].id,email:r.rows[0].email,rol:r.rows[0].rol},JWT_SECRET,{expiresIn:'7d'});
    res.json({token,usuario:{id:r.rows[0].id,nombre:r.rows[0].nombre,email:r.rows[0].email,rol:r.rows[0].rol,tarifa:r.rows[0].tarifa,rating:r.rows[0].rating}});
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/usuarios', verificarToken, async (req, res) => {
  try { const r = await pool.query('SELECT id,nombre,email,rol,tarifa,rating,total_servicios,activo,fecha_registro FROM usuarios'); res.json(r.rows); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/servicios', verificarToken, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM servicios ORDER BY id DESC'); res.json(r.rows); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/mis-servicios', verificarToken, async (req, res) => {
  try {
    const col = req.usuario.rol==='worker'?'worker_id':'cliente_id';
    const r = await pool.query(`SELECT * FROM servicios WHERE ${col}=$1 ORDER BY id DESC`,[req.usuario.id]);
    res.json(r.rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/pagos', verificarToken, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM pagos ORDER BY id DESC'); res.json(r.rows); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/calificaciones', async (req, res) => {
  try { const r = await pool.query('SELECT * FROM calificaciones ORDER BY id DESC'); res.json(r.rows); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/notificaciones', verificarToken, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM notificaciones WHERE usuario_id=$1 ORDER BY id DESC',[req.usuario.id]); res.json(r.rows); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/fotos_servicio', verificarToken, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM fotos_servicio ORDER BY id DESC'); res.json(r.rows); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.listen(PORT, '0.0.0.0', () => console.log('Aseada PostgreSQL v2.0 corriendo en puerto ' + PORT));
